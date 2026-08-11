import { createHash } from "crypto";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { query, withTransaction, withWorkerLease } from "../db";
import { CopernicusProvider } from "./providers/copernicus";
import { APPROVED_GIBS_LAYERS, gibsStatus } from "./providers/nasa-gibs";
import { NasaFirmsProvider } from "./providers/nasa-firms";
import { rankScenes, selectBeforeAfterPair } from "./scene-ranking";
import type { BoundingBox, EarthProductType, EarthScene } from "./types";
import { boundBoundingBox, hasProcessingBudget, validateBoundingBox } from "./types";

const storage = new Storage();
const copernicus = new CopernicusProvider();
const firms = new NasaFirmsProvider();
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
     VALUES ($1, current_date, ${valueRefs.join(",")})
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
  const statuses = [copernicus.status(), firms.status(), gibsStatus()].map((status) => {
    const row = runtime.find((entry) => entry.provider === status.provider);
    return {
      ...status,
      ...(row ?? {}),
      enabled: status.enabled,
      state: row?.circuit_open_until && new Date(row.circuit_open_until) > new Date() ? "circuit_open" : status.state,
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
      max_width: integerEnv("EO_RENDER_MAX_WIDTH", 1024, 64, 2048),
      max_height: integerEnv("EO_RENDER_MAX_HEIGHT", 1024, 64, 2048),
      max_aoi_square_degrees: Number(process.env.EO_MAX_AOI_SQUARE_DEGREES ?? 25),
      retention_days: integerEnv("EO_ASSET_RETENTION_DAYS", 60, 1, 365),
    },
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
  }>(
    `SELECT observation.id AS observation_id, observation.event_id, observation.location_id,
            COALESCE(event.start_time, observation.captured_at) AS event_time,
            observation.scene_id
     FROM earth_observation observation
     LEFT JOIN intelligence_event event ON event.id = observation.event_id
     WHERE observation.id = $1::uuid`,
    [observationId],
  );
  const target = rows[0];
  if (!target) return null;
  const sceneRows = await listCandidateSceneRows(target.location_id, new Date(target.event_time));
  const pair = selectBeforeAfterPair(sceneRows, new Date(target.event_time), {
    maxCloudCover: Number(process.env.EO_DEFAULT_CLOUD_THRESHOLD ?? 35),
  });
  if (!pair) return { status: "unavailable", reason: "No defensible before/after pair is currently available." };
  const sceneIds = await query<{ id: string; provider_scene_id: string }>(
    `SELECT id, provider_scene_id FROM earth_scene
     WHERE provider = 'copernicus' AND provider_scene_id = ANY($1::text[])`,
    [[pair.before.providerSceneId, pair.after.providerSceneId]],
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

async function listCandidateSceneRows(locationId: string | null, eventTime: Date): Promise<EarthScene[]> {
  if (!locationId) return [];
  const { rows } = await query<any>(
    `SELECT scene.* FROM earth_scene scene
     JOIN earth_scene_location linked ON linked.scene_id = scene.id
     WHERE linked.location_id = $1::uuid
       AND scene.capture_start BETWEEN $2::timestamptz - interval '180 days' AND $2::timestamptz + interval '60 days'
     ORDER BY scene.capture_start`,
    [locationId, eventTime],
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

async function processSceneDiscovery(job: any) {
  const providerStatus = copernicus.status();
  if (!providerStatus.enabled || !providerStatus.configured) throw new Error(providerStatus.reason ?? "Copernicus is unavailable.");
  const { rows } = await query<any>(
    `SELECT id, bbox, latitude, longitude, monitoring_tier, importance_score
     FROM intelligence_location WHERE id = $1::uuid AND active`,
    [job.location_id],
  );
  const location = rows[0];
  if (!location) throw new Error("Earth Observation job location no longer exists.");
  const bbox: BoundingBox = location.bbox
    ? boundBoundingBox(location.bbox)
    : validateBoundingBox([
        Number(location.longitude) - 0.15, Number(location.latitude) - 0.15,
        Number(location.longitude) + 0.15, Number(location.latitude) + 0.15,
      ]);
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
  const selected = ranked.filter((entry) => !entry.rejectedReason).slice(0, integerEnv("EO_MAX_SCENES_PER_DISCOVERY", 4, 1, 10));
  for (const rankedScene of ranked) {
    const sceneId = await saveScene(rankedScene.scene);
    await query(
      `INSERT INTO earth_scene_location (scene_id, location_id, rank_score, rank_components)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (scene_id, location_id) DO UPDATE SET rank_score=EXCLUDED.rank_score, rank_components=EXCLUDED.rank_components`,
      [sceneId, location.id, rankedScene.score, JSON.stringify(rankedScene.components)],
    );
    if (!selected.includes(rankedScene)) continue;
    const product: EarthProductType = rankedScene.scene.collection === "sentinel-1-grd" ? "sar" : "true_color";
    const { rows: observations } = await query<{ id: string }>(
      `INSERT INTO earth_observation (
         scene_id, location_id, event_id, product_type, captured_at,
         quality, methodology, attribution, license
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
       ON CONFLICT (scene_id, location_id, event_id, product_type) DO UPDATE SET
         quality = earth_observation.quality || EXCLUDED.quality,
         methodology = earth_observation.methodology || EXCLUDED.methodology
       RETURNING id`,
      [sceneId, location.id, job.event_id, product, rankedScene.scene.captureStart,
       JSON.stringify({ cloud_cover: rankedScene.scene.cloudCover, rank_score: rankedScene.score }),
       JSON.stringify({ kind: "provider_render", rank_components: rankedScene.components, epistemic_class: "observed_physical_signal" }),
       rankedScene.scene.attribution, rankedScene.scene.license],
    );
    const observationId = observations[0].id;
    await query(
      `INSERT INTO earth_processing_job (
         dedupe_key, job_type, provider, event_id, location_id, scene_id,
         observation_id, priority, parameters
       ) VALUES ($1,'render','copernicus',$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [`render:${observationId}:preview`, job.event_id, location.id, sceneId, observationId,
       job.priority, JSON.stringify({ product, width: 1024, height: 768 })],
    );
  }
  await updateProviderState("copernicus", { success: true, event: selected.length > 0 });
  return { scenes_found: scenes.length, scenes_selected: selected.length };
}

async function processRender(job: any) {
  const bucketName = process.env.EO_ASSET_BUCKET?.trim();
  if (!bucketName) throw new Error("EO_ASSET_BUCKET is not configured.");
  const { rows } = await query<any>(
    `SELECT observation.id, observation.product_type, scene.collection,
            COALESCE(location.bbox,scene.bbox) AS request_bbox,
            scene.capture_start, scene.capture_end
     FROM earth_observation observation
     JOIN earth_scene scene ON scene.id = observation.scene_id
     LEFT JOIN intelligence_location location ON location.id=observation.location_id
     WHERE observation.id = $1::uuid`,
    [job.observation_id],
  );
  const target = rows[0];
  if (!target) throw new Error("Earth observation no longer exists.");
  const { rows: usageRows } = await query<{ processing_units: number }>(
    `SELECT COALESCE(processing_units,0)::double precision AS processing_units
     FROM earth_provider_usage WHERE provider='copernicus' AND usage_date=current_date`,
  );
  const used = Number(usageRows[0]?.processing_units ?? 0);
  const budget = Math.max(0, Number(process.env.EO_MAX_DAILY_PROCESSING_UNITS ?? 100));
  if (!hasProcessingBudget(used, budget)) {
    await query(`UPDATE earth_processing_job SET status='budget_deferred', last_error='Daily processing-unit budget reached.', updated_at=now() WHERE id=$1`, [job.id]);
    return { budget_deferred: true };
  }
  await query(`UPDATE earth_observation SET status='processing', updated_at=now() WHERE id=$1`, [target.id]);
  const rendered = await copernicus.render({
    bbox: boundBoundingBox(target.request_bbox),
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
       SELECT event_id, 'earth_observation', product_type, 'earth_observation', id::text,
              captured_at, location_id, 0.9, 'observed',
              jsonb_build_object('scene_id',scene_id,'analysis_kind',analysis_kind),
              license, attribution, jsonb_build_object('observation_id',id)
       FROM earth_observation WHERE id=$1 AND event_id IS NOT NULL
       ON CONFLICT (event_id, domain, source_record_type, source_record_id) DO NOTHING`,
      [target.id],
    );
    await client.query(
      `UPDATE intelligence_event SET domain_count = (
         SELECT count(DISTINCT domain) FROM intelligence_event_evidence WHERE event_id=intelligence_event.id
       ), updated_at=now()
       WHERE id=(SELECT event_id FROM earth_observation WHERE id=$1)`,
      [target.id],
    );
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
  return { observation_id: target.id, bytes_stored: rendered.bytes.length + thumbnail.data.length };
}

async function claimEarthJob() {
  return withTransaction(async (client) => {
    const { rows } = await client.query<any>(
      `WITH candidate AS (
         SELECT id FROM earth_processing_job
         WHERE status IN ('queued','failed') AND available_at <= now() AND attempts < max_attempts
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
  const dead = job.attempts >= job.max_attempts;
  const backoffSeconds = Math.min(3_600, 15 * (2 ** Math.max(0, job.attempts - 1)));
  await query(
    `UPDATE earth_processing_job SET status=$2, last_error=$3,
            available_at=now()+make_interval(secs=>$4), finished_at=CASE WHEN $2='dead_letter' THEN now() ELSE NULL END,
            updated_at=now() WHERE id=$1`,
    [job.id, dead ? "dead_letter" : "failed", message.slice(0, 2_000), backoffSeconds],
  );
  if (job.observation_id) await query(`UPDATE earth_observation SET status='failed',last_error=$2,updated_at=now() WHERE id=$1`, [job.observation_id, message.slice(0, 2_000)]);
  await recordUsage(job.provider, { errors: 1 });
  await updateProviderState(job.provider, { success: false, error: message.slice(0, 500) });
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
  const dedupe = `scene-discovery:${eventId ?? "location"}:${locationId}`;
  const { rows } = await query(
    `INSERT INTO earth_processing_job (dedupe_key,job_type,provider,event_id,location_id,priority,parameters)
     VALUES ($1,'scene_discovery','copernicus',$2::uuid,$3::uuid,20,$4::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       status=CASE WHEN $5 THEN 'queued' ELSE earth_processing_job.status END,
       attempts=CASE WHEN $5 THEN 0 ELSE earth_processing_job.attempts END,
       available_at=CASE WHEN $5 THEN now() ELSE earth_processing_job.available_at END,
       last_error=CASE WHEN $5 THEN NULL ELSE earth_processing_job.last_error END,
       updated_at=now()
     RETURNING *`,
    [dedupe, eventId ?? null, locationId, JSON.stringify({ requested_by: "admin", requested_at: new Date().toISOString() }), force],
  );
  return rows[0];
}
