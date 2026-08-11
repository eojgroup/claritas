import { query, withTransaction, withWorkerLease } from "../db";
import { ingestUsgsEarthquakes } from "../connectors/usgs-earthquakes";
import { NasaFirmsProvider } from "../earth-observation/providers/nasa-firms";
import { boundBoundingBox, type BoundingBox } from "../earth-observation/types";

const firms = new NasaFirmsProvider();
let rapidSourceTimer: NodeJS.Timeout | null = null;
let rapidSourceRunning = false;
let firmsCursor = 0;
let lastUsgsPollAt = 0;
let lastFirmsPollAt = 0;

const flag = (name: string) => ["1", "true", "yes", "on"].includes(process.env[name]?.trim().toLowerCase() ?? "");
const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
};

async function recordProviderResult(provider: string, success: boolean, error?: string, event = false) {
  await query(
    `INSERT INTO provider_runtime_state (
       provider,enabled,last_attempt_at,last_success_at,last_event_at,consecutive_failures,last_error,updated_at
     ) VALUES ($1,$2,now(),CASE WHEN $3 THEN now() ELSE NULL END,CASE WHEN $4 THEN now() ELSE NULL END,
       CASE WHEN $3 THEN 0 ELSE 1 END,$5,now())
     ON CONFLICT (provider) DO UPDATE SET
       enabled=EXCLUDED.enabled,last_attempt_at=now(),
       last_success_at=CASE WHEN $3 THEN now() ELSE provider_runtime_state.last_success_at END,
       last_event_at=CASE WHEN $4 THEN now() ELSE provider_runtime_state.last_event_at END,
       consecutive_failures=CASE WHEN $3 THEN 0 ELSE provider_runtime_state.consecutive_failures+1 END,
       circuit_open_until=CASE
         WHEN NOT $3 AND provider_runtime_state.consecutive_failures+1>=5 THEN now()+interval '15 minutes'
         WHEN $3 THEN NULL ELSE provider_runtime_state.circuit_open_until END,
       last_error=$5,updated_at=now()`,
    [provider, provider === "nasa_firms" ? flag("NASA_FIRMS_ENABLED") : flag("USGS_EARTHQUAKES_ENABLED"), success, event, error?.slice(0, 1_000) ?? null],
  );
}

export async function runUsgsNow() {
  try {
    const result = await ingestUsgsEarthquakes();
    await recordProviderResult("usgs_earthquakes", true, undefined, result.material > 0);
    return result;
  } catch (error) {
    await recordProviderResult("usgs_earthquakes", false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function getRapidSourceStatus() {
  const { rows } = await query<any>(
    `SELECT provider,enabled,last_attempt_at,last_success_at,last_event_at,
            consecutive_failures,circuit_open_until,rate_limited_until,last_error
     FROM provider_runtime_state
     WHERE provider IN ('usgs_earthquakes','nasa_firms')
     ORDER BY provider`,
  );
  const runtime = new Map(rows.map((row) => [row.provider, row]));
  const firmsStatus = firms.status();
  return [
    {
      provider: "usgs_earthquakes",
      ...(runtime.get("usgs_earthquakes") ?? {}),
      enabled: flag("USGS_EARTHQUAKES_ENABLED"),
      configured: true,
      state: !flag("USGS_EARTHQUAKES_ENABLED") ? "disabled" : "ready",
      reason: !flag("USGS_EARTHQUAKES_ENABLED") ? "Feature flag disabled." : undefined,
      attribution: "U.S. Geological Survey real-time GeoJSON earthquake feed.",
    },
    {
      ...firmsStatus,
      ...(runtime.get("nasa_firms") ?? {}),
      enabled: firmsStatus.enabled,
      configured: firmsStatus.configured,
      state: firmsStatus.state,
      reason: firmsStatus.reason,
      attribution: firmsStatus.attribution,
    },
  ].map((status) => ({
    ...status,
    state: status.circuit_open_until && new Date(status.circuit_open_until) > new Date()
      ? "circuit_open"
      : status.rate_limited_until && new Date(status.rate_limited_until) > new Date()
        ? "rate_limited"
        : status.state,
  }));
}

async function ensureFirmsSource() {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name,api_base_url,auth_type,metadata)
     VALUES ('nasa-firms','https://firms.modaps.eosdis.nasa.gov','map_key',$1::jsonb)
     ON CONFLICT (name) DO UPDATE SET metadata=source.metadata||EXCLUDED.metadata,updated_at=now()
     RETURNING id`,
    [JSON.stringify({
      domain: "earth_observation", dataset: "VIIRS near-real-time active fire",
      attribution: "NASA FIRMS", key_required: true,
      terms_url: "https://www.earthdata.nasa.gov/engage/open-data-services-and-software/data-use-policy",
    })],
  );
  return rows[0].id;
}

export async function runFirmsNow(options: { locationId?: string; forceAll?: boolean } = {}) {
  const status = firms.status();
  if (!status.enabled || !status.configured) throw new Error(status.reason ?? "NASA FIRMS is unavailable.");
  const params: unknown[] = [];
  const where = ["active", "bbox IS NOT NULL"];
  if (options.locationId) { params.push(options.locationId); where.push(`id=$${params.length}::uuid`); }
  params.push(options.forceAll ? intEnv("FIRMS_ADMIN_MAX_LOCATIONS", 25, 1, 100) : 100);
  const limitRef = `$${params.length}`;
  const { rows: locations } = await query<{ id: string; slug: string; bbox: number[] }>(
    `SELECT id,slug,bbox FROM intelligence_location WHERE ${where.join(" AND ")}
     ORDER BY monitoring_tier,importance_score DESC,slug LIMIT ${limitRef}`,
    params,
  );
  if (!locations.length) return { provider: "nasa_firms", locations: 0, detections: 0, inserted: 0 };
  const batchSize = options.locationId || options.forceAll ? locations.length : Math.min(locations.length, intEnv("FIRMS_LOCATIONS_PER_POLL", 3, 1, 20));
  const selected = options.locationId || options.forceAll
    ? locations.slice(0, batchSize)
    : Array.from({ length: batchSize }, (_, index) => locations[(firmsCursor + index) % locations.length]);
  firmsCursor = (firmsCursor + batchSize) % Math.max(1, locations.length);
  const sourceId = await ensureFirmsSource();
  let detections = 0;
  let inserted = 0;
  for (const location of selected) {
    const rows = await firms.fetchArea(boundBoundingBox(location.bbox.map(Number) as BoundingBox), 1, process.env.NASA_FIRMS_SOURCE?.trim() || "VIIRS_NOAA20_NRT");
    detections += rows.length;
    for (const detection of rows) {
      await withTransaction(async (client) => {
        const result = await client.query<{ id: string; inserted: boolean }>(
          `INSERT INTO earth_fire_detection (
             provider_external_id,location,latitude,longitude,acquisition_time,
             satellite,instrument,confidence,fire_radiative_power,day_night,
             source_version,raw_payload
           ) VALUES ($1,ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           ON CONFLICT (provider_external_id) DO UPDATE SET raw_payload=EXCLUDED.raw_payload
           RETURNING id,(xmax=0) AS inserted`,
          [detection.externalId,detection.latitude,detection.longitude,detection.acquisitionTime,
           detection.satellite,detection.instrument,detection.confidence,detection.fireRadiativePower,
           detection.dayNight,detection.sourceVersion,JSON.stringify(detection.payload)],
        );
        if (!result.rows[0].inserted) return;
        inserted += 1;
        await client.query(
          `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
           VALUES ('earth.fire.detected','earth_fire_detection',$1,$2,$3::jsonb,$4)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [result.rows[0].id, `firms:${detection.externalId}`,
           JSON.stringify({ fire_detection_id: result.rows[0].id, location_id: location.id, source_id: sourceId }),
           detection.acquisitionTime],
        );
      });
    }
  }
  await recordProviderResult("nasa_firms", true, undefined, inserted > 0);
  return { provider: "nasa_firms", locations: selected.length, detections, inserted };
}

async function rapidSourceCycle() {
  const now = Date.now();
  if (flag("USGS_EARTHQUAKES_ENABLED") && now - lastUsgsPollAt >= intEnv("USGS_POLL_SECONDS", 300, 60, 3600) * 1_000) {
    lastUsgsPollAt = now;
    await runUsgsNow().catch((error) => console.error(JSON.stringify({ event: "usgs_poll_failed", message: error instanceof Error ? error.message : String(error) })));
  }
  if (flag("NASA_FIRMS_ENABLED") && now - lastFirmsPollAt >= intEnv("NASA_FIRMS_POLL_SECONDS", 600, 300, 3600) * 1_000) {
    lastFirmsPollAt = now;
    await runFirmsNow().catch(async (error) => {
      await recordProviderResult("nasa_firms", false, error instanceof Error ? error.message : String(error));
      console.error(JSON.stringify({ event: "firms_poll_failed", message: error instanceof Error ? error.message : String(error) }));
    });
  }
}

export function startRapidSourceWorker() {
  if (rapidSourceTimer || (!flag("USGS_EARTHQUAKES_ENABLED") && !flag("NASA_FIRMS_ENABLED"))) return;
  const tick = () => {
    if (rapidSourceRunning) return;
    rapidSourceRunning = true;
    void withWorkerLease("rapid-event-sources", 240, rapidSourceCycle)
      .catch((error) => console.error(JSON.stringify({ event: "rapid_source_worker_failed", message: error instanceof Error ? error.message : String(error) })))
      .finally(() => { rapidSourceRunning = false; });
  };
  tick();
  rapidSourceTimer = setInterval(tick, intEnv("RAPID_SOURCE_WORKER_TICK_SECONDS", 30, 10, 300) * 1_000);
  rapidSourceTimer.unref();
}
