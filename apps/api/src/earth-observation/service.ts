import { createHash } from "crypto";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { query, withTransaction, withWorkerLease } from "../db";
import { recomputeIntelligenceEventAggregateTx } from "../intelligence/service";
import {
  buildDiscoveryDedupeKey,
  compatibleCopernicusProducts,
  requestedCopernicusProducts,
  resolveDiscoveryAoi,
} from "./discovery-context";
import {
  EO_VISION_PROMPT_VERSION,
  OpenRouterVisionClient,
  OpenRouterVisionError,
  normalizeVisionDailyLimit,
} from "./openrouter-vision";
import { CopernicusProvider } from "./providers/copernicus";
import { APPROVED_GIBS_LAYERS, buildApprovedGibsEventLayers, gibsStatus } from "./providers/nasa-gibs";
import { NasaFirmsProvider } from "./providers/nasa-firms";
import { rankScenes, selectBeforeAfterPair } from "./scene-ranking";
import type { BoundingBox, EarthProductType, EarthScene } from "./types";
import { hasProcessingBudget } from "./types";

const storage = new Storage();
const copernicus = new CopernicusProvider();
const firms = new NasaFirmsProvider();
const vision = new OpenRouterVisionClient();
let earthWorkerTimer: NodeJS.Timeout | null = null;
let earthWorkerRunning = false;

const flag = (name: string, fallback = false) => {
  const value = process.env[name]?.trim().toLowerCase();
  return value ? ["1", "true", "yes", "on"].includes(value) : fallback;
};

const integerEnv = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
};

const iso = (value: string | Date | null | undefined) => value == null
  ? null
  : (value instanceof Date ? value : new Date(value)).toISOString();

function observationToApi(row: any) {
  return {
    ...row,
    confidence: row.confidence == null ? null : Number(row.confidence),
    scene_rank: row.scene_rank == null ? null : Number(row.scene_rank),
    cloud_cover: row.cloud_cover == null ? null : Number(row.cloud_cover),
    resolution_m: row.resolution_m == null ? null : Number(row.resolution_m),
    captured_at: iso(row.captured_at),
    capture_start: iso(row.capture_start),
    capture_end: iso(row.capture_end),
    assets: Array.isArray(row.assets) ? row.assets.map((asset: any) => ({
      ...asset,
      width: Number(asset.width),
      height: Number(asset.height),
      size_bytes: Number(asset.size_bytes),
      generated_at: iso(asset.generated_at),
      expires_at: iso(asset.expires_at),
    })) : [],
  };
}

async function recordUsage(provider: string, fields: Record<string, number>) {
  const allowed = ["scene_searches", "process_requests", "processing_units", "rendered_pixels", "cache_hits", "bytes_stored", "errors", "rate_limits"];
  const entries = Object.entries(fields).filter(([key, value]) => allowed.includes(key) && Number.isFinite(value) && value !== 0);
  if (!entries.length) return;
  const columns = entries.map(([key]) => key);
  const params: unknown[] = [provider];
  const valueRefs = entries.map(([, value]) => { params.push(value); return `$${params.length}`; });
  await query(
    `INSERT INTO earth_provider_usage (provider, usage_date, ${columns.join(",")})
     VALUES ($1, (now() AT TIME ZONE 'UTC')::date, ${valueRefs.join(",")})
     ON CONFLICT (provider, usage_date) DO UPDATE SET
       ${columns.map((column) => `${column} = earth_provider_usage.${column} + EXCLUDED.${column}`).join(",")},
       updated_at = now()`,
    params,
  );
}

async function updateProviderState(provider: string, result: { success: boolean; event?: boolean; error?: string }) {
  await query(
    `INSERT INTO provider_runtime_state (
       provider, enabled, last_attempt_at, last_success_at, last_event_at,
       consecutive_failures, last_error, updated_at
     ) VALUES ($1,$2,now(),CASE WHEN $3 THEN now() ELSE NULL END,
       CASE WHEN $4 THEN now() ELSE NULL END,CASE WHEN $3 THEN 0 ELSE 1 END,$5,now())
     ON CONFLICT (provider) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       last_attempt_at = now(),
       last_success_at = CASE WHEN $3 THEN now() ELSE provider_runtime_state.last_success_at END,
       last_event_at = CASE WHEN $4 THEN now() ELSE provider_runtime_state.last_event_at END,
       consecutive_failures = CASE WHEN $3 THEN 0 ELSE provider_runtime_state.consecutive_failures + 1 END,
       circuit_open_until = CASE
         WHEN NOT $3 AND provider_runtime_state.consecutive_failures + 1 >= 5 THEN now() + interval '15 minutes'
         WHEN $3 THEN NULL ELSE provider_runtime_state.circuit_open_until END,
       last_error = $5,
       updated_at = now()`,
    [provider, providerEnabled(provider), result.success, Boolean(result.event), result.error ?? null],
  );
}

function providerEnabled(provider: string) {
  if (provider === "copernicus") return flag("EARTH_OBSERVATION_ENABLED") && flag("COPERNICUS_ENABLED");
  if (provider === "nasa_firms") return flag("NASA_FIRMS_ENABLED");
  if (provider === "nasa_gibs") return flag("EARTH_OBSERVATION_ENABLED") && flag("NASA_GIBS_ENABLED");
  if (provider === "openrouter_vision") return flag("EARTH_OBSERVATION_ENABLED") && flag("EO_VISION_ENRICHMENT_ENABLED");
  return false;
}

export async function getEarthObservationStatus() {
  const { rows: runtime } = await query<{
    provider: string;
    enabled: boolean;
    last_attempt_at: string | Date | null;
    last_success_at: string | Date | null;
    last_event_at: string | Date | null;
    consecutive_failures: number;
    circuit_open_until: string | Date | null;
    rate_limited_until: string | Date | null;
    last_error: string | null;
  }>(`SELECT * FROM provider_runtime_state ORDER BY provider`);
  const { rows: usage } = await query(
    `SELECT * FROM earth_provider_usage WHERE usage_date >= current_date - 6 ORDER BY usage_date DESC, provider`,
  );
  const { rows: queue } = await query(
    `SELECT status, count(*)::int AS count, min(created_at) AS oldest
     FROM earth_processing_job GROUP BY status ORDER BY status`,
  );
  const { rows: assets } = await query<{ count: number; size_bytes: string }>(
    `SELECT count(*)::int AS count, COALESCE(sum(size_bytes),0)::text AS size_bytes FROM earth_observation_asset`,
  );
  const { rows: recentJobs } = await query(
    `SELECT job.id,job.job_type,job.provider,job.status,job.attempts,job.max_attempts,
            job.event_id,job.location_id,job.observation_id,job.last_error,
            job.created_at,job.updated_at,location.canonical_name AS location_name
     FROM earth_processing_job job
     LEFT JOIN intelligence_location location ON location.id=job.location_id
     ORDER BY CASE job.status WHEN 'failed' THEN 0 WHEN 'dead_letter' THEN 0 WHEN 'budget_deferred' THEN 1 ELSE 2 END,
              job.updated_at DESC LIMIT 50`,
  );
  const statuses = [copernicus.status(), firms.status(), gibsStatus(), vision.status()].map((status) => {
    const row = runtime.find((entry) => entry.provider === status.provider);
    return {
      ...status,
      ...(row ?? {}),
      enabled: status.enabled,
      state: row?.circuit_open_until && new Date(row.circuit_open_until) > new Date()
        ? "circuit_open"
        : row?.rate_limited_until && new Date(row.rate_limited_until) > new Date()
          ? "rate_limited"
          : status.state,
    };
  });
  return {
    providers: statuses,
    usage,
    queue,
    recent_jobs: recentJobs,
    assets: { count: Number(assets[0]?.count ?? 0), size_bytes: Number(assets[0]?.size_bytes ?? 0) },
    approved_gibs_layers: APPROVED_GIBS_LAYERS,
    budgets: {
      max_daily_processing_units: Number(process.env.EO_MAX_DAILY_PROCESSING_UNITS ?? 100),
      max_daily_vision_requests: normalizeVisionDailyLimit(process.env.EO_VISION_MAX_DAILY_REQUESTS),
      vision_model: vision.model,
      max_width: integerEnv("EO_RENDER_MAX_WIDTH", 1024, 64, 2048),
      max_height: integerEnv("EO_RENDER_MAX_HEIGHT", 1024, 64, 2048),
      max_aoi_square_degrees: Number(process.env.EO_MAX_AOI_SQUARE_DEGREES ?? 25),
      retention_days: integerEnv("EO_ASSET_RETENTION_DAYS", 60, 1, 365),
    },
  };
}

/** Returns only governance-approved, date-specific GIBS layers for an event. */
export async function getGibsEventContext(eventId: string) {
  const status = gibsStatus();
  if (!status.enabled) throw new Error(status.reason ?? "NASA GIBS is disabled.");
  const { rows } = await query<any>(
    `SELECT event.id,event.event_type,event.title,event.start_time,event.last_activity_time,
            event.primary_location_id AS location_id,
            CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END AS event_latitude,
            CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END AS event_longitude,
            location.canonical_name AS location_name,location.bbox AS location_bbox,
            location.latitude AS location_latitude,location.longitude AS location_longitude
     FROM intelligence_event event
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     WHERE event.id=$1::uuid`,
    [eventId],
  );
  const event = rows[0];
  if (!event) return null;
  if (event.event_latitude == null || event.event_longitude == null) {
    throw new Error("NASA GIBS requires valid event geography from an exact source observation; location and country centroids are not substituted.");
  }
  const aoi = resolveDiscoveryAoi({
    eventLatitude: event.event_latitude,
    eventLongitude: event.event_longitude,
  });
  const date = new Date(event.start_time).toISOString().slice(0, 10);
  return {
    provider: "nasa_gibs",
    event_id: event.id,
    event_type: event.event_type,
    event_title: event.title,
    location_id: event.location_id,
    location_name: event.location_name,
    observation_date: date,
    bbox: aoi.bbox,
    aoi_source: aoi.source,
    layers: buildApprovedGibsEventLayers({ date, bbox: aoi.bbox }),
    notice: "GIBS visualizations are contextual browse imagery, not automatic proof of physical change or causation.",
  };
}

export async function listEarthObservations(options: {
  eventId?: string;
  locationId?: string;
  provider?: string;
  product?: EarthProductType;
  limit?: number;
}) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (options.eventId) where.push(`observation.event_id = ${add(options.eventId)}::uuid`);
  if (options.locationId) where.push(`observation.location_id = ${add(options.locationId)}::uuid`);
  if (options.provider) where.push(`scene.provider = ${add(options.provider)}`);
  if (options.product) where.push(`observation.product_type = ${add(options.product)}`);
  const limitRef = add(Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30))));
  const { rows } = await query(
    `SELECT observation.*, scene.provider, scene.mission, scene.collection,
            scene.provider_scene_id, scene.capture_start, scene.capture_end,
            scene.cloud_cover, scene.resolution_m, scene.orbit_direction,
            scene.source_url, scene.bbox,
            location.canonical_name AS location_name,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id', asset.id, 'asset_type', asset.asset_type,
              'mime_type', asset.mime_type, 'width', asset.width, 'height', asset.height,
              'size_bytes', asset.size_bytes, 'generated_at', asset.generated_at,
              'expires_at', asset.expires_at,
              'url', '/api/earth-observation/assets/' || asset.id::text
            ) ORDER BY asset.width) FILTER (WHERE asset.id IS NOT NULL), '[]'::jsonb) AS assets
     FROM earth_observation observation
     JOIN earth_scene scene ON scene.id = observation.scene_id
     LEFT JOIN intelligence_location location ON location.id = observation.location_id
     LEFT JOIN earth_observation_asset asset ON asset.observation_id = observation.id
      AND (asset.expires_at IS NULL OR asset.expires_at > now())
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY observation.id, scene.id, location.id
     ORDER BY scene.capture_start DESC
     LIMIT ${limitRef}`,
    params,
  );
  return rows.map(observationToApi);
}

export async function getEarthScene(sceneId: string) {
  const { rows } = await query(
    `SELECT scene.*,
            COALESCE(jsonb_agg(jsonb_build_object(
              'location_id', linked.location_id, 'rank_score', linked.rank_score,
              'rank_components', linked.rank_components,
              'location_name', location.canonical_name
            )) FILTER (WHERE linked.location_id IS NOT NULL), '[]'::jsonb) AS locations
     FROM earth_scene scene
     LEFT JOIN earth_scene_location linked ON linked.scene_id = scene.id
     LEFT JOIN intelligence_location location ON location.id = linked.location_id
     WHERE scene.id = $1::uuid GROUP BY scene.id`,
    [sceneId],
  );
  return rows[0] ?? null;
}

export async function requestEarthComparison(observationId: string) {
  const { rows } = await query<{
    observation_id: string;
    event_id: string | null;
    location_id: string | null;
    event_time: string | Date;
    scene_id: string;
    provider: string;
    product_type: EarthProductType;
  }>(
    `SELECT observation.id AS observation_id, observation.event_id, observation.location_id,
            COALESCE(event.start_time, observation.captured_at) AS event_time,
            observation.scene_id,observation.product_type,scene.provider
     FROM earth_observation observation
     JOIN earth_scene scene ON scene.id=observation.scene_id
     LEFT JOIN intelligence_event event ON event.id = observation.event_id
     WHERE observation.id = $1::uuid`,
    [observationId],
  );
  const target = rows[0];
  if (!target) return null;
  const sceneRows = await listCandidateSceneRows({
    locationId: target.location_id,
    eventId: target.event_id,
    provider: target.provider,
    product: target.product_type,
    eventTime: new Date(target.event_time),
  });
  const pair = selectBeforeAfterPair(sceneRows, new Date(target.event_time), {
    maxCloudCover: Number(process.env.EO_DEFAULT_CLOUD_THRESHOLD ?? 35),
  });
  if (!pair) return { status: "unavailable", reason: "No defensible before/after pair is currently available." };
  const sceneIds = await query<{ id: string; provider_scene_id: string }>(
    `SELECT id, provider_scene_id FROM earth_scene
     WHERE provider = $1 AND provider_scene_id = ANY($2::text[])`,
    [target.provider, [pair.before.providerSceneId, pair.after.providerSceneId]],
  );
  return {
    status: pair.comparability >= 0.65 ? "available" : "limited_comparability",
    comparability: pair.comparability,
    warnings: pair.warnings,
    before: { ...pair.before, id: sceneIds.rows.find((row) => row.provider_scene_id === pair.before.providerSceneId)?.id },
    after: { ...pair.after, id: sceneIds.rows.find((row) => row.provider_scene_id === pair.after.providerSceneId)?.id },
    notice: "Visual comparison is contextual evidence. Differences in acquisition, cloud and sensor conditions can resemble physical change.",
  };
}

async function listCandidateSceneRows(input: {
  locationId: string | null;
  eventId: string | null;
  provider: string;
  product: EarthProductType;
  eventTime: Date;
}): Promise<EarthScene[]> {
  if (!input.locationId && !input.eventId) return [];
  const { rows } = await query<any>(
    `SELECT DISTINCT scene.* FROM earth_scene scene
     JOIN earth_observation observation ON observation.scene_id=scene.id
     WHERE ($1::uuid IS NULL OR observation.location_id = $1::uuid)
       AND (($2::uuid IS NULL AND observation.event_id IS NULL) OR observation.event_id=$2::uuid)
       AND observation.product_type=$3
       AND scene.provider=$4
       AND observation.status='available'
       AND EXISTS (SELECT 1 FROM earth_observation_asset asset WHERE asset.observation_id=observation.id)
       AND scene.capture_start BETWEEN $5::timestamptz - interval '180 days' AND $5::timestamptz + interval '60 days'
     ORDER BY scene.capture_start`,
    [input.locationId, input.eventId, input.product, input.provider, input.eventTime],
  );
  return rows.map(sceneFromDb);
}

function sceneFromDb(row: any): EarthScene {
  return {
    provider: row.provider,
    mission: row.mission,
    collection: row.collection,
    providerSceneId: row.provider_scene_id,
    captureStart: new Date(row.capture_start),
    captureEnd: row.capture_end ? new Date(row.capture_end) : null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    bbox: (row.bbox as number[]).map(Number) as BoundingBox,
    cloudCover: row.cloud_cover == null ? null : Number(row.cloud_cover),
    resolutionM: row.resolution_m == null ? null : Number(row.resolution_m),
    orbitDirection: row.orbit_direction,
    sourceUrl: row.source_url,
    license: row.license,
    attribution: row.attribution,
    quality: row.quality ?? {},
    rawMetadata: row.raw_metadata ?? {},
  };
}

export async function getEarthAssetBuffer(assetId: string) {
  const { rows } = await query<{ mime_type: string; gcs_object: string; etag: string | null; content_hash: string; expires_at: string | Date | null }>(
    `SELECT mime_type, gcs_object, etag, content_hash, expires_at
     FROM earth_observation_asset WHERE id = $1::uuid`,
    [assetId],
  );
  const asset = rows[0];
  if (!asset || (asset.expires_at && new Date(asset.expires_at) <= new Date())) return null;
  const bucketName = process.env.EO_ASSET_BUCKET?.trim();
  if (!bucketName) throw new Error("Earth Observation asset storage is not configured.");
  const [bytes] = await storage.bucket(bucketName).file(asset.gcs_object).download();
  return { bytes, mimeType: asset.mime_type, etag: asset.etag ?? asset.content_hash };
}

async function saveScene(scene: EarthScene) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO earth_scene (
       provider, mission, collection, provider_scene_id, capture_start,
       capture_end, published_at, geometry, bbox, cloud_cover, resolution_m,
       orbit_direction, quality, source_url, license, attribution, raw_metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,
       CASE WHEN $8::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($8::text),4326) END,
       $9::double precision[],$10,$11,$12,$13::jsonb,$14,$15,$16,$17::jsonb)
     ON CONFLICT (provider, collection, provider_scene_id) DO UPDATE SET
       published_at = COALESCE(EXCLUDED.published_at, earth_scene.published_at),
       quality = earth_scene.quality || EXCLUDED.quality,
       raw_metadata = EXCLUDED.raw_metadata
     RETURNING id`,
    [scene.provider, scene.mission, scene.collection, scene.providerSceneId, scene.captureStart,
     scene.captureEnd ?? null, scene.publishedAt ?? null,
     scene.geometry ? JSON.stringify(scene.geometry) : null, scene.bbox,
     scene.cloudCover ?? null, scene.resolutionM ?? null, scene.orbitDirection ?? null,
     JSON.stringify(scene.quality), scene.sourceUrl, scene.license, scene.attribution,
     JSON.stringify(scene.rawMetadata)],
  );
  return rows[0].id;
}

async function scheduleDiscoveryRevisit(job: any, eventTime: Date) {
  if (!job.event_id) return false;
  const currentRevisit = Math.max(0, Math.trunc(Number(job.parameters?.revisit_number ?? 0)) || 0);
  const maximumRevisits = integerEnv("EO_MAX_REVISITS_PER_EVENT", 2, 0, 7);
  if (currentRevisit >= maximumRevisits) return false;
  const nextRevisit = currentRevisit + 1;
  const revisitHours = integerEnv("EO_REVISIT_INTERVAL_HOURS", 24, 6, 168);
  const availableAt = new Date(Date.now() + revisitHours * 3_600_000);
  const configuredWindow = typeof job.parameters?.discovery_window === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(job.parameters.discovery_window)
    ? job.parameters.discovery_window
    : new Date(job.created_at ?? Date.now()).toISOString().slice(0, 10);
  const discoverySeries = typeof job.parameters?.discovery_series === "string"
    ? job.parameters.discovery_series
    : job.parameters?.requested_by === "admin" ? "admin" : "signal";
  const dedupeKey = buildDiscoveryDedupeKey({
    eventId: job.event_id,
    locationId: job.location_id ?? null,
    revisitNumber: nextRevisit,
    discoverySeries,
    discoveryWindow: configuredWindow,
  });
  const { rows } = await query(
    `INSERT INTO earth_processing_job (
       dedupe_key,job_type,provider,event_id,location_id,priority,max_attempts,available_at,parameters
     )
     SELECT $1,'scene_discovery','copernicus',event.id,$2::uuid,$3,3,$4,$5::jsonb
     FROM intelligence_event event
     WHERE event.id=$6::uuid AND event.status IN ('emerging','active','monitoring')
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [dedupeKey, job.location_id ?? null, Math.min(100, Number(job.priority ?? 20) + 5), availableAt,
     JSON.stringify({
       event_time: eventTime.toISOString(),
       revisit_number: nextRevisit,
       discovery_series: discoverySeries,
       discovery_window: configuredWindow,
       requested_products: job.parameters?.requested_products ?? ["true_color"],
       prefer_sar: Boolean(job.parameters?.prefer_sar),
       reason: "bounded_event_revisit",
     }), job.event_id],
  );
  return rows.length > 0;
}

async function processSceneDiscovery(job: any) {
  const providerStatus = copernicus.status();
  if (!providerStatus.enabled || !providerStatus.configured) throw new Error(providerStatus.reason ?? "Copernicus is unavailable.");
  const { rows } = await query<any>(
    `SELECT location.id,location.bbox,location.latitude,location.longitude,
            location.monitoring_tier,location.importance_score,
            CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END AS event_latitude,
            CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END AS event_longitude
     FROM (SELECT $1::uuid AS requested_location_id,$2::uuid AS event_id) requested
     LEFT JOIN intelligence_event event ON event.id=requested.event_id
     LEFT JOIN intelligence_location location
       ON location.id=COALESCE(requested.requested_location_id,event.primary_location_id)
      AND location.active
     WHERE event.id IS NOT NULL OR location.id IS NOT NULL`,
    [job.location_id, job.event_id ?? null],
  );
  const location = rows[0];
  if (!location) throw new Error("Earth Observation job has neither a valid event nor a valid location.");
  const eventAoiRequired = Boolean(job.event_id);
  if (eventAoiRequired && (location.event_latitude == null || location.event_longitude == null)) {
    throw new Error("Event Earth Observation requires valid event geography from an exact source observation; location and country centroids are not substituted.");
  }
  const aoi = eventAoiRequired
    ? resolveDiscoveryAoi({
        eventLatitude: location.event_latitude,
        eventLongitude: location.event_longitude,
      })
    : resolveDiscoveryAoi({
        locationBbox: location.bbox,
        locationLatitude: location.latitude,
        locationLongitude: location.longitude,
      });
  const bbox: BoundingBox = aoi.bbox;
  const eventTime = new Date(job.parameters?.event_time ?? Date.now());
  const end = new Date(Math.min(Date.now(), eventTime.getTime() + 60 * 86_400_000));
  const start = new Date(eventTime.getTime() - 180 * 86_400_000);
  const scenes = await copernicus.discoverScenes({
    bbox, start, end, eventTime, collections: ["sentinel-2-l2a", "sentinel-1-grd"], limit: 50,
  });
  await recordUsage("copernicus", { scene_searches: 1 });
  const ranked = rankScenes(scenes, {
    eventTime,
    maxCloudCover: Number(process.env.EO_DEFAULT_CLOUD_THRESHOLD ?? 35),
    preferredCollections: job.parameters?.prefer_sar ? ["sentinel-1-grd", "sentinel-2-l2a"] : undefined,
  });
  const requestedProducts = requestedCopernicusProducts(job.parameters?.requested_products);
  const maximumScenes = integerEnv("EO_MAX_SCENES_PER_DISCOVERY", 4, 1, 10);
  const eligible = ranked.filter((entry) => (
    !entry.rejectedReason
      && compatibleCopernicusProducts(entry.scene.collection, requestedProducts).length > 0
  ));
  const requestedCollections = [
    ...(requestedProducts.includes("sar") ? ["sentinel-1-grd"] : []),
    ...(requestedProducts.some((product) => product !== "sar") ? ["sentinel-2-l2a"] : []),
  ];
  const selected = requestedCollections
    .flatMap((collection) => eligible
      .filter((entry) => entry.scene.collection === collection)
      .slice(0, Math.max(1, Math.floor(maximumScenes / requestedCollections.length))))
    .slice(0, maximumScenes);
  for (const entry of eligible) {
    if (selected.length >= maximumScenes) break;
    if (!selected.includes(entry)) selected.push(entry);
  }
  for (const rankedScene of ranked) {
    const sceneId = await saveScene(rankedScene.scene);
    if (location.id) {
      await query(
        `INSERT INTO earth_scene_location (scene_id, location_id, rank_score, rank_components)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (scene_id, location_id) DO UPDATE SET rank_score=EXCLUDED.rank_score, rank_components=EXCLUDED.rank_components`,
        [sceneId, location.id, rankedScene.score, JSON.stringify({
          ...rankedScene.components,
          aoi_source: aoi.source,
          aoi_center: aoi.center,
        })],
      );
    }
    if (!selected.includes(rankedScene)) continue;
    for (const product of compatibleCopernicusProducts(rankedScene.scene.collection, requestedProducts)) {
      const { rows: observations } = await query<{ id: string }>(
        `INSERT INTO earth_observation (
           scene_id, location_id, event_id, product_type, captured_at,
           quality, methodology, attribution, license
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
         ON CONFLICT (scene_id, location_id, event_id, product_type) DO UPDATE SET
           quality = earth_observation.quality || EXCLUDED.quality,
           methodology = earth_observation.methodology || EXCLUDED.methodology
         RETURNING id`,
        [sceneId, location.id ?? null, job.event_id, product, rankedScene.scene.captureStart,
         JSON.stringify({ cloud_cover: rankedScene.scene.cloudCover, rank_score: rankedScene.score }),
         JSON.stringify({
           kind: "provider_render",
           requested_products: requestedProducts,
           rank_components: rankedScene.components,
           aoi_source: aoi.source,
           aoi_center: aoi.center,
           epistemic_class: "observed_physical_signal",
         }),
         rankedScene.scene.attribution, rankedScene.scene.license],
      );
      const observationId = observations[0].id;
      await query(
        `INSERT INTO earth_processing_job (
           dedupe_key, job_type, provider, event_id, location_id, scene_id,
           observation_id, priority, parameters
         ) VALUES ($1,'render','copernicus',$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [`render:${observationId}:preview`, job.event_id, location.id ?? null, sceneId, observationId,
         job.priority, JSON.stringify({ product, width: 1024, height: 768 })],
      );
    }
  }
  await updateProviderState("copernicus", { success: true, event: selected.length > 0 });
  const revisitScheduled = await scheduleDiscoveryRevisit(job, eventTime);
  return {
    scenes_found: scenes.length,
    scenes_selected: selected.length,
    requested_products: requestedProducts,
    observations_queued: selected.reduce((count, entry) => (
      count + compatibleCopernicusProducts(entry.scene.collection, requestedProducts).length
    ), 0),
    aoi_source: aoi.source,
    revisit_scheduled: revisitScheduled,
  };
}

async function processRender(job: any) {
  const bucketName = process.env.EO_ASSET_BUCKET?.trim();
  if (!bucketName) throw new Error("EO_ASSET_BUCKET is not configured.");
  const { rows } = await query<any>(
    `SELECT observation.id, observation.event_id, observation.product_type, scene.collection,
            scene.capture_start, scene.capture_end,
            location.bbox AS location_bbox,
            location.latitude AS location_latitude,
            location.longitude AS location_longitude,
            CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END AS event_latitude,
            CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END AS event_longitude
     FROM earth_observation observation
     JOIN earth_scene scene ON scene.id = observation.scene_id
     LEFT JOIN intelligence_location location ON location.id=observation.location_id
     LEFT JOIN intelligence_event event ON event.id=observation.event_id
     WHERE observation.id = $1::uuid`,
    [job.observation_id],
  );
  const target = rows[0];
  if (!target) throw new Error("Earth observation no longer exists.");
  if (target.event_id && (target.event_latitude == null || target.event_longitude == null)) {
    throw new Error("Event Earth Observation render requires valid event geography from an exact source observation; location and country centroids are not substituted.");
  }
  const renderAoi = target.event_id
    ? resolveDiscoveryAoi({
        eventLatitude: target.event_latitude,
        eventLongitude: target.event_longitude,
      })
    : resolveDiscoveryAoi({
        locationBbox: target.location_bbox,
        locationLatitude: target.location_latitude,
        locationLongitude: target.location_longitude,
      });
  const { rows: usageRows } = await query<{ daily_processing_units: number; monthly_processing_units: number }>(
    `SELECT
       COALESCE(sum(processing_units) FILTER (WHERE usage_date=(now() AT TIME ZONE 'UTC')::date),0)::double precision AS daily_processing_units,
       COALESCE(sum(processing_units) FILTER (
         WHERE usage_date >= date_trunc('month',now() AT TIME ZONE 'UTC')::date
           AND usage_date < (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')::date
       ),0)::double precision AS monthly_processing_units
     FROM earth_provider_usage
     WHERE provider='copernicus'
       AND usage_date >= date_trunc('month',now() AT TIME ZONE 'UTC')::date`,
  );
  const dailyUsed = Number(usageRows[0]?.daily_processing_units ?? 0);
  const monthlyUsed = Number(usageRows[0]?.monthly_processing_units ?? 0);
  const dailyBudget = Math.max(0, Number(process.env.EO_MAX_DAILY_PROCESSING_UNITS ?? 100));
  const monthlyBudget = Math.max(0, Number(process.env.EO_MAX_MONTHLY_PROCESSING_UNITS ?? 3_000));
  const estimatedUnits = integerEnv("EO_ESTIMATED_PROCESSING_UNITS_PER_RENDER", 4, 1, 25);
  const dailyAvailable = hasProcessingBudget(dailyUsed, dailyBudget, estimatedUnits);
  const monthlyAvailable = hasProcessingBudget(monthlyUsed, monthlyBudget, estimatedUnits);
  if (!dailyAvailable || !monthlyAvailable) {
    const monthly = !monthlyAvailable;
    const { rows: deferred } = await query<{ available_at: string | Date }>(
      `UPDATE earth_processing_job SET
         status='budget_deferred',attempts=GREATEST(attempts-1,0),
         available_at=CASE WHEN $2
           THEN (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC'
           ELSE (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'
         END,
         last_error=$3,started_at=NULL,finished_at=NULL,updated_at=now()
       WHERE id=$1 RETURNING available_at`,
      [job.id, monthly, monthly
        ? `Monthly processing-unit ceiling (${monthlyBudget}) reached.`
        : `Daily processing-unit ceiling (${dailyBudget}) reached.`],
    );
    return {
      budget_deferred: true,
      budget_period: monthly ? "month" : "day",
      available_at: iso(deferred[0]?.available_at),
      daily_used: dailyUsed,
      monthly_used: monthlyUsed,
    };
  }
  await query(`UPDATE earth_observation SET status='processing', updated_at=now() WHERE id=$1`, [target.id]);
  const rendered = await copernicus.render({
    bbox: renderAoi.bbox,
    start: new Date(target.capture_start),
    end: target.capture_end ? new Date(target.capture_end) : new Date(new Date(target.capture_start).getTime() + 86_400_000),
    collection: target.collection,
    product: target.product_type,
    width: integerEnv("EO_RENDER_MAX_WIDTH", Number(job.parameters?.width ?? 1024), 64, 2048),
    height: integerEnv("EO_RENDER_MAX_HEIGHT", Number(job.parameters?.height ?? 768), 64, 2048),
    maxCloudCoverage: Number(process.env.EO_DEFAULT_CLOUD_THRESHOLD ?? 35),
  });
  const retentionDays = integerEnv("EO_ASSET_RETENTION_DAYS", 60, 1, 365);
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);
  const previewObject = `observations/${target.id}/preview.png`;
  const thumbnailObject = `observations/${target.id}/thumbnail.webp`;
  const thumbnail = await sharp(rendered.bytes).resize({ width: 480, height: 320, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
  const bucket = storage.bucket(bucketName);
  await Promise.all([
    bucket.file(previewObject).save(rendered.bytes, { resumable: false, contentType: rendered.mimeType, metadata: { cacheControl: "private,max-age=86400" } }),
    bucket.file(thumbnailObject).save(thumbnail.data, { resumable: false, contentType: "image/webp", metadata: { cacheControl: "private,max-age=86400" } }),
  ]);
  const previewHash = createHash("sha256").update(rendered.bytes).digest("hex");
  const thumbnailHash = createHash("sha256").update(thumbnail.data).digest("hex");
  await withTransaction(async (client) => {
    for (const asset of [
      { type: "preview", mime: rendered.mimeType, width: rendered.width, height: rendered.height, object: previewObject, hash: previewHash, size: rendered.bytes.length },
      { type: "thumbnail", mime: "image/webp", width: thumbnail.info.width, height: thumbnail.info.height, object: thumbnailObject, hash: thumbnailHash, size: thumbnail.data.length },
    ]) {
      await client.query(
        `INSERT INTO earth_observation_asset (
           observation_id, asset_type, mime_type, width, height, gcs_object,
           content_hash, size_bytes, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (observation_id, asset_type) DO UPDATE SET
           mime_type=EXCLUDED.mime_type,width=EXCLUDED.width,height=EXCLUDED.height,
           gcs_object=EXCLUDED.gcs_object,content_hash=EXCLUDED.content_hash,
           size_bytes=EXCLUDED.size_bytes,generated_at=now(),expires_at=EXCLUDED.expires_at`,
        [target.id, asset.type, asset.mime, asset.width, asset.height, asset.object, asset.hash, asset.size, expiresAt],
      );
    }
    await client.query(`UPDATE earth_observation SET status='available', generated_at=now(), last_error=NULL, updated_at=now() WHERE id=$1`, [target.id]);
    await client.query(
      `INSERT INTO intelligence_event_evidence (
         event_id, domain, evidence_type, source_record_type, source_record_id,
         observed_at, location_id, confidence, relationship, provenance,
         license, attribution, metadata
       )
       SELECT observation.event_id, 'earth_observation', observation.product_type,
              'earth_observation', observation.id::text,
              observation.captured_at, observation.location_id, 0.9, 'observed',
              jsonb_build_object(
                'scene_id',observation.scene_id,
                'provider_scene_id',scene.provider_scene_id,
                'provider',scene.provider,
                'mission',scene.mission,
                'collection',scene.collection,
                'source_diversity_key',concat_ws(':',scene.provider,scene.mission,scene.collection),
                'analysis_kind',observation.analysis_kind
              ),
              observation.license, observation.attribution,
              jsonb_build_object('observation_id',observation.id)
       FROM earth_observation observation
       JOIN earth_scene scene ON scene.id=observation.scene_id
       WHERE observation.id=$1 AND observation.event_id IS NOT NULL
       ON CONFLICT (event_id, domain, source_record_type, source_record_id) DO NOTHING`,
      [target.id],
    );
    if (target.event_id) await recomputeIntelligenceEventAggregateTx(client, target.event_id);
    await client.query(
      `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
       SELECT 'earth.scene.available','earth_observation',id,$2,
              jsonb_build_object('observation_id',id,'event_id',event_id,'location_id',location_id,'scene_id',scene_id,'product_type',product_type),
              now()
       FROM earth_observation WHERE id=$1
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [target.id, `earth-scene-available:${target.id}`],
    );
  });
  await recordUsage("copernicus", {
    process_requests: 1,
    processing_units: rendered.processingUnits ?? 0,
    rendered_pixels: rendered.width * rendered.height,
    bytes_stored: rendered.bytes.length + thumbnail.data.length,
  });
  await updateProviderState("copernicus", { success: true, event: true });
  let visionEnqueued = false;
  if (providerEnabled("openrouter_vision")
      && ["true_color", "false_color", "sar"].includes(target.product_type)) {
    try {
      visionEnqueued = await enqueueVisionEnrichment(job, target.id);
    } catch (error) {
      // A model interpretation is optional secondary evidence. Its queue must
      // never make the physical observation render fail after assets commit.
      console.error(JSON.stringify({
        event: "earth_vision_enqueue_failed",
        observation_id: target.id,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    observation_id: target.id,
    bytes_stored: rendered.bytes.length + thumbnail.data.length,
    aoi_source: renderAoi.source,
    vision_enqueued: visionEnqueued,
  };
}

async function enqueueVisionEnrichment(job: any, observationId: string) {
  const { rows } = await query(
    `INSERT INTO earth_processing_job (
       dedupe_key,job_type,provider,event_id,location_id,scene_id,
       observation_id,priority,max_attempts,parameters
     ) VALUES ($1,'vision_enrichment','openrouter_vision',$2,$3,$4,$5,$6,2,$7::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [`vision:${observationId}:${EO_VISION_PROMPT_VERSION}`, job.event_id ?? null,
     job.location_id ?? null, job.scene_id ?? null, observationId,
     Math.min(100, Math.max(1, Number(job.priority ?? 20) + 10)),
     JSON.stringify({ prompt_version: EO_VISION_PROMPT_VERSION, source_asset_type: "preview" })],
  );
  return rows.length > 0;
}

async function reserveVisionRequest() {
  const dailyLimit = normalizeVisionDailyLimit(process.env.EO_VISION_MAX_DAILY_REQUESTS);
  if (dailyLimit <= 0) return { reserved: false, dailyLimit };
  const { rows } = await query<{ process_requests: number }>(
    `INSERT INTO earth_provider_usage (provider,usage_date,process_requests)
     VALUES ('openrouter_vision',(now() AT TIME ZONE 'UTC')::date,1)
     ON CONFLICT (provider,usage_date) DO UPDATE SET
       process_requests=earth_provider_usage.process_requests+1,
       updated_at=now()
     WHERE earth_provider_usage.process_requests < $1
     RETURNING process_requests`,
    [dailyLimit],
  );
  return { reserved: rows.length > 0, dailyLimit, used: Number(rows[0]?.process_requests ?? dailyLimit) };
}

async function deferVisionUntilNextUtcDay(jobId: string, dailyLimit: number) {
  const { rows } = await query<{ available_at: string | Date }>(
    `UPDATE earth_processing_job SET
       status='queued',attempts=GREATEST(attempts-1,0),
       available_at=(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC',
       last_error=$2,started_at=NULL,finished_at=NULL,updated_at=now()
     WHERE id=$1 RETURNING available_at`,
    [jobId, `Daily free EO vision request cap (${dailyLimit}) reached.`],
  );
  return iso(rows[0]?.available_at) ?? new Date(Date.now() + 86_400_000).toISOString();
}

const boundedContextText = (value: unknown, maxLength: number) => typeof value === "string"
  ? value.trim().slice(0, maxLength)
  : null;

async function processVisionEnrichment(job: any) {
  const providerStatus = vision.status();
  if (!providerStatus.enabled) return { skipped: true, reason: providerStatus.reason ?? "EO vision is disabled." };
  if (!providerStatus.configured) throw new OpenRouterVisionError(providerStatus.reason ?? "EO vision is unavailable.", 503, false);
  const { rows } = await query<any>(
    `SELECT observation.id,observation.status,observation.event_id,observation.location_id,
            observation.scene_id,observation.product_type,observation.captured_at,
            observation.attribution,observation.license,
            scene.provider_scene_id,scene.mission,scene.collection,scene.cloud_cover,scene.resolution_m,
            event.event_type,event.title AS event_title,event.summary AS event_summary,event.severity,
            asset.gcs_object,asset.mime_type,asset.size_bytes
     FROM earth_observation observation
     JOIN earth_scene scene ON scene.id=observation.scene_id
     LEFT JOIN intelligence_event event ON event.id=observation.event_id
     LEFT JOIN earth_observation_asset asset
       ON asset.observation_id=observation.id AND asset.asset_type='preview'
     WHERE observation.id=$1::uuid`,
    [job.observation_id],
  );
  const target = rows[0];
  if (!target) throw new OpenRouterVisionError("Earth observation no longer exists.", 404, false);
  if (target.status !== "available") throw new OpenRouterVisionError("EO vision requires an available physical observation.", 409, true);
  if (!target.gcs_object) throw new OpenRouterVisionError("EO vision preview asset is unavailable.", 404, true);
  const bucketName = process.env.EO_ASSET_BUCKET?.trim();
  if (!bucketName) throw new OpenRouterVisionError("EO_ASSET_BUCKET is not configured.", 503, false);
  const maxSourceBytes = integerEnv("EO_VISION_MAX_IMAGE_BYTES", 8 * 1_024 * 1_024, 256 * 1_024, 12 * 1_024 * 1_024);
  if (Number(target.size_bytes) > maxSourceBytes) {
    throw new OpenRouterVisionError(`EO vision preview exceeds the ${maxSourceBytes}-byte input limit.`, 413, false);
  }
  const [sourceImage] = await storage.bucket(bucketName).file(target.gcs_object).download();
  if (sourceImage.length > maxSourceBytes) {
    throw new OpenRouterVisionError(`EO vision preview exceeds the ${maxSourceBytes}-byte input limit.`, 413, false);
  }
  const image = await sharp(sourceImage)
    .rotate()
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const budget = await reserveVisionRequest();
  if (!budget.reserved) {
    const availableAt = await deferVisionUntilNextUtcDay(job.id, budget.dailyLimit);
    return { budget_deferred: true, available_at: availableAt, daily_limit: budget.dailyLimit };
  }
  const response = await vision.interpret({
    image,
    mimeType: "image/jpeg",
    context: {
      event_type: boundedContextText(target.event_type, 80),
      event_title: boundedContextText(target.event_title, 240),
      event_summary: boundedContextText(target.event_summary, 800),
      severity: boundedContextText(target.severity, 20),
      product_type: target.product_type,
      captured_at: iso(target.captured_at),
      provider_scene_id: target.provider_scene_id,
      mission: target.mission,
      collection: target.collection,
      cloud_cover: target.cloud_cover == null ? null : Number(target.cloud_cover),
      resolution_m: target.resolution_m == null ? null : Number(target.resolution_m),
      epistemic_class: "model_interpretation_of_observed_physical_signal",
    },
  });
  const interpretationRecord = {
    ...response.interpretation,
    provider: "openrouter",
    requested_model: response.requestedModel,
    actual_model: response.actualModel,
    prompt_version: EO_VISION_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    epistemic_class: "model_interpretation",
  };
  const confidence = Math.min(0.75, response.interpretation.confidence);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE earth_observation SET
         methodology=methodology || jsonb_build_object('vision_enrichment',$2::jsonb),
         analysis_summary=$3,
         analysis_details=analysis_details || jsonb_build_object('model_interpretation',$2::jsonb),
         updated_at=now()
       WHERE id=$1 AND status='available'`,
      [target.id, JSON.stringify(interpretationRecord), response.interpretation.summary],
    );
    if (target.event_id) {
      await client.query(
        `INSERT INTO intelligence_event_evidence (
           event_id,domain,evidence_type,source_record_type,source_record_id,
           observed_at,published_at,location_id,confidence,relationship,provenance,
           license,attribution,correlation_score,correlation_factors,metadata
         ) VALUES (
           $1,'earth_observation','model_interpretation','earth_observation_vision',$2,
           $3,now(),$4,$5,'model_interpretation',$6::jsonb,
           $7,$8,$5,jsonb_build_object('method','same_observation_event'),$9::jsonb
         )
         ON CONFLICT (event_id,domain,source_record_type,source_record_id) DO UPDATE SET
           published_at=EXCLUDED.published_at,confidence=EXCLUDED.confidence,
           provenance=EXCLUDED.provenance,attribution=EXCLUDED.attribution,
           correlation_score=EXCLUDED.correlation_score,metadata=EXCLUDED.metadata`,
        [target.event_id, `${target.id}:${EO_VISION_PROMPT_VERSION}`, target.captured_at,
         target.location_id, confidence,
         JSON.stringify({
           provider: "openrouter",
           requested_model: response.requestedModel,
           actual_model: response.actualModel,
           prompt_version: EO_VISION_PROMPT_VERSION,
           observation_id: target.id,
           scene_id: target.scene_id,
           provider_scene_id: target.provider_scene_id,
         }), target.license,
         `Model interpretation via OpenRouter (${response.actualModel}); ${target.attribution}`,
         JSON.stringify(interpretationRecord)],
      );
      await recomputeIntelligenceEventAggregateTx(client, target.event_id);
      await client.query(
        `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
         VALUES ('earth.vision.available','earth_observation',$1,$2,$3::jsonb,now())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [target.id, `earth-vision-available:${target.id}:${EO_VISION_PROMPT_VERSION}`,
         JSON.stringify({
           observation_id: target.id,
           event_id: target.event_id,
           location_id: target.location_id,
           relationship: "model_interpretation",
           actual_model: response.actualModel,
           prompt_version: EO_VISION_PROMPT_VERSION,
         })],
      );
    }
  });
  await updateProviderState("openrouter_vision", { success: true, event: Boolean(target.event_id) });
  return {
    observation_id: target.id,
    actual_model: response.actualModel,
    requested_model: response.requestedModel,
    confidence,
    prompt_version: EO_VISION_PROMPT_VERSION,
  };
}

async function claimEarthJob() {
  return withTransaction(async (client) => {
    const { rows } = await client.query<any>(
      `WITH candidate AS (
         SELECT id FROM earth_processing_job
         WHERE status IN ('queued','failed','budget_deferred') AND available_at <= now() AND attempts < max_attempts
         ORDER BY priority, available_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE earth_processing_job job SET status='running', attempts=attempts+1,
              started_at=now(), last_error=NULL, updated_at=now()
       FROM candidate WHERE job.id=candidate.id RETURNING job.*`,
    );
    return rows[0] ?? null;
  });
}

async function finishEarthJob(jobId: string, result: Record<string, unknown>) {
  await query(`UPDATE earth_processing_job SET status='success', result=$2::jsonb, finished_at=now(), updated_at=now() WHERE id=$1`, [jobId, JSON.stringify(result)]);
}

async function failEarthJob(job: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const providerError = error instanceof OpenRouterVisionError ? error : null;
  const dead = providerError?.retryable === false || job.attempts >= job.max_attempts;
  const backoffSeconds = Math.min(3_600, 15 * (2 ** Math.max(0, job.attempts - 1)));
  await query(
    `UPDATE earth_processing_job SET status=$2, last_error=$3,
            available_at=now()+make_interval(secs=>$4), finished_at=CASE WHEN $2='dead_letter' THEN now() ELSE NULL END,
            updated_at=now() WHERE id=$1`,
    [job.id, dead ? "dead_letter" : "failed", message.slice(0, 2_000), backoffSeconds],
  );
  // A failed interpretation is secondary evidence, never a failed satellite
  // acquisition. Preserve the already-available physical observation.
  if (job.observation_id && job.job_type !== "vision_enrichment") {
    await query(`UPDATE earth_observation SET status='failed',last_error=$2,updated_at=now() WHERE id=$1`, [job.observation_id, message.slice(0, 2_000)]);
  }
  const rateLimited = providerError?.status === 429;
  await recordUsage(job.provider, { errors: 1, rate_limits: rateLimited ? 1 : 0 });
  await updateProviderState(job.provider, { success: false, error: message.slice(0, 500) });
  if (rateLimited) {
    await query(
      `UPDATE provider_runtime_state SET rate_limited_until=now()+interval '15 minutes',updated_at=now()
       WHERE provider=$1`,
      [job.provider],
    );
  }
}

async function runEarthWorkerCycle() {
  if (!flag("EARTH_OBSERVATION_ENABLED")) return;
  const maxJobs = integerEnv("EO_WORKER_BATCH_SIZE", 2, 1, 10);
  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimEarthJob();
    if (!job) return;
    try {
      const result = job.job_type === "scene_discovery"
        ? await processSceneDiscovery(job)
        : job.job_type === "render"
          ? await processRender(job)
          : job.job_type === "vision_enrichment"
            ? await processVisionEnrichment(job)
            : { skipped: true, reason: `Unsupported job type ${job.job_type}.` };
      if (!("budget_deferred" in result && result.budget_deferred)) await finishEarthJob(job.id, result);
    } catch (error) {
      await failEarthJob(job, error);
    }
  }
}

export function startEarthObservationWorker() {
  if (earthWorkerTimer || !flag("EARTH_OBSERVATION_ENABLED")) return;
  const intervalMs = integerEnv("EO_WORKER_POLL_SECONDS", 20, 5, 300) * 1_000;
  const tick = () => {
    if (earthWorkerRunning) return;
    earthWorkerRunning = true;
    void withWorkerLease("earth-observation", 180, runEarthWorkerCycle)
      .catch((error) => console.error(JSON.stringify({ event: "earth_observation_worker_failed", message: error instanceof Error ? error.message : String(error) })))
      .finally(() => { earthWorkerRunning = false; });
  };
  tick();
  earthWorkerTimer = setInterval(tick, intervalMs);
  earthWorkerTimer.unref();
}

export async function enqueueEarthDiscovery(locationId: string, eventId?: string | null, force = false) {
  const discoveryWindow = new Date().toISOString().slice(0, 10);
  const dedupe = buildDiscoveryDedupeKey({
    eventId,
    locationId,
    discoverySeries: "admin",
    discoveryWindow,
  });
  const { rows } = await query(
    `INSERT INTO earth_processing_job (dedupe_key,job_type,provider,event_id,location_id,priority,parameters)
     VALUES ($1,'scene_discovery','copernicus',$2::uuid,$3::uuid,20,$4::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       status=CASE WHEN $5 THEN 'queued' ELSE earth_processing_job.status END,
       attempts=CASE WHEN $5 THEN 0 ELSE earth_processing_job.attempts END,
       available_at=CASE WHEN $5 THEN now() ELSE earth_processing_job.available_at END,
       last_error=CASE WHEN $5 THEN NULL ELSE earth_processing_job.last_error END,
       parameters=CASE WHEN $5 THEN EXCLUDED.parameters ELSE earth_processing_job.parameters END,
       updated_at=now()
     RETURNING *`,
    [dedupe, eventId ?? null, locationId, JSON.stringify({
      requested_by: "admin",
      requested_at: new Date().toISOString(),
      discovery_series: "admin",
      discovery_window: discoveryWindow,
    }), force],
  );
  return rows[0];
}
