import { withTransaction, query } from "../db";

const DEFAULT_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

export type UsgsEarthquake = {
  eventId: string;
  longitude: number;
  latitude: number;
  depthKm: number | null;
  magnitude: number | null;
  magnitudeType: string | null;
  place: string;
  significance: number | null;
  alertLevel: string | null;
  tsunami: boolean;
  felt: number | null;
  observedAt: Date;
  updatedAt: Date;
  sourceUrl: string;
  payload: Record<string, unknown>;
};

export function parseUsgsGeoJson(payload: unknown): UsgsEarthquake[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((raw): UsgsEarthquake[] => {
    if (!raw || typeof raw !== "object") return [];
    const feature = raw as {
      id?: unknown;
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties ?? {};
    const id = typeof feature.id === "string" ? feature.id.trim() : "";
    if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2 || !id) return [];
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    const depth = Number(coordinates[2]);
    const observedAt = new Date(Number(properties.time));
    const updatedAt = new Date(Number(properties.updated));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        || Number.isNaN(observedAt.getTime()) || Number.isNaN(updatedAt.getTime())) return [];
    const numberOrNull = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
    return [{
      eventId: id,
      longitude,
      latitude,
      depthKm: Number.isFinite(depth) ? depth : null,
      magnitude: numberOrNull(properties.mag),
      magnitudeType: typeof properties.magType === "string" ? properties.magType : null,
      place: typeof properties.place === "string" && properties.place.trim() ? properties.place.trim() : "Unspecified location",
      significance: numberOrNull(properties.sig),
      alertLevel: typeof properties.alert === "string" ? properties.alert : null,
      tsunami: Number(properties.tsunami) === 1,
      felt: numberOrNull(properties.felt),
      observedAt,
      updatedAt,
      sourceUrl: typeof properties.url === "string" ? properties.url : `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`,
      payload: raw as Record<string, unknown>,
    }];
  });
}
async function ensureUsgsSource() {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name,api_base_url,auth_type,metadata)
     VALUES ('usgs-earthquakes','https://earthquake.usgs.gov','none',$1::jsonb)
     ON CONFLICT (name) DO UPDATE SET metadata=source.metadata||EXCLUDED.metadata,updated_at=now()
     RETURNING id`,
    [JSON.stringify({
      domain: "disaster",
      dataset: "USGS real-time GeoJSON earthquake feed",
      attribution: "U.S. Geological Survey",
      license: "U.S. government public domain",
      feed_lifecycle: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/",
    })],
  );
  return rows[0].id;
}

export async function ingestUsgsEarthquakes(options: { fetchImpl?: typeof fetch; feedUrl?: string } = {}) {
  const feedUrl = options.feedUrl ?? process.env.USGS_EARTHQUAKES_FEED_URL?.trim() ?? DEFAULT_FEED;
  if (!/^https:\/\/earthquake\.usgs\.gov\//.test(feedUrl)) throw new Error("USGS feed URL must use earthquake.usgs.gov over HTTPS.");
  const response = await (options.fetchImpl ?? fetch)(feedUrl, {
    headers: {
      accept: "application/geo+json,application/json",
      "user-agent": process.env.USGS_USER_AGENT?.trim() || "Claritas/1.0 (+https://app.claritas.info; engineering@claritas.info)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`USGS earthquake feed returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const records = parseUsgsGeoJson(await response.json());
  const minimumMagnitude = Number(process.env.USGS_MIN_EVENT_MAGNITUDE ?? 4.5);
  const minimumSignificance = Number(process.env.USGS_MIN_EVENT_SIGNIFICANCE ?? 600);
  const material = records.filter((record) => (record.magnitude ?? 0) >= minimumMagnitude
    || (record.significance ?? 0) >= minimumSignificance || record.tsunami);
  const sourceId = await ensureUsgsSource();
  let inserted = 0;
  let updated = 0;
  for (const record of material) {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        `INSERT INTO earthquake_observation (
           usgs_event_id,location,latitude,longitude,depth_km,magnitude,magnitude_type,
           place,significance,alert_level,tsunami,felt,observed_at,updated_at_source,
           source_url,raw_payload
         ) VALUES ($1,ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
         ON CONFLICT (usgs_event_id) DO UPDATE SET
           depth_km=EXCLUDED.depth_km,magnitude=EXCLUDED.magnitude,magnitude_type=EXCLUDED.magnitude_type,
           place=EXCLUDED.place,significance=EXCLUDED.significance,alert_level=EXCLUDED.alert_level,
           tsunami=EXCLUDED.tsunami,felt=EXCLUDED.felt,updated_at_source=EXCLUDED.updated_at_source,
           source_url=EXCLUDED.source_url,raw_payload=EXCLUDED.raw_payload,updated_at=now()
         RETURNING id,(xmax=0) AS inserted`,
        [record.eventId, record.latitude, record.longitude, record.depthKm, record.magnitude,
         record.magnitudeType, record.place, record.significance, record.alertLevel,
         record.tsunami, record.felt, record.observedAt, record.updatedAt, record.sourceUrl,
         JSON.stringify(record.payload)],
      );
      if (rows[0].inserted) inserted += 1; else updated += 1;
      await client.query(
        `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
         VALUES ('disaster.earthquake.observed','earthquake_observation',$1,$2,$3::jsonb,$4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [rows[0].id, `usgs:${record.eventId}:${record.updatedAt.getTime()}`,
         JSON.stringify({ earthquake_observation_id: rows[0].id, usgs_event_id: record.eventId, source_id: sourceId }),
         record.observedAt],
      );
    });
  }
  return { provider: "usgs_earthquakes", fetched: records.length, material: material.length, inserted, updated };
}
