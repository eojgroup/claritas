import type { PoolClient } from "pg";
import { query, withTransaction } from "../db";
import { buildAlertDedupeKey, maxSeverity } from "./correlation";
import type { IntelligenceSignalInput } from "./types";

type EventRow = {
  id: string;
  dedupe_key: string;
  event_type: string;
  title: string;
  summary: string;
  status: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  start_time: string | Date;
  last_activity_time: string | Date;
  end_time: string | Date | null;
  primary_location_id: string | null;
  primary_country_iso2: string | null;
  source_diversity: number;
  domain_count: number;
  relevance_score: number;
  urgency_score: number;
  materiality_score: number;
  score_components: Record<string, unknown>;
  assessment_kind: string;
  metadata: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
  location_name?: string | null;
  location_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  monitoring_tier?: number | null;
  evidence_count?: number;
  earth_observation_available?: boolean;
};

const iso = (value: string | Date | null | undefined) => value == null
  ? null
  : (value instanceof Date ? value : new Date(value)).toISOString();

function eventToApi(row: EventRow) {
  return {
    ...row,
    confidence: Number(row.confidence),
    source_diversity: Number(row.source_diversity),
    domain_count: Number(row.domain_count),
    relevance_score: Number(row.relevance_score),
    urgency_score: Number(row.urgency_score),
    materiality_score: Number(row.materiality_score),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    monitoring_tier: row.monitoring_tier == null ? null : Number(row.monitoring_tier),
    start_time: iso(row.start_time),
    last_activity_time: iso(row.last_activity_time),
    end_time: iso(row.end_time),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    evidence_count: Number(row.evidence_count ?? 0),
    earth_observation_available: Boolean(row.earth_observation_available),
  };
}

export async function listIntelligenceEvents(options: {
  limit?: number;
  offset?: number;
  status?: string;
  severity?: string;
  country?: string;
  locationId?: string;
  eventType?: string;
  since?: Date;
} = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (options.status) where.push(`event.status = ${add(options.status)}`);
  if (options.severity) where.push(`event.severity = ${add(options.severity)}`);
  if (options.country) where.push(`event.primary_country_iso2 = ${add(options.country.toUpperCase())}`);
  if (options.locationId) {
    const ref = add(options.locationId);
    where.push(`(event.primary_location_id = ${ref}::uuid OR EXISTS (
      SELECT 1 FROM intelligence_event_location linked
      WHERE linked.event_id = event.id AND linked.location_id = ${ref}::uuid
    ))`);
  }
  if (options.eventType) where.push(`event.event_type = ${add(options.eventType)}`);
  if (options.since) where.push(`event.last_activity_time >= ${add(options.since.toISOString())}::timestamptz`);
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limitRef = add(limit);
  const offsetRef = add(offset);
  const { rows } = await query<EventRow>(
    `SELECT event.*, location.canonical_name AS location_name,
            location.location_type, location.latitude, location.longitude,
            location.monitoring_tier,
            (SELECT count(*)::int FROM intelligence_event_evidence evidence WHERE evidence.event_id = event.id) AS evidence_count,
            EXISTS (
              SELECT 1 FROM earth_observation observation
              WHERE observation.event_id = event.id AND observation.status = 'available'
            ) AS earth_observation_available
     FROM intelligence_event event
     LEFT JOIN intelligence_location location ON location.id = event.primary_location_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY event.relevance_score DESC, event.last_activity_time DESC, event.id
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params,
  );
  return rows.map(eventToApi);
}

export async function getIntelligenceEvent(eventId: string) {
  const [eventResult, evidenceResult, locationsResult, observationsResult, relatedResult] = await Promise.all([
    query<EventRow>(
      `SELECT event.*, location.canonical_name AS location_name,
              location.location_type, location.latitude, location.longitude,
              location.monitoring_tier,
              (SELECT count(*)::int FROM intelligence_event_evidence evidence WHERE evidence.event_id = event.id) AS evidence_count,
              EXISTS (SELECT 1 FROM earth_observation observation WHERE observation.event_id = event.id AND observation.status = 'available') AS earth_observation_available
       FROM intelligence_event event
       LEFT JOIN intelligence_location location ON location.id = event.primary_location_id
       WHERE event.id = $1::uuid`,
      [eventId],
    ),
    query(
      `SELECT evidence.*, source.name AS source_name,
              location.canonical_name AS location_name
       FROM intelligence_event_evidence evidence
       LEFT JOIN source ON source.id = evidence.source_id
       LEFT JOIN intelligence_location location ON location.id = evidence.location_id
       WHERE evidence.event_id = $1::uuid
       ORDER BY evidence.observed_at DESC, evidence.id`,
      [eventId],
    ),
    query(
      `SELECT linked.relationship, linked.distance_km, linked.confidence,
              location.id, location.slug, location.location_type,
              location.canonical_name, location.country_iso2,
              location.latitude, location.longitude, location.bbox,
              location.importance_score, location.monitoring_tier,
              location.attribution, location.license
       FROM intelligence_event_location linked
       JOIN intelligence_location location ON location.id = linked.location_id
       WHERE linked.event_id = $1::uuid
       ORDER BY CASE linked.relationship WHEN 'primary' THEN 0 WHEN 'affected' THEN 1 ELSE 2 END,
                location.importance_score DESC`,
      [eventId],
    ),
    query(
      `SELECT observation.*, scene.provider, scene.mission, scene.collection,
              scene.provider_scene_id, scene.capture_start, scene.capture_end,
              scene.cloud_cover, scene.resolution_m, scene.orbit_direction,
              scene.source_url,
              COALESCE(jsonb_agg(jsonb_build_object(
                'id', asset.id, 'asset_type', asset.asset_type,
                'mime_type', asset.mime_type, 'width', asset.width,
                'height', asset.height, 'size_bytes', asset.size_bytes,
                'generated_at', asset.generated_at, 'expires_at', asset.expires_at,
                'url', '/api/earth-observation/assets/' || asset.id::text
              ) ORDER BY asset.width) FILTER (WHERE asset.id IS NOT NULL), '[]'::jsonb) AS assets
       FROM earth_observation observation
       JOIN earth_scene scene ON scene.id = observation.scene_id
       LEFT JOIN earth_observation_asset asset ON asset.observation_id = observation.id
       WHERE observation.event_id = $1::uuid
       GROUP BY observation.id, scene.id
       ORDER BY scene.capture_start DESC`,
      [eventId],
    ),
    query(
      `SELECT relationship.relationship, relationship.confidence, relationship.rationale,
              related.id, related.event_type, related.title, related.status,
              related.severity, related.last_activity_time, related.relevance_score
       FROM intelligence_event_relationship relationship
       JOIN intelligence_event related ON related.id = relationship.to_event_id
       WHERE relationship.from_event_id = $1::uuid
       ORDER BY relationship.confidence DESC, related.last_activity_time DESC
       LIMIT 20`,
      [eventId],
    ),
  ]);
  const event = eventResult.rows[0];
  if (!event) return null;
  return {
    event: eventToApi(event),
    evidence: evidenceResult.rows.map((row: any) => ({
      ...row,
      confidence: Number(row.confidence),
      correlation_score: row.correlation_score == null ? null : Number(row.correlation_score),
      observed_at: iso(row.observed_at),
      published_at: iso(row.published_at),
    })),
    locations: locationsResult.rows,
    earth_observations: observationsResult.rows.map(normalizeEarthObservationRow),
    related_events: relatedResult.rows,
    epistemic_notice: "Reported events, observed signals, derived metrics, model interpretations and Claritas assessments are labelled separately. Correlation does not establish causation.",
  };
}

function normalizeEarthObservationRow(row: any) {
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

export async function upsertIntelligenceSignal(input: IntelligenceSignalInput) {
  return withTransaction(async (client) => upsertIntelligenceSignalTx(client, input));
}

export async function upsertIntelligenceSignalTx(client: PoolClient, input: IntelligenceSignalInput) {
  const existing = await client.query<{ id: string; severity: EventRow["severity"] }>(
    `SELECT id, severity FROM intelligence_event WHERE dedupe_key = $1 FOR UPDATE`,
    [input.dedupeKey],
  );
  const existingSeverity = existing.rows[0]?.severity;
  const severity = existingSeverity ? maxSeverity(existingSeverity, input.severity) : input.severity;
  const eventResult = await client.query<EventRow>(
    `INSERT INTO intelligence_event (
       dedupe_key, event_type, title, summary, status, severity, confidence,
       start_time, last_activity_time, primary_location_id, primary_country_iso2,
       geography, relevance_score, urgency_score, materiality_score,
       score_components, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,
       CASE WHEN $12::double precision IS NULL OR $13::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($13,$12),4326) END,
       $14,$15,$16,$17::jsonb,$18::jsonb
     )
     ON CONFLICT (dedupe_key) DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       status = CASE WHEN intelligence_event.status = 'resolved' THEN 'monitoring' ELSE EXCLUDED.status END,
       severity = EXCLUDED.severity,
       confidence = GREATEST(intelligence_event.confidence, EXCLUDED.confidence),
       start_time = LEAST(intelligence_event.start_time, EXCLUDED.start_time),
       last_activity_time = GREATEST(intelligence_event.last_activity_time, EXCLUDED.last_activity_time),
       primary_location_id = COALESCE(intelligence_event.primary_location_id, EXCLUDED.primary_location_id),
       primary_country_iso2 = COALESCE(intelligence_event.primary_country_iso2, EXCLUDED.primary_country_iso2),
       geography = COALESCE(intelligence_event.geography, EXCLUDED.geography),
       relevance_score = GREATEST(intelligence_event.relevance_score, EXCLUDED.relevance_score),
       urgency_score = GREATEST(intelligence_event.urgency_score, EXCLUDED.urgency_score),
       materiality_score = GREATEST(intelligence_event.materiality_score, EXCLUDED.materiality_score),
       score_components = intelligence_event.score_components || EXCLUDED.score_components,
       metadata = intelligence_event.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      input.dedupeKey, input.eventType, input.title, input.summary, input.status ?? "active",
      severity, Math.min(1, Math.max(0, input.confidence)), input.startTime, input.lastActivityTime,
      input.primaryLocationId ?? null, input.primaryCountryIso2?.toUpperCase() ?? null,
      input.latitude ?? null, input.longitude ?? null,
      Math.min(1, Math.max(0, input.relevanceScore)),
      Math.min(1, Math.max(0, input.urgencyScore)),
      Math.min(1, Math.max(0, input.materialityScore)),
      JSON.stringify(input.scoreComponents), JSON.stringify(input.metadata ?? {}),
    ],
  );
  const event = eventResult.rows[0];
  if (input.primaryLocationId) {
    await client.query(
      `INSERT INTO intelligence_event_location (event_id, location_id, relationship, confidence)
       VALUES ($1, $2, 'primary', $3)
       ON CONFLICT (event_id, location_id, relationship) DO UPDATE SET confidence = GREATEST(intelligence_event_location.confidence, EXCLUDED.confidence)`,
      [event.id, input.primaryLocationId, input.evidence.confidence],
    );
  }
  await client.query(
    `INSERT INTO intelligence_event_evidence (
       event_id, domain, evidence_type, source_record_type, source_record_id,
       source_id, observed_at, published_at, location_id, confidence,
       relationship, provenance, license, attribution, correlation_score,
       correlation_factors, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb,$17::jsonb)
     ON CONFLICT (event_id, domain, source_record_type, source_record_id) DO UPDATE SET
       observed_at = EXCLUDED.observed_at,
       published_at = COALESCE(EXCLUDED.published_at, intelligence_event_evidence.published_at),
       confidence = GREATEST(intelligence_event_evidence.confidence, EXCLUDED.confidence),
       relationship = EXCLUDED.relationship,
       provenance = intelligence_event_evidence.provenance || EXCLUDED.provenance,
       license = COALESCE(EXCLUDED.license, intelligence_event_evidence.license),
       attribution = COALESCE(EXCLUDED.attribution, intelligence_event_evidence.attribution),
       correlation_score = GREATEST(intelligence_event_evidence.correlation_score, EXCLUDED.correlation_score),
       correlation_factors = intelligence_event_evidence.correlation_factors || EXCLUDED.correlation_factors,
       metadata = intelligence_event_evidence.metadata || EXCLUDED.metadata`,
    [
      event.id, input.evidence.domain, input.evidence.evidenceType,
      input.evidence.sourceRecordType, input.evidence.sourceRecordId,
      input.evidence.sourceId ?? null, input.evidence.observedAt,
      input.evidence.publishedAt ?? null, input.evidence.locationId ?? input.primaryLocationId ?? null,
      Math.min(1, Math.max(0, input.evidence.confidence)), input.evidence.relationship,
      JSON.stringify(input.evidence.provenance), input.evidence.license ?? null,
      input.evidence.attribution ?? null,
      Math.min(1, Math.max(0, input.evidence.correlationScore ?? 1)),
      JSON.stringify(input.evidence.correlationFactors ?? {}),
      JSON.stringify(input.evidence.metadata ?? {}),
    ],
  );
  await client.query(
    `UPDATE intelligence_event event SET
       domain_count = aggregate.domain_count,
       source_diversity = aggregate.source_diversity,
       confidence = GREATEST(event.confidence, aggregate.average_confidence),
       relevance_score = LEAST(1, GREATEST(event.relevance_score,
         event.relevance_score + LEAST(0.18, GREATEST(0, aggregate.domain_count - 1) * 0.04)
       )),
       updated_at = now()
     FROM (
       SELECT event_id, count(DISTINCT domain)::int AS domain_count,
              count(DISTINCT COALESCE(source_id::text, source_record_type))::int AS source_diversity,
              avg(confidence)::double precision AS average_confidence
       FROM intelligence_event_evidence WHERE event_id = $1 GROUP BY event_id
     ) aggregate
     WHERE event.id = aggregate.event_id`,
    [event.id],
  );
  if (["high", "critical"].includes(severity)
      && input.relevanceScore >= Number(process.env.EVENT_ALERT_RELEVANCE_THRESHOLD ?? 0.72)
      && process.env.EVENT_ALERTS_ENABLED?.toLowerCase() === "true") {
    const candidateResult = await client.query<{ id: string }>(
      `INSERT INTO alert_candidate (event_id, dedupe_key, severity, title, body, eligibility)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         severity = EXCLUDED.severity, title = EXCLUDED.title, body = EXCLUDED.body,
         eligibility = alert_candidate.eligibility || EXCLUDED.eligibility, updated_at = now()
       RETURNING id`,
      [event.id, buildAlertDedupeKey(event.id, input.lastActivityTime), severity, input.title, input.summary,
       JSON.stringify({ minimum_relevance: input.relevanceScore, country_iso2: input.primaryCountryIso2 ?? null })],
    );
    await client.query(`SELECT materialize_alert_candidate_recipients($1::uuid, NULL)`, [candidateResult.rows[0].id]);
  }
  const eoThreshold = Number(process.env.EO_EVENT_RELEVANCE_THRESHOLD ?? 0.72);
  if (process.env.EARTH_OBSERVATION_ENABLED?.toLowerCase() === "true"
      && input.primaryLocationId && input.relevanceScore >= eoThreshold) {
    const dedupe = `scene-discovery:${event.id}:${input.primaryLocationId}`;
    await client.query(
      `INSERT INTO earth_processing_job (dedupe_key, job_type, provider, event_id, location_id, priority, parameters)
       VALUES ($1,'scene_discovery','copernicus',$2,$3,$4,$5::jsonb)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         priority = LEAST(earth_processing_job.priority, EXCLUDED.priority),
         available_at = LEAST(earth_processing_job.available_at, now()),
         status = CASE WHEN earth_processing_job.status IN ('success','running') THEN earth_processing_job.status ELSE 'queued' END,
         updated_at = now()`,
      [dedupe, event.id, input.primaryLocationId, Math.max(1, 100 - Math.round(input.relevanceScore * 90)),
       JSON.stringify({ event_time: input.startTime.toISOString(), requested_products: ["true_color"] })],
    );
  }
  const emittedType = existing.rows.length ? "intelligence.event.updated" : "intelligence.event.created";
  await client.query(
    `INSERT INTO event_outbox (event_type, aggregate_type, aggregate_id, dedupe_key, payload, occurred_at)
     VALUES ($1,'intelligence_event',$2,$3,$4::jsonb,$5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [emittedType, event.id, `${emittedType}:${event.id}:${input.lastActivityTime.getTime()}`,
     JSON.stringify({ event_id: event.id, event_type: input.eventType, severity, location_id: input.primaryLocationId ?? null }),
     input.lastActivityTime],
  );
  return eventToApi(event);
}

export async function listIntelligenceLocations(options: {
  query?: string;
  type?: string;
  country?: string;
  monitoringTier?: number;
  limit?: number;
} = {}) {
  const params: unknown[] = [];
  const where = ["location.active"];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (options.query) {
    const ref = add(`%${options.query.trim()}%`);
    where.push(`(location.canonical_name ILIKE ${ref} OR location.slug ILIKE ${ref})`);
  }
  if (options.type) where.push(`location.location_type = ${add(options.type)}`);
  if (options.country) where.push(`location.country_iso2 = ${add(options.country.toUpperCase())}`);
  if (options.monitoringTier) where.push(`location.monitoring_tier = ${add(options.monitoringTier)}`);
  const limitRef = add(Math.min(200, Math.max(1, Math.trunc(options.limit ?? 100))));
  const { rows } = await query(
    `SELECT location.id, location.slug, location.location_type, location.canonical_name,
            location.country_iso2, location.admin1, location.latitude, location.longitude,
            location.bbox, location.timezone, location.importance_score,
            location.monitoring_tier, location.attribution, location.license,
            location.metadata,
            COALESCE(jsonb_agg(DISTINCT alias.alias) FILTER (WHERE alias.id IS NOT NULL), '[]'::jsonb) AS aliases
     FROM intelligence_location location
     LEFT JOIN intelligence_location_alias alias ON alias.location_id = location.id
     WHERE ${where.join(" AND ")}
     GROUP BY location.id
     ORDER BY location.monitoring_tier, location.importance_score DESC, location.canonical_name
     LIMIT ${limitRef}`,
    params,
  );
  return rows;
}

export async function getAlertCandidates(limit = 50) {
  const { rows } = await query(
    `SELECT candidate.*, event.event_type, event.status AS event_status,
            event.relevance_score, event.primary_country_iso2,
            location.canonical_name AS location_name
     FROM alert_candidate candidate
     JOIN intelligence_event event ON event.id = candidate.event_id
     LEFT JOIN intelligence_location location ON location.id = event.primary_location_id
     WHERE candidate.status IN ('candidate','eligible','failed')
     ORDER BY candidate.created_at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))],
  );
  return rows;
}
