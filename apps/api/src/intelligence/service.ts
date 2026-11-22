import { readPreparedIntelligenceFeed } from "./feed-snapshot";
import { newsCoordinateConflictsWithLocation, NAMED_POINT_LOCATION_TYPES } from "./event-geography";
import { listNewsImages } from "../image-analysis/news-image-store";
import { getEventContextImages } from "./context-images";
import { isTimelyEventMedia } from "./event-media";
import { headlineTranslationFields, loadTranslationContext, translateEventPresentation, translateEvidencePresentation, normalizeIntelligenceDisplayLanguage, type HeadlineTranslationPresentation } from "./translation-presentation";
import { sourceRecordBigintSql, canonicalSocialSignalBigintSql } from "./source-record";
import { getRegionalContext } from "./regional-context";
import { activeSocialEvidenceSql, buildSignalCoverage, eventOriginDomainSql, eventSignalDomainsSql, eventNewsPrioritySql, eventPriorityScoreSql, eventPriorityReasons } from "./event-priority";
import { getRegionalReporting } from "./regional-reporting";
import { getSocialEventContexts, getSocialEventContextCounts } from "./social-context";
import type { PoolClient } from "pg";
import {
  buildEventUnderstanding,
  buildGdeltEventPresentation,
  buildLinkedNewsPresentation,
} from "./event-presentation";
import { query, withTransaction } from "../db";
import {
  buildDiscoveryDedupeKey,
  resolveTrustedEventCoordinates,
} from "../earth-observation/discovery-context";
import { earthObservationToApi } from "../earth-observation/image-quality";
import {
  buildAlertDedupeKey,
  buildEventDedupeKey,
  eventFamilyTypes,
  maxSeverity,
  qualifiedRelatedCorrelationCandidates,
  rankCorrelationCandidates,
  resolveSignalCoordinates,
  selectCorrelationOutcome,
  shouldReplaceCanonicalSignal,
  type ScoredCorrelationCandidate,
} from "./correlation";
import {
  contextualLinkagePolicy,
  scoreContextualLinkage,
  type ContextualLinkagePolicy,
  type EarthquakeContextAttributes,
} from "./contextual-linkage";
import type { CorrelationCandidate, IntelligenceSignalInput } from "./types";
import {
  intelligenceEventExpiresAtSql,
  intelligenceEventFreshness,
} from "./freshness";

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
  expires_at?: string | Date;
  location_name?: string | null;
  location_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  monitoring_tier?: number | null;
  evidence_count?: number;
  origin_domain?: string;
  signal_domains?: string[];
  priority_score?: number;
  news_priority?: number;
  origin_topic_rank?: number;
  earth_observation_available?: boolean;
  earth_observation_state?: "imagery_available" | "processing" | "queued" | "not_requested";
};

type CorrelationCandidateRow = EventRow & {
  candidate_latitude: number | null;
  candidate_longitude: number | null;
  location_type: string | null;
  entity_keys: string[];
};

type MajorEventContextCandidateRow = CorrelationCandidateRow & {
  start_latitude: number | null;
  start_longitude: number | null;
};

type SignalLocation = {
  id: string;
  location_type: string;
  latitude: number | null;
  longitude: number | null;
};

export type TargetedEarthquakeContextAudit = {
  earthquakeObservationId: string;
  usgsEventId: string;
  place: string;
  confidence: number;
  scope: "local_place" | "event_signature";
  factors: string[];
  rationale: string;
  assessmentBoundary: string;
  methodology: "deterministic_gdelt_doc_event_query_v1";
};

function storedEarthquakeContextAttributes(
  event: Pick<EventRow, "severity" | "score_components" | "metadata">,
): EarthquakeContextAttributes {
  return {
    severity: event.severity,
    magnitude: event.score_components?.magnitude ?? event.metadata?.magnitude,
    significance: event.score_components?.significance ?? event.metadata?.significance,
    tsunami: event.metadata?.tsunami,
    alertLevel: event.metadata?.alert_level,
    felt: event.metadata?.felt,
  };
}

const correlationNumberEnv = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number(process.env[name] ?? "");
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
};

const finiteCoordinate = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value);

function normalizedEntityKeys(values: string[] | undefined) {
  return [...new Set((values ?? [])
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((value) => value.length >= 2 && value.length <= 180))]
    .slice(0, 40);
}

function canonicalSignalRank(input: IntelligenceSignalInput) {
  const relationship = {
    observed: 0.28,
    corroborates: 0.26,
    derived: 0.2,
    assessment: 0.18,
    model_interpretation: 0.12,
    reported: 0.1,
    context: 0.05,
    contradicts: 0.04,
  }[input.evidence.relationship] ?? 0;
  const physical = ["earth_observation", "disaster", "weather"].includes(input.evidence.domain) ? 0.08 : 0;
  return Math.min(1, Number((input.evidence.confidence * 0.58 + relationship + physical + input.materialityScore * 0.06).toFixed(4)));
}

function existingCanonicalRank(row: Pick<EventRow, "confidence" | "metadata"> | undefined) {
  const stored = Number(row?.metadata?.canonical_signal_rank);
  return Number.isFinite(stored) ? stored : Number(row?.confidence ?? 0) * 0.58;
}

function correlationBounds(eventType: string) {
  const family = eventFamilyTypes(eventType)[0];
  const defaults: Record<string, { hours: number; distanceKm: number }> = {
    earthquake: { hours: 36, distanceKm: 300 },
    wildfire: { hours: 96, distanceKm: 125 },
    flood: { hours: 96, distanceKm: 200 },
    severe_storm: { hours: 120, distanceKm: 300 },
    agricultural_stress: { hours: 336, distanceKm: 250 },
    transport_disruption: { hours: 96, distanceKm: 100 },
    security_incident: { hours: 72, distanceKm: 100 },
    market_move: { hours: 48, distanceKm: 100 },
    reported_development: { hours: 24, distanceKm: 50 },
  };
  const selected = defaults[family] ?? { hours: 72, distanceKm: 150 };
  return {
    maxHours: correlationNumberEnv("EVENT_CORRELATION_MAX_HOURS", selected.hours, 1, 720),
    maxDistanceKm: correlationNumberEnv("EVENT_CORRELATION_MAX_DISTANCE_KM", selected.distanceKm, 1, 1_000),
    threshold: correlationNumberEnv("EVENT_CORRELATION_THRESHOLD", 0.58, 0.4, 0.95),
  };
}

function earthObservationProducts(eventType: string): string[] | null {
  const products: Record<string, string[]> = {
    wildfire: ["true_color", "burn_index"],
    flood: ["sar", "ndwi"],
    severe_storm: ["sar", "true_color"],
    agricultural_stress: ["ndvi"],
    transport_disruption: ["sar", "true_color"],
    aviation_disruption: ["true_color"],
    earthquake: ["sar", "true_color"],
    security_incident: ["sar", "true_color"],
  };
  return products[eventType] ?? null;
}

const iso = (value: string | Date | null | undefined) => value == null
  ? null
  : (value instanceof Date ? value : new Date(value)).toISOString();

function eventToApi(row: EventRow) {
  const earthObservationState = ["imagery_available", "processing", "queued", "not_requested"]
    .includes(String(row.earth_observation_state))
    ? row.earth_observation_state as NonNullable<EventRow["earth_observation_state"]>
    : row.earth_observation_available ? "imagery_available" : "not_requested";
  const expiresAt = iso(row.expires_at);
  return {
    ...row,
    origin_domain: row.origin_domain ?? String(row.metadata?.origin_domain ?? "news"),
    signal_domains: row.signal_domains ?? [],
    priority_score: Number(row.priority_score ?? row.relevance_score),
    priority_reasons: eventPriorityReasons(row),
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
    expires_at: expiresAt,
    freshness_state: expiresAt
      ? intelligenceEventFreshness({ expiresAt, status: row.status })
      : "expired",
    evidence_count: Number(row.evidence_count ?? 0),
    earth_observation_state: earthObservationState,
    earth_observation_available: earthObservationState === "imagery_available",
  };
}

/** One canonical state expression shared by event and News API projections. */
export function intelligenceEventEarthObservationStateSql() {
  return `CASE
    WHEN EXISTS (
      SELECT 1 FROM earth_observation observation
      JOIN earth_observation_asset asset ON asset.observation_id=observation.id
      WHERE observation.event_id=event.id AND observation.status='available'
        AND (asset.expires_at IS NULL OR asset.expires_at>now())
    ) THEN 'imagery_available'
    WHEN EXISTS (
      SELECT 1 FROM earth_processing_job job
      WHERE job.event_id=event.id AND job.status='running'
    ) THEN 'processing'
    WHEN EXISTS (
      SELECT 1 FROM earth_processing_job job
      WHERE job.event_id=event.id AND job.status IN ('queued','failed','budget_deferred')
    ) THEN 'queued'
    ELSE 'not_requested'
  END`;
}

/**
 * Prevent an event backed only by a rejected article from remaining visible
 * merely because a provider rediscovered it. Non-news evidence stays eligible;
 * an event with independent weather, transport, or observation evidence is
 * therefore still available even when one attached article fails quality.
 */
// OFFSET 0 keeps this existence check correlated: a pulled-up semi-join can
// scan every historical evidence row before selecting the current events.
function intelligenceEventHasRetainedOriginSql(eventAlias = "event") {
  return `(COALESCE(${eventAlias}.metadata->>'canonical_evidence_key','') NOT LIKE 'social:social_signal:%'
    OR EXISTS (SELECT 1 FROM social_signal retained_origin
      WHERE retained_origin.id=${canonicalSocialSignalBigintSql(eventAlias)}
        AND retained_origin.expires_at>now() LIMIT 1 OFFSET 0))`;
}

function intelligenceEventHasDisplayableEvidenceSql(eventAlias = "event") {
  return `${intelligenceEventHasRetainedOriginSql(eventAlias)} AND EXISTS (
    SELECT 1
    FROM intelligence_event_evidence evidence
    LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
    LEFT JOIN item source_item ON source_item.id=${sourceRecordBigintSql("evidence", "item")}
    WHERE evidence.event_id=${eventAlias}.id
      AND ${activeSocialEvidenceSql()}
      AND (
        evidence.source_record_type <> 'item'
        OR (
          CASE WHEN lower(COALESCE(evidence_source.name, '')) = 'gdelt'
            THEN source_item.payload->>'quality_status' = 'accepted'
            ELSE COALESCE(source_item.payload->>'quality_status', 'accepted') = 'accepted'
          END
        )
      )
    LIMIT 1 OFFSET 0
  )`;
}

export type IntelligenceEventListOptions = {
  limit?: number;
  offset?: number;
  status?: string;
  severity?: string;
  country?: string;
  locationId?: string;
  eventType?: string;
  since?: Date;
  includeExpired?: boolean;
  displayLanguage?: string;
};

export type IntelligenceFeedEvent = ReturnType<typeof eventToApi> & Partial<HeadlineTranslationPresentation>;

export async function listIntelligenceEvents(options: IntelligenceEventListOptions = {}) {
  const language = normalizeIntelligenceDisplayLanguage(options.displayLanguage ?? "en");
  const prepared = await readPreparedIntelligenceFeed(options);
  if (!prepared) return rankIntelligenceEvents(options);
  const ids = prepared.events.map((event) => event.id);
  if (!ids.length) return [];
  const valid = await query<{ id: string }>(`SELECT event.id FROM intelligence_event event
    WHERE event.id=ANY($1::uuid[]) AND event.status IN ('emerging','active','monitoring')
      AND ${intelligenceEventExpiresAtSql("event")}>now()
      AND ${intelligenceEventHasDisplayableEvidenceSql("event")}
      AND NOT (COALESCE(event.metadata->>'canonical_evidence_key','') LIKE 'news:global_event:%'
        AND event.domain_count<=1 AND event.source_diversity<=1 AND event.relevance_score<0.65)`, [ids]);
  const visible = new Set(valid.rows.map((row) => row.id));
  const rows = prepared.events.filter((event) => visible.has(event.id));
  if (language === "en") return rows;
  const translations = await loadTranslationContext(rows.map((row) => row.id), [], language);
  return rows.map((row) => {
    const original = { ...row, title: row.original_title ?? row.title, summary: row.original_summary ?? row.summary };
    for (const key of Object.keys(headlineTranslationFields(row))) delete (original as Record<string, unknown>)[key];
    return translateEventPresentation(original, translations);
  });
}

export async function rankIntelligenceEvents(options: IntelligenceEventListOptions = {}, read: typeof query = query) {
  const displayLanguage = normalizeIntelligenceDisplayLanguage(options.displayLanguage ?? "en");
  const params: unknown[] = [];
  const where: string[] = [
    `NOT (
      event.metadata->>'canonical_evidence_key' LIKE 'news:global_event:%'
      AND event.domain_count <= 1
      AND event.source_diversity <= 1
      AND event.relevance_score < 0.65
    )`,
  ];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const explicitlyArchivedStatus = options.status === "resolved" || options.status === "dismissed";
  if (!options.includeExpired && !explicitlyArchivedStatus) {
    where.push(`event.status IN ('emerging','active','monitoring')`);
    // All visibility policies expire within seven days; bound the indexed scan
    // before applying the exact per-type expiry expression.
    where.push(`event.last_activity_time > now()-interval '168 hours'`);
    where.push(`${intelligenceEventExpiresAtSql("event")} > now()`);
  }
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
  const { rows } = await read<EventRow>(
    `WITH eligible AS MATERIALIZED (
       -- Rank lightweight rows. Full metadata, summaries and geometry can be
       -- large; carrying them through every CTE spills even a small live feed
       -- to disk before its page limit is applied.
       SELECT event.id,event.event_type,event.severity,event.source_diversity,
              event.relevance_score,event.urgency_score,event.materiality_score,
              event.last_activity_time,
              jsonb_build_object(
                'origin_domain',event.metadata->>'origin_domain',
                'canonical_evidence_key',event.metadata->>'canonical_evidence_key'
              ) AS metadata
       FROM intelligence_event_feed event
       WHERE ${where.join(" AND ")}
     ), feed_evidence AS MATERIALIZED (
         SELECT evidence.event_id,bool_or(${activeSocialEvidenceSql()} AND (
                  evidence.source_record_type<>'item' OR
                  CASE WHEN lower(COALESCE(evidence_source.name,''))='gdelt'
                    THEN article.payload->>'quality_status'='accepted'
                    ELSE COALESCE(article.payload->>'quality_status','accepted')='accepted' END
                )) AS displayable,
                max(CASE WHEN evidence.domain='news'
                  AND evidence.source_record_type='item'
                  AND COALESCE(article.payload->>'quality_status','accepted')='accepted'
                  AND assessment.assessed_at>=article.updated_at
                  THEN assessment.score/100 END) AS news_priority
         FROM intelligence_event_evidence evidence
         LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
         LEFT JOIN item article ON article.id=${sourceRecordBigintSql("evidence", "item")}
         LEFT JOIN news_item_assessment assessment ON assessment.item_id=article.id AND evidence.domain='news'
         WHERE evidence.event_id=ANY(ARRAY(SELECT id FROM eligible))
         GROUP BY evidence.event_id
     ), candidates AS MATERIALIZED (
       SELECT event.*,
              ${eventOriginDomainSql()} AS origin_domain,
              COALESCE(feed_evidence.news_priority,0) AS news_priority
       FROM eligible event
       JOIN feed_evidence ON feed_evidence.event_id=event.id
       WHERE ${intelligenceEventHasRetainedOriginSql("event")} AND feed_evidence.displayable
     ), scored AS (
       SELECT candidates.*,${eventPriorityScoreSql("candidates", true)} AS raw_priority
       FROM candidates
     ), ranked AS (
       SELECT scored.*,row_number() OVER (PARTITION BY origin_domain,event_type ORDER BY raw_priority DESC,last_activity_time DESC,id) AS origin_topic_rank
       FROM scored
     ), selected AS MATERIALIZED (
       SELECT ranked.*,raw_priority AS priority_score,GREATEST(0,raw_priority-CASE WHEN severity='critical' THEN 0
         ELSE LEAST(0.24,(origin_topic_rank-1)*0.08) END) AS feed_order_score
       FROM ranked
       ORDER BY feed_order_score DESC,last_activity_time DESC,id
       LIMIT ${limitRef} OFFSET ${offsetRef}
     )
     SELECT event.*,selection.origin_domain,selection.news_priority,
            selection.raw_priority,selection.origin_topic_rank,
            selection.priority_score,selection.feed_order_score,
            location.canonical_name AS location_name,
            ${eventSignalDomainsSql()} AS signal_domains,
            location.location_type,
            COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END,location.latitude) AS latitude,
            COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END,location.longitude) AS longitude,
            location.monitoring_tier,
            (SELECT count(*)::int FROM intelligence_event_evidence evidence
             LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
             LEFT JOIN item source_item ON source_item.id=${sourceRecordBigintSql("evidence", "item")}
             WHERE evidence.event_id = event.id AND ${activeSocialEvidenceSql()}
               AND (evidence.source_record_type <> 'item'
                 OR (CASE WHEN lower(COALESCE(evidence_source.name, '')) = 'gdelt'
                     THEN source_item.payload->>'quality_status' = 'accepted'
                     ELSE COALESCE(source_item.payload->>'quality_status', 'accepted') = 'accepted'
                   END))) AS evidence_count,
            ${intelligenceEventExpiresAtSql("event")} AS expires_at,
            (${intelligenceEventEarthObservationStateSql()}) AS earth_observation_state
     FROM selected selection
     JOIN intelligence_event event ON event.id=selection.id
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     ORDER BY selection.feed_order_score DESC,event.last_activity_time DESC,event.id`,
    params,
  );
  const eventIds = rows.map((row) => row.id);
  const [social, translations] = await Promise.all([
    getSocialEventContextCounts(eventIds), loadTranslationContext(eventIds, [], displayLanguage),
  ]);
  return rows.map((row) => translateEventPresentation({ ...eventToApi(row), social_context_count: social.get(row.id) ?? 0 }, translations));
}

export async function getIntelligenceEvent(eventId: string, options: { displayLanguage?: string; includeContext?: boolean } = {}) {
  const displayLanguage = normalizeIntelligenceDisplayLanguage(options.displayLanguage ?? "en");
  const [eventResult, evidenceResult, locationsResult, observationsResult, relatedResult] = await Promise.all([
    query<EventRow>(
      `SELECT event.*, location.canonical_name AS location_name,
              ${eventOriginDomainSql()} AS origin_domain,
              ${eventSignalDomainsSql()} AS signal_domains,
              ${eventNewsPrioritySql()} AS news_priority,
              ${eventPriorityScoreSql()} AS priority_score,
              location.location_type,
              COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END,location.latitude) AS latitude,
              COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END,location.longitude) AS longitude,
              location.monitoring_tier,
              (SELECT count(*)::int FROM intelligence_event_evidence evidence
               LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
               LEFT JOIN item source_item ON source_item.id=${sourceRecordBigintSql("evidence", "item")}
               WHERE evidence.event_id = event.id AND ${activeSocialEvidenceSql()}
                 AND (evidence.source_record_type <> 'item'
                   OR (CASE WHEN lower(COALESCE(evidence_source.name, '')) = 'gdelt'
                       THEN source_item.payload->>'quality_status' = 'accepted'
                       ELSE COALESCE(source_item.payload->>'quality_status', 'accepted') = 'accepted'
                     END))) AS evidence_count,
              ${intelligenceEventExpiresAtSql("event")} AS expires_at,
              (${intelligenceEventEarthObservationStateSql()}) AS earth_observation_state
       FROM intelligence_event event
       LEFT JOIN intelligence_location location ON location.id = event.primary_location_id
       WHERE event.id = $1::uuid
         AND ${intelligenceEventHasDisplayableEvidenceSql("event")}`,
      [eventId],
    ),
    query(
      `SELECT evidence.*, source.name AS source_name,
              source_item.payload->>'image_url' AS image_url,
              location.canonical_name AS location_name,
              COALESCE(source_item.title, podcast_signal.title,
                NULLIF(concat_ws(' / ',global_source.actor1_name,global_source.actor2_name),''),
                global_source.action_geo_name,
                NULLIF(evidence.metadata->>'title','')) AS source_title,
              COALESCE(source_item.summary, podcast_signal.summary,
                CASE WHEN global_source.id IS NOT NULL THEN
                  'Structured GDELT event near ' || COALESCE(global_source.action_geo_name,'an unspecified location')
                END,
                NULLIF(evidence.metadata->>'summary',''),NULLIF(evidence.metadata->>'description','')) AS source_summary,
              COALESCE(source_item.url,podcast_item.url,global_source.url,evidence.provenance->>'url',
                evidence.provenance->>'episode_url',evidence.provenance->>'source_url') AS source_url,
              COALESCE((SELECT jsonb_agg(to_jsonb(excerpt) ORDER BY start_ms) FROM (
                SELECT segment.id::text AS segment_id,segment.start_ms,segment.end_ms,segment.timing_method,
                  left(COALESCE(NULLIF(link.quote,''),segment.text),1400) AS quote,segment.source_url
                FROM intelligence_signal_evidence link JOIN evidence_segment segment ON segment.id=link.evidence_segment_id
                WHERE link.signal_id=podcast_signal.id ORDER BY segment.start_ms,segment.id LIMIT 3
              ) excerpt),'[]'::jsonb) AS transcript_excerpts,
              global_source.event_code AS gdelt_event_code,
              global_source.event_root_code AS gdelt_event_root_code,
              global_source.actor1_name AS gdelt_actor1_name,
              global_source.actor2_name AS gdelt_actor2_name,
              global_source.action_geo_name AS gdelt_action_geo_name,
              global_source.action_country_iso2 AS gdelt_country_iso2,
              global_source.mention_count AS gdelt_mention_count,
              global_source.source_count AS gdelt_source_count,
              global_source.article_count AS gdelt_article_count
       FROM intelligence_event_evidence evidence
       LEFT JOIN source ON source.id = evidence.source_id
       LEFT JOIN intelligence_location location ON location.id = evidence.location_id
       LEFT JOIN item source_item ON source_item.id=${sourceRecordBigintSql("evidence", "item")}
       LEFT JOIN global_event global_source ON global_source.id=${sourceRecordBigintSql("evidence", "global_event")}
       LEFT JOIN intelligence_signal podcast_signal
         ON evidence.source_record_type='intelligence_signal'
        AND evidence.source_record_id=concat(
          'podcast:',podcast_signal.episode_id::text,':',podcast_signal.signal_type,':',podcast_signal.canonical_key
        )
       LEFT JOIN podcast_episode podcast_episode ON podcast_episode.id=podcast_signal.episode_id
       LEFT JOIN item podcast_item ON podcast_item.id=podcast_episode.item_id
       WHERE evidence.event_id = $1::uuid
         AND ${activeSocialEvidenceSql()}
         AND (
           evidence.source_record_type <> 'item'
           OR (CASE WHEN lower(COALESCE(source.name, '')) = 'gdelt'
               THEN source_item.payload->>'quality_status' = 'accepted'
               ELSE COALESCE(source_item.payload->>'quality_status', 'accepted') = 'accepted'
             END)
         )
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
                  || '?v=' || left(asset.content_hash, 16)
              ) ORDER BY CASE asset.asset_type WHEN 'preview' THEN 0 WHEN 'thumbnail' THEN 1 ELSE 2 END,
                         asset.width DESC) FILTER (WHERE asset.id IS NOT NULL), '[]'::jsonb) AS assets
       FROM earth_observation observation
       JOIN earth_scene scene ON scene.id = observation.scene_id
       LEFT JOIN earth_observation_asset asset ON asset.observation_id = observation.id
        AND (asset.expires_at IS NULL OR asset.expires_at > now())
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
         AND ${intelligenceEventHasDisplayableEvidenceSql("related")}
       ORDER BY relationship.confidence DESC, related.last_activity_time DESC
       LIMIT 20`,
      [eventId],
    ),
  ]);
  const event = eventResult.rows[0];
  if (!event) return null;
  const translations = await loadTranslationContext([eventId, ...relatedResult.rows.map((row: any) => row.id)],
    evidenceResult.rows.filter((row: any) => row.domain === "news" && row.source_record_type === "item")
      .map((row: any) => String(row.source_record_id)), displayLanguage);
  const normalizedEvent = translateEventPresentation(eventToApi(event), translations);
  const evidence = evidenceResult.rows.map((row: any) => {
    const gdeltPresentation = row.source_record_type === "global_event"
      ? buildGdeltEventPresentation({
          eventCode: row.gdelt_event_code,
          eventRootCode: row.gdelt_event_root_code,
          actor1: row.gdelt_actor1_name,
          actor2: row.gdelt_actor2_name,
          location: row.gdelt_action_geo_name,
          countryIso2: row.gdelt_country_iso2,
          mentionCount: row.gdelt_mention_count,
          sourceCount: row.gdelt_source_count,
          articleCount: row.gdelt_article_count,
        })
      : null;
    return translateEvidencePresentation({
      ...row,
      source_title: gdeltPresentation?.title ?? row.source_title,
      source_summary: gdeltPresentation?.summary ?? row.source_summary,
      confidence: Number(row.confidence),
      correlation_score: row.correlation_score == null ? null : Number(row.correlation_score),
      observed_at: iso(row.observed_at),
      published_at: iso(row.published_at),
    }, translations);
  });
  const linkedNews = evidence.filter((row: any) => (
    row.domain === "news" && row.source_record_type === "item"
  )).map((row: any) => buildLinkedNewsPresentation(row));
  const [socialContext, regionalReporting, contextSignals, newsImages, contextImages] = await Promise.all([
    options.includeContext ? getSocialEventContexts([eventId]) : Promise.resolve([]),
    options.includeContext ? getRegionalReporting(normalizedEvent) : Promise.resolve(null),
    options.includeContext ? getRegionalContext(normalizedEvent) : Promise.resolve([]), listNewsImages({ eventId, limit: 6 }),
    getEventContextImages(normalizedEvent).catch((error) => {
      console.warn(JSON.stringify({ event: "event_context_images_unavailable", event_id: eventId, message: error instanceof Error ? error.message : String(error) }));
      return [];
    }),
  ]);
  return {
    event: normalizedEvent,
    context_included: options.includeContext === true,
    social_context: socialContext,
    regional_reporting: regionalReporting satisfies Awaited<ReturnType<typeof getRegionalReporting>>,
    signal_coverage: buildSignalCoverage(evidence, socialContext),
    context_signals: contextSignals,
    understanding: buildEventUnderstanding(normalizedEvent as Record<string, unknown>, evidence),
    evidence,
    linked_news: linkedNews,
    news_images: newsImages.filter((image) => isTimelyEventMedia(normalizedEvent, image.article_published_at)),
    context_images: contextImages,
    locations: locationsResult.rows.map((row: any) => ({
      ...row,
      distance_km: row.distance_km == null ? null : Number(row.distance_km),
      confidence: Number(row.confidence),
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      bbox: Array.isArray(row.bbox) ? row.bbox.map(Number) : row.bbox,
      importance_score: Number(row.importance_score),
      monitoring_tier: Number(row.monitoring_tier),
    })),
    earth_observations: observationsResult.rows.filter((row: any) => isTimelyEventMedia(normalizedEvent, row.capture_start)).map((row: any) => normalizeEarthObservationRow({
      ...row,
      event_title: normalizedEvent.title,
      event_summary: normalizedEvent.summary,
      event_type: normalizedEvent.event_type,
      event_status: normalizedEvent.status,
      event_severity: normalizedEvent.severity,
      event_start_time: normalizedEvent.start_time,
      event_last_activity_time: normalizedEvent.last_activity_time,
      event_country_iso2: normalizedEvent.primary_country_iso2,
      event_relevance_score: normalizedEvent.relevance_score,
      event_urgency_score: normalizedEvent.urgency_score,
      event_materiality_score: normalizedEvent.materiality_score,
      event_score_components: normalizedEvent.score_components,
      event_latitude: normalizedEvent.latitude,
      event_longitude: normalizedEvent.longitude,
      location_name: normalizedEvent.location_name,
      location_country_iso2: normalizedEvent.primary_country_iso2,
      linked_news_count: linkedNews.length,
      linked_news: linkedNews,
    })),
    related_events: relatedResult.rows.map((row: any) => translateEventPresentation({
      ...row,
      confidence: Number(row.confidence),
      relevance_score: Number(row.relevance_score),
      last_activity_time: iso(row.last_activity_time),
    }, translations)),
    epistemic_notice: "Reported events, observed signals, derived metrics, model interpretations and Claritas assessments are labelled separately. Correlation does not establish causation.",
  };
}

function normalizeEarthObservationRow(row: any) {
  return earthObservationToApi(row);
}

/**
 * Recomputes the canonical event aggregate after any evidence mutation. Model
 * interpretation and coverage-only assessments are not counted as independent
 * corroboration, and only observed physical evidence earns the physical-
 * observation component.
 */
export async function recomputeIntelligenceEventAggregateTx(client: PoolClient, eventId: string) {
  const { rows } = await client.query<EventRow>(
    `UPDATE intelligence_event event SET
       domain_count = aggregate.domain_count,
       source_diversity = aggregate.source_diversity,
       confidence = GREATEST(event.confidence, aggregate.average_confidence),
       relevance_score = LEAST(1,
         COALESCE(aggregate.base_relevance,
           CASE WHEN jsonb_typeof(event.score_components->'base_relevance')='number'
             THEN (event.score_components->>'base_relevance')::double precision END,
           event.relevance_score)
         + LEAST(0.16,GREATEST(0,aggregate.domain_count-1)*0.05)
         + LEAST(0.10,GREATEST(0,aggregate.source_diversity-1)*0.025)
         + CASE WHEN aggregate.has_physical_observation THEN 0.08 ELSE 0 END
         + COALESCE(aggregate.visual_signal_bonus,0)
         + LEAST(0.06, 0.02 * (SELECT count(DISTINCT related.event_type)
             FROM intelligence_event_relationship edge
             JOIN intelligence_event related ON related.id=edge.to_event_id
             WHERE edge.from_event_id=event.id AND edge.relationship='related'
               AND related.event_type<>event.event_type
               AND related.status IN ('emerging','active','monitoring')
               AND ${intelligenceEventExpiresAtSql("related")}>now()))
       ),
       urgency_score = GREATEST(event.urgency_score,COALESCE(aggregate.max_urgency,0)),
       materiality_score = GREATEST(event.materiality_score,COALESCE(aggregate.max_materiality,0)),
       score_components = event.score_components || jsonb_build_object(
         'aggregation_methodology','evidence-diversity-v5',
         'related_event_bonus_cap',0.06,
         'base_relevance',COALESCE(aggregate.base_relevance,
           CASE WHEN jsonb_typeof(event.score_components->'base_relevance')='number'
             THEN (event.score_components->>'base_relevance')::double precision END,
           event.relevance_score),
         'domain_count',aggregate.domain_count,
         'source_diversity',aggregate.source_diversity,
         'physical_observation',aggregate.has_physical_observation,
         'visual_analysis_bonus',COALESCE(aggregate.visual_signal_bonus,0),
         'visual_analysis_bonus_cap',0.04
       ),
       updated_at = now()
     FROM (
       SELECT event_id,
              (count(DISTINCT domain)
                FILTER (WHERE relationship NOT IN ('model_interpretation','assessment') AND domain<>'social'))::int AS domain_count,
              (count(DISTINCT COALESCE(
                NULLIF(provenance->>'source_diversity_key',''),
                NULLIF(provenance->>'publisher',''),
                NULLIF(provenance->>'provider',''),
                source_id::text,
                source_record_type
              ))
                FILTER (WHERE relationship NOT IN ('model_interpretation','assessment') AND domain<>'social'))::int AS source_diversity,
              avg(confidence) FILTER (WHERE relationship NOT IN ('model_interpretation','assessment','context') AND domain<>'social') AS average_confidence,
              max(CASE WHEN jsonb_typeof(metadata->'signal_relevance_score')='number'
                THEN (metadata->>'signal_relevance_score')::double precision END)
                FILTER (WHERE relationship NOT IN ('model_interpretation','assessment') AND domain<>'social') AS base_relevance,
              max(CASE WHEN jsonb_typeof(metadata->'signal_urgency_score')='number'
                THEN (metadata->>'signal_urgency_score')::double precision END)
                FILTER (WHERE relationship NOT IN ('model_interpretation','assessment') AND domain<>'social') AS max_urgency,
              max(CASE WHEN jsonb_typeof(metadata->'signal_materiality_score')='number'
                THEN (metadata->>'signal_materiality_score')::double precision END)
                FILTER (WHERE relationship NOT IN ('model_interpretation','assessment') AND domain<>'social') AS max_materiality,
              bool_or(relationship='observed' AND domain IN ('earth_observation','disaster')) AS has_physical_observation,
              max(CASE WHEN relationship='model_interpretation' AND source_record_type='earth_observation_vision'
                AND observed_at BETWEEN now()-interval '72 hours' AND now()+interval '5 minutes'
                AND jsonb_typeof(metadata->'visual_signal_score')='number'
                THEN LEAST(0.04,GREATEST(0,(metadata->>'visual_signal_score')::double precision)) ELSE 0 END) AS visual_signal_bonus
       FROM intelligence_event_evidence WHERE event_id = $1 GROUP BY event_id
     ) aggregate
     WHERE event.id = aggregate.event_id
     RETURNING event.*`,
    [eventId],
  );
  return rows[0] ?? null;
}

async function loadSignalLocation(client: PoolClient, locationId: string | null | undefined) {
  if (!locationId) return null;
  const { rows } = await client.query<SignalLocation>(
    `SELECT id,location_type,latitude,longitude
     FROM intelligence_location WHERE id=$1::uuid AND active`,
    [locationId],
  );
  return rows[0] ?? null;
}

function correlationLockKey(input: IntelligenceSignalInput, location: SignalLocation | null, entityKeys: string[]) {
  const family = eventFamilyTypes(input.eventType)[0];
  if (location && location.location_type !== "country") return `${family}:location:${location.id}`;
  if (finiteCoordinate(input.latitude) && finiteCoordinate(input.longitude)) {
    const latitudeCell = Math.round((input.latitude as number) * 4) / 4;
    const longitudeCell = Math.round((input.longitude as number) * 4) / 4;
    return `${family}:cell:${latitudeCell}:${longitudeCell}`;
  }
  if (entityKeys.length) return `${family}:entity:${entityKeys[0]}`;
  return `${family}:origin:${input.evidence.domain}:${input.evidence.sourceRecordType}:${input.evidence.sourceRecordId}`;
}

async function findExistingSourceEvent(client: PoolClient, input: IntelligenceSignalInput) {
  const { rows } = await client.query<any>(
    `SELECT event.*,evidence.correlation_score,evidence.correlation_factors,
            location.location_type,
            COALESCE(
              CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END,
              CASE WHEN location.location_type <> 'country' THEN location.latitude END
            )::double precision AS candidate_latitude,
            COALESCE(
              CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END,
              CASE WHEN location.location_type <> 'country' THEN location.longitude END
            )::double precision AS candidate_longitude
     FROM intelligence_event_evidence evidence
     JOIN intelligence_event event ON event.id=evidence.event_id
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     WHERE evidence.domain=$1 AND evidence.source_record_type=$2 AND evidence.source_record_id=$3
     ORDER BY evidence.created_at,event.created_at LIMIT 1
     FOR UPDATE OF event`,
    [input.evidence.domain, input.evidence.sourceRecordType, input.evidence.sourceRecordId],
  );
  return rows[0] ?? null;
}

async function findCorrelationCandidates(
  client: PoolClient,
  input: IntelligenceSignalInput,
  location: SignalLocation | null,
  entityKeys: string[],
  bounds: ReturnType<typeof correlationBounds>,
) {
  const anchoredLocationId = location?.location_type === "country" ? null : location?.id ?? null;
  const latitude = finiteCoordinate(input.latitude) ? input.latitude : null;
  const longitude = finiteCoordinate(input.longitude) ? input.longitude : null;
  const country = input.primaryCountryIso2?.trim().toUpperCase() || null;
  const { rows } = await client.query<CorrelationCandidateRow>(
    `SELECT event.*,
            location.location_type,
            COALESCE(
              CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END,
              CASE WHEN location.location_type <> 'country' THEN location.latitude END
            )::double precision AS candidate_latitude,
            COALESCE(
              CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END,
              CASE WHEN location.location_type <> 'country' THEN location.longitude END
            )::double precision AS candidate_longitude,
            COALESCE((
              SELECT array_agg(DISTINCT entity.entity_key ORDER BY entity.entity_key)
              FROM intelligence_event_entity entity WHERE entity.event_id=event.id
            ),ARRAY[]::text[]) AS entity_keys
     FROM intelligence_event event
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     WHERE event.status IN ('emerging','active','monitoring')
       AND (event.event_type=ANY($1::text[])
         OR ($4::uuid IS NOT NULL AND event.primary_location_id=$4::uuid)
         OR (cardinality($9::text[])>0 AND EXISTS (
           SELECT 1 FROM intelligence_event_entity anchor
           WHERE anchor.event_id=event.id AND anchor.entity_key=ANY($9::text[])
         )))
       AND event.last_activity_time BETWEEN $2::timestamptz-make_interval(secs=>$3::int)
                                        AND $2::timestamptz+make_interval(secs=>$3::int)
       AND (
         ($4::uuid IS NOT NULL AND event.primary_location_id=$4::uuid)
         OR ($5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
             AND event.geography IS NOT NULL
             AND ST_DWithin(event.geography::geography,
               ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,$7::double precision*1000))
         OR ($8::text IS NOT NULL AND event.primary_country_iso2=$8)
         OR (cardinality($9::text[])>0 AND EXISTS (
           SELECT 1 FROM intelligence_event_entity entity
           WHERE entity.event_id=event.id AND entity.entity_key=ANY($9::text[])
         ))
       )
     ORDER BY CASE
       WHEN cardinality($9::text[])>0 AND EXISTS (
         SELECT 1 FROM intelligence_event_entity anchor
         WHERE anchor.event_id=event.id AND anchor.entity_key=ANY($9::text[])
       ) THEN 2
       WHEN event.primary_location_id=$4::uuid THEN 1 ELSE 0 END DESC,
       event.last_activity_time DESC,event.relevance_score DESC
     LIMIT 50`,
    [eventFamilyTypes(input.eventType), input.evidence.observedAt, Math.round(bounds.maxHours * 3_600),
     anchoredLocationId, latitude, longitude, bounds.maxDistanceKm, country, entityKeys],
  );
  return rows;
}

async function findMajorEventContextCandidates(
  client: PoolClient,
  input: IntelligenceSignalInput,
  location: SignalLocation | null,
  entityKeys: string[],
  policy: NonNullable<ReturnType<typeof contextualLinkagePolicy>>,
  options: { excludeEventId?: string | null; onlyEventId?: string | null },
) {
  const anchoredLocationId = location?.location_type === "country" ? null : location?.id ?? null;
  const latitude = finiteCoordinate(input.latitude) ? input.latitude : null;
  const longitude = finiteCoordinate(input.longitude) ? input.longitude : null;
  const country = input.primaryCountryIso2?.trim().toUpperCase() || null;
  const { rows } = await client.query<MajorEventContextCandidateRow>(
    `SELECT event.*,
            location.location_type,
            CASE WHEN event.geography IS NULL THEN NULL
              ELSE ST_Y(ST_PointOnSurface(event.geography)) END::double precision AS candidate_latitude,
            CASE WHEN event.geography IS NULL THEN NULL
              ELSE ST_X(ST_PointOnSurface(event.geography)) END::double precision AS candidate_longitude,
            CASE WHEN event.geography IS NULL THEN NULL
              ELSE ST_Y(ST_PointOnSurface(event.geography)) END::double precision AS start_latitude,
            CASE WHEN event.geography IS NULL THEN NULL
              ELSE ST_X(ST_PointOnSurface(event.geography)) END::double precision AS start_longitude,
            COALESCE((
              SELECT array_agg(DISTINCT entity.entity_key ORDER BY entity.entity_key)
              FROM intelligence_event_entity entity WHERE entity.event_id=event.id
            ),ARRAY[]::text[]) AS entity_keys
     FROM intelligence_event event
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     WHERE event.status IN ('emerging','active','monitoring')
       AND event.event_type='earthquake'
       AND event.severity IN ('medium','high','critical')
       AND event.geography IS NOT NULL
       AND event.metadata @> '{"exact_geography":true}'::jsonb
       AND event.start_time BETWEEN
         $1::timestamptz-make_interval(secs=>$2::int)
         AND $1::timestamptz+make_interval(secs=>$3::int)
       AND ($11::uuid IS NULL OR event.id<>$11::uuid)
       AND (
         ($4::uuid IS NOT NULL AND event.primary_location_id=$4::uuid)
         OR ($5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
             AND ST_DWithin(event.geography::geography,
               ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,$7::double precision*1000))
         OR ($8::text IS NOT NULL AND event.primary_country_iso2=$8)
         OR (cardinality($9::text[])>0 AND EXISTS (
           SELECT 1 FROM intelligence_event_entity entity
           WHERE entity.event_id=event.id AND entity.entity_key=ANY($9::text[])
         ))
       )
     ORDER BY CASE WHEN $10::uuid IS NOT NULL AND event.id=$10::uuid THEN 1 ELSE 0 END DESC,
              CASE event.severity WHEN 'critical' THEN 3 WHEN 'high' THEN 2 ELSE 1 END DESC,
              event.relevance_score DESC,event.start_time DESC,event.id
     LIMIT 20`,
    [input.evidence.observedAt, Math.round(policy.afterHours * 3_600),
     Math.round(policy.beforeHours * 3_600), anchoredLocationId, latitude, longitude,
     policy.maxDistanceKm, country, entityKeys, options.onlyEventId ?? null,
     options.excludeEventId ?? null],
  );
  return rows;
}

async function persistCorrelationDecision(
  client: PoolClient,
  input: IntelligenceSignalInput,
  selectedEventId: string,
  decision: "created" | "attached",
  candidateEventId: string | null,
  score: number | null,
  threshold: number,
  factors: Record<string, unknown>,
  methodology: string,
  rationale: string,
) {
  await client.query(
    `INSERT INTO intelligence_correlation_decision (
       source_record_type,source_record_id,candidate_event_id,selected_event_id,
       decision,score,threshold,factors,methodology,rationale
     ) VALUES ($1,$2,$3::uuid,$4::uuid,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (source_record_type,source_record_id,selected_event_id,decision) DO UPDATE SET
       candidate_event_id=EXCLUDED.candidate_event_id,score=EXCLUDED.score,
       threshold=EXCLUDED.threshold,factors=EXCLUDED.factors,
       methodology=EXCLUDED.methodology,rationale=EXCLUDED.rationale`,
    [input.evidence.sourceRecordType, input.evidence.sourceRecordId, candidateEventId,
     selectedEventId, decision, score, threshold, JSON.stringify(factors), methodology, rationale],
  );
}

async function persistRelatedEventRelationships(
  client: PoolClient,
  selectedEventId: string,
  candidates: ScoredCorrelationCandidate<CorrelationCandidateRow & CorrelationCandidate>[],
) {
  for (const { candidate, correlation } of candidates) {
    const components = correlation.components;
    const supports = [
      components.location === 1 ? "the same specific location" : null,
      components.spatial >= 0.25 ? "bounded spatial proximity" : null,
      components.instrument === 1 ? "the same financial instrument" : null,
      components.entity >= 0.25 ? `shared entity anchors${correlation.matchedEntities?.length ? ` (${correlation.matchedEntities.join(", ")})` : ""}` : null,
      components.event_type === 1 ? "the same event topic" : null,
    ].filter((value): value is string => Boolean(value));
    const rationale = `Potentially related by nearby timing and ${supports.join(" and ")} (weighted correlation ${correlation.score.toFixed(4)}). This link does not assert causation or that the events are identical.`;
    await client.query(
      `WITH candidate AS (
         SELECT id FROM intelligence_event WHERE id=$2::uuid AND id<>$1::uuid
       ), edges AS (
         SELECT $1::uuid AS from_event_id,id AS to_event_id FROM candidate
         UNION ALL
         SELECT id,$1::uuid FROM candidate
       )
       INSERT INTO intelligence_event_relationship (
         from_event_id,to_event_id,relationship,confidence,rationale
       )
       SELECT from_event_id,to_event_id,'related',$3,$4 FROM edges
       ON CONFLICT (from_event_id,to_event_id,relationship) DO UPDATE SET
         confidence=GREATEST(intelligence_event_relationship.confidence,EXCLUDED.confidence),
         rationale=CASE WHEN EXCLUDED.confidence>=intelligence_event_relationship.confidence
           THEN EXCLUDED.rationale ELSE intelligence_event_relationship.rationale END`,
      [selectedEventId, candidate.id, correlation.score, rationale],
    );
  }
}

/**
 * Resolves stable source identity first, then evaluates recent event candidates.
 * The advisory lock serializes signals sharing the same defensible anchor so
 * independent consumers cannot create parallel canonical events concurrently.
 *
 * Some evidence (for example a podcast transcript claim) is valuable only as
 * qualified context for an event that already exists. Those callers use
 * `createWhenUnmatched: false` so a loose mention cannot create a standalone
 * investigation merely because it shares a country or a topical phrase.
 */
async function correlateIntelligenceSignal(
  input: IntelligenceSignalInput,
  options: { createWhenUnmatched: boolean },
) {
  return withTransaction(async (client) => {
    const upsertOptions = options.createWhenUnmatched
      ? {}
      : { suppressAlertCandidate: true, suppressEarthObservation: true, preserveCanonical: true };
    const entityKeys = normalizedEntityKeys(input.entityKeys);
    const location = await loadSignalLocation(client, input.primaryLocationId);
    const coordinates = resolveSignalCoordinates({
      latitude: input.latitude,
      longitude: input.longitude,
      coordinatesAreExact: input.coordinatesAreExact,
      locationType: location?.location_type,
    });
    const normalizedInput: IntelligenceSignalInput = coordinates
      ? { ...input, latitude: coordinates.latitude, longitude: coordinates.longitude }
      : { ...input, latitude: null, longitude: null };
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [correlationLockKey(normalizedInput, location, entityKeys)]);
    const bounds = correlationBounds(normalizedInput.eventType);
    const candidates = await findCorrelationCandidates(client, normalizedInput, location, entityKeys, bounds);
    const signalCandidate: CorrelationCandidate = {
      eventType: normalizedInput.eventType,
      observedAt: normalizedInput.evidence.observedAt,
      latitude: normalizedInput.latitude ?? null,
      longitude: normalizedInput.longitude ?? null,
      locationId: location?.location_type === "country" ? null : location?.id ?? null,
      countryIso2: normalizedInput.primaryCountryIso2 ?? null,
      entityKeys,
      sourceReliability: normalizedInput.evidence.confidence,
    };
    const ranked = rankCorrelationCandidates(signalCandidate, candidates.map((candidate) => ({
      ...candidate,
      eventType: candidate.event_type,
      observedAt: new Date(candidate.last_activity_time),
      latitude: candidate.candidate_latitude == null ? null : Number(candidate.candidate_latitude),
      longitude: candidate.candidate_longitude == null ? null : Number(candidate.candidate_longitude),
      locationId: candidate.location_type === "country" ? null : candidate.primary_location_id,
      countryIso2: candidate.primary_country_iso2,
      entityKeys: candidate.entity_keys ?? [],
      sourceReliability: Number(candidate.confidence),
    })), bounds);
    const existingSource = await findExistingSourceEvent(client, normalizedInput);
    if (existingSource) {
      const storedFactors = existingSource.correlation_factors && typeof existingSource.correlation_factors === "object"
        ? existingSource.correlation_factors as Record<string, unknown> : {};
      const storedDecision = storedFactors.decision === "created" ? "created" : "attached";
      const existingInput: IntelligenceSignalInput = {
        ...normalizedInput,
        dedupeKey: existingSource.dedupe_key,
        entityKeys,
        evidence: {
          ...input.evidence,
          correlationScore: Number(existingSource.correlation_score ?? 1),
          correlationFactors: storedFactors,
        },
      };
      const selected = await upsertIntelligenceSignalTx(client, existingInput, upsertOptions);
      await persistCorrelationDecision(
        client, normalizedInput, selected.id, storedDecision, storedDecision === "attached" ? selected.id : null,
        storedDecision === "attached" ? Number(existingSource.correlation_score ?? 1) : null,
        bounds.threshold, storedFactors,
        String(storedFactors.methodology ?? (storedDecision === "created" ? "source-origin-v2" : "weighted-v1")),
        "Existing source record retained its canonical event assignment.",
      );
      const related = qualifiedRelatedCorrelationCandidates(ranked, selected.id, bounds.threshold);
      await persistRelatedEventRelationships(client, selected.id, related);
      for (const { candidate } of related) await recomputeIntelligenceEventAggregateTx(client, candidate.id);
      const updated = await recomputeIntelligenceEventAggregateTx(client, selected.id);
      return updated ? eventToApi(updated) : selected;
    }

    if (!options.createWhenUnmatched) {
      for (const entry of ranked) {
        const { temporal, entity, instrument } = entry.correlation.components;
        if (temporal > 0 && (entity >= 0.5 || instrument === 1) && entry.correlation.score >= bounds.threshold) {
          entry.correlation.accepted = true;
        }
      }
    }
    const { strongest, accepted, decisionSubject } = selectCorrelationOutcome(ranked);
    if (accepted) await client.query(`SELECT id FROM intelligence_event WHERE id=$1::uuid FOR UPDATE`, [accepted.candidate.id]);

    // An attach-only source must have passed the same anchored correlation
    // guard as every other cross-domain link. Country and time coincidence are
    // intentionally insufficient and therefore leave the source unlinked.
    if (!accepted && !options.createWhenUnmatched) return null;

    const decision = accepted ? "attached" as const : "created" as const;
    const methodology = accepted?.correlation.methodology ?? strongest?.correlation.methodology ?? "source-origin-v2";
    const factors = accepted
      ? { ...accepted.correlation.components, matched_entities: accepted.correlation.matchedEntities ?? [], methodology, decision }
      : {
          ...(strongest?.correlation.components ?? {}),
          methodology,
          decision,
          basis: "no_candidate_passed_anchored_threshold",
        };
    const targetDedupe = accepted?.candidate.dedupe_key
      ?? buildEventDedupeKey(["event-origin-v2", normalizedInput.evidence.domain, normalizedInput.evidence.sourceRecordType, normalizedInput.evidence.sourceRecordId]);
    const correlatedInput: IntelligenceSignalInput = {
      ...normalizedInput,
      dedupeKey: targetDedupe,
      entityKeys,
      evidence: {
        ...input.evidence,
        correlationScore: accepted?.correlation.score ?? 1,
        correlationFactors: factors,
      },
    };
    const selected = await upsertIntelligenceSignalTx(client, correlatedInput, upsertOptions);
    await persistCorrelationDecision(
      client, normalizedInput, selected.id, decision, decisionSubject?.candidate.id ?? null,
      decisionSubject?.correlation.score ?? null, bounds.threshold, factors, methodology,
      accepted
        ? "Strongest accepted candidate passed the governed anchored-correlation threshold."
        : "No candidate had sufficient spatial, specific-location, or entity support; a new event was created.",
    );
    await persistRelatedEventRelationships(
      client,
      selected.id,
      qualifiedRelatedCorrelationCandidates(ranked, selected.id, bounds.threshold),
    );
    const updated = await recomputeIntelligenceEventAggregateTx(client, selected.id);
    for (const { candidate } of qualifiedRelatedCorrelationCandidates(ranked, selected.id, bounds.threshold)) {
      await recomputeIntelligenceEventAggregateTx(client, candidate.id);
    }
    return updated ? eventToApi(updated) : selected;
  });
}

/**
 * Correlates a source into an existing event where possible, creating a new
 * canonical event only for sources that are themselves event-generating.
 */
export async function correlateAndUpsertIntelligenceSignal(input: IntelligenceSignalInput) {
  const selected = await correlateIntelligenceSignal(input, { createWhenUnmatched: true });
  if (!selected) throw new Error("Event-generating signal unexpectedly had no correlation outcome.");
  return selected;
}

/**
 * Adds qualified contextual evidence only when it passes the anchored
 * correlation policy. This is used for inherently interpretive sources such
 * as podcast extraction, which must not create a new investigation on their
 * own.
 */
export async function attachIntelligenceSignalToExistingEvent(input: IntelligenceSignalInput) {
  return correlateIntelligenceSignal(input, { createWhenUnmatched: false });
}

export function contextualEvidenceLastActivity(input: {
  candidateLastActivity: Date;
  evidenceObservedAt: Date;
  relationship: IntelligenceSignalInput["evidence"]["relationship"];
}) {
  if (input.relationship === "assessment") return input.candidateLastActivity;
  return input.candidateLastActivity.getTime() >= input.evidenceObservedAt.getTime()
    ? input.candidateLastActivity : input.evidenceObservedAt;
}

/**
 * Adds a signal as non-causal context to one precisely located, context-
 * eligible earthquake (M7+ or a materially significant moderate event).
 * This is intentionally separate from canonical correlation: a weather model
 * sample or transport comparison remains its own kind of signal and cannot
 * turn the canonical earthquake into a weather/transport event (or vice
 * versa). The strongest accepted earthquake candidate wins; ambiguous
 * country-only reporting is rejected by the pure policy.
 */
export async function attachIntelligenceSignalToMajorEventContext(
  input: IntelligenceSignalInput,
  options: {
    excludeEventId?: string | null;
    onlyEventId?: string | null;
    targetedDiscovery?: TargetedEarthquakeContextAudit | null;
  } = {},
) {
  const policy = contextualLinkagePolicy("earthquake", input.evidence.domain);
  if (!policy) return null;
  const targetedDiscovery = options.targetedDiscovery ?? null;
  if (targetedDiscovery && (
    !options.onlyEventId
    || !["local_place", "event_signature"].includes(targetedDiscovery.scope)
    || !Number.isFinite(targetedDiscovery.confidence)
    || targetedDiscovery.confidence < 0.75
    || targetedDiscovery.confidence > 1
  )) return null;
  return withTransaction(async (client) => {
    const entityKeys = normalizedEntityKeys(input.entityKeys);
    const location = await loadSignalLocation(client, input.primaryLocationId);
    const coordinates = resolveSignalCoordinates({
      latitude: input.latitude,
      longitude: input.longitude,
      coordinatesAreExact: input.coordinatesAreExact,
      locationType: location?.location_type,
    });
    const normalizedInput: IntelligenceSignalInput = coordinates
      ? { ...input, latitude: coordinates.latitude, longitude: coordinates.longitude }
      : { ...input, latitude: null, longitude: null };
    const candidates = await findMajorEventContextCandidates(
      client, normalizedInput, location, entityKeys, policy, options,
    );
    if (!candidates.length) return null;

    const eligibleCandidates: Array<{
      candidate: MajorEventContextCandidateRow;
      candidatePolicy: ContextualLinkagePolicy;
    }> = [];
    for (const candidate of candidates) {
      const candidatePolicy = contextualLinkagePolicy(
        candidate.event_type,
        normalizedInput.evidence.domain,
        storedEarthquakeContextAttributes(candidate),
      );
      if (candidatePolicy) eligibleCandidates.push({ candidate, candidatePolicy });
    }
    if (!eligibleCandidates.length) return null;

    const country = normalizedInput.primaryCountryIso2?.trim().toUpperCase() || null;
    const countryCandidateCount = country
      ? eligibleCandidates.filter(({ candidate, candidatePolicy }) => {
          if (candidate.primary_country_iso2?.trim().toUpperCase() !== country) return false;
          const deltaHours = (normalizedInput.evidence.observedAt.getTime()
            - new Date(candidate.start_time).getTime()) / 3_600_000;
          return deltaHours >= -candidatePolicy.beforeHours && deltaHours <= candidatePolicy.afterHours;
        }).length
      : 0;
    const signalCandidate: CorrelationCandidate = {
      eventType: normalizedInput.eventType,
      observedAt: normalizedInput.evidence.observedAt,
      latitude: normalizedInput.latitude ?? null,
      longitude: normalizedInput.longitude ?? null,
      locationId: location?.location_type === "country" ? null : location?.id ?? null,
      countryIso2: country,
      entityKeys,
      sourceReliability: normalizedInput.evidence.confidence,
    };
    const ranked = eligibleCandidates.map(({ candidate, candidatePolicy }) => {
      const anchor: CorrelationCandidate = {
        eventType: candidate.event_type,
        observedAt: new Date(candidate.start_time),
        latitude: candidate.start_latitude == null ? null : Number(candidate.start_latitude),
        longitude: candidate.start_longitude == null ? null : Number(candidate.start_longitude),
        locationId: candidate.location_type === "country" ? null : candidate.primary_location_id,
        countryIso2: candidate.primary_country_iso2,
        entityKeys: candidate.entity_keys ?? [],
        sourceReliability: Number(candidate.confidence),
      };
      return {
        candidate,
        linkage: scoreContextualLinkage({
          anchor,
          signal: signalCandidate,
          domain: normalizedInput.evidence.domain,
          policy: candidatePolicy,
          uniqueCountryCandidate: countryCandidateCount === 1,
        }),
        policy: candidatePolicy,
      };
    }).sort((left, right) => right.linkage.score - left.linkage.score);
    const selected = ranked.find(({ candidate, linkage }) => linkage.accepted
      && (!options.onlyEventId || candidate.id === options.onlyEventId));
    if (!selected) return null;

    const originalRelationship = normalizedInput.evidence.relationship;
    const contextualRelationship = originalRelationship === "assessment"
      ? "assessment" : "context";
    const coverageStatus = normalizedInput.evidence.metadata?.coverage_status
      ?? normalizedInput.evidence.metadata?.classification
      ?? null;
    const targetedFactors = targetedDiscovery ? {
      targeted_discovery: true,
      targeted_discovery_methodology: targetedDiscovery.methodology,
      targeted_earthquake_observation_id: targetedDiscovery.earthquakeObservationId,
      targeted_usgs_event_id: targetedDiscovery.usgsEventId,
      targeted_event_place: targetedDiscovery.place,
      targeted_match_scope: targetedDiscovery.scope,
      targeted_match_confidence: targetedDiscovery.confidence,
      targeted_match_factors: targetedDiscovery.factors,
      targeted_match_rationale: targetedDiscovery.rationale,
    } : {};
    const linkage = {
      ...selected.linkage,
      factors: {
        ...selected.linkage.factors,
        evidence_relationship: contextualRelationship,
        coverage_assessment: contextualRelationship === "assessment",
        coverage_status: coverageStatus,
        ...targetedFactors,
      },
      rationale: targetedDiscovery
        ? `${selected.linkage.rationale} Exact target selection was additionally constrained by validated ${targetedDiscovery.scope.replace("_", " ")} metadata from a bounded event-specific discovery query: ${targetedDiscovery.rationale}`
        : selected.linkage.rationale,
    };

    await client.query(`SELECT id FROM intelligence_event WHERE id=$1::uuid FOR UPDATE`, [selected.candidate.id]);
    const candidate = selected.candidate;
    const candidateLastActivity = new Date(candidate.last_activity_time);
    const contextObservedAt = normalizedInput.evidence.observedAt;
    // A coverage assessment says only what Claritas could or could not
    // compare. It has its own evidence timestamp, but must not make the
    // underlying physical event appear newly active.
    const lastActivityTime = contextualEvidenceLastActivity({
      candidateLastActivity,
      evidenceObservedAt: contextObservedAt,
      relationship: contextualRelationship,
    });
    const contextualInput: IntelligenceSignalInput = {
      dedupeKey: candidate.dedupe_key,
      eventType: candidate.event_type,
      title: candidate.title,
      summary: candidate.summary,
      status: candidate.status as IntelligenceSignalInput["status"],
      severity: candidate.severity,
      confidence: Number(candidate.confidence),
      startTime: new Date(candidate.start_time),
      lastActivityTime,
      primaryLocationId: candidate.primary_location_id,
      primaryCountryIso2: candidate.primary_country_iso2,
      latitude: candidate.start_latitude == null ? null : Number(candidate.start_latitude),
      longitude: candidate.start_longitude == null ? null : Number(candidate.start_longitude),
      coordinatesAreExact: false,
      relevanceScore: Number(candidate.relevance_score),
      urgencyScore: Number(candidate.urgency_score),
      materialityScore: Number(candidate.materiality_score),
      scoreComponents: candidate.score_components ?? {},
      metadata: candidate.metadata ?? {},
      // Do not promote every contextual mention into a future canonical
      // entity anchor. The shared entities used for this decision are already
      // retained in the auditable factors below.
      entityKeys: candidate.entity_keys ?? [],
      evidence: {
        ...normalizedInput.evidence,
        relationship: contextualRelationship,
        correlationScore: linkage.score,
        correlationFactors: linkage.factors,
        provenance: {
          ...normalizedInput.evidence.provenance,
          contextual_association: selected.policy.policyVersion ?? "significant-earthquake-context-v2",
          ...(targetedDiscovery ? {
            targeted_discovery_methodology: targetedDiscovery.methodology,
            targeted_earthquake_observation_id: targetedDiscovery.earthquakeObservationId,
            targeted_usgs_event_id: targetedDiscovery.usgsEventId,
          } : {}),
        },
        metadata: {
          ...(normalizedInput.evidence.metadata ?? {}),
          title: normalizedInput.title,
          description: normalizedInput.summary,
          original_relationship: originalRelationship,
          linkage_rationale: linkage.rationale,
          context_evidence_kind: contextualRelationship === "assessment" ? "coverage_assessment" : "likely_linked_signal",
          ...(targetedDiscovery ? {
            targeted_discovery: {
              methodology: targetedDiscovery.methodology,
              earthquake_observation_id: targetedDiscovery.earthquakeObservationId,
              usgs_event_id: targetedDiscovery.usgsEventId,
              place: targetedDiscovery.place,
              match_scope: targetedDiscovery.scope,
              match_confidence: targetedDiscovery.confidence,
              match_factors: targetedDiscovery.factors,
              match_rationale: targetedDiscovery.rationale,
            },
          } : {}),
          assessment_boundary: targetedDiscovery?.assessmentBoundary
            ?? "Contextual association only. It neither establishes earthquake causation nor confirms physical or operational impact.",
        },
      },
    };
    const event = await upsertIntelligenceSignalTx(client, contextualInput, {
      // Context updates may advance the evidence timeline, but they must not
      // create a fresh high-severity notification or repeat EO discovery for
      // the already-established physical event.
      suppressAlertCandidate: true,
      suppressEarthObservation: true,
    });
    await persistCorrelationDecision(
      client, normalizedInput, event.id, "attached", candidate.id,
      linkage.score, selected.policy.threshold, linkage.factors,
      selected.policy.policyVersion ?? "significant-earthquake-context-v2", linkage.rationale,
    );
    return { event, linkage };
  });
}

export async function upsertIntelligenceSignal(input: IntelligenceSignalInput) {
  return withTransaction(async (client) => upsertIntelligenceSignalTx(client, input));
}

/**
 * Persists an independently reviewable context source without correlating it
 * to an arbitrary event or generating notification/imagery side effects.
 * A caller may subsequently attach the evidence to one explicitly validated
 * target through `attachIntelligenceSignalToMajorEventContext`.
 */
export async function upsertStandaloneContextSourceSignal(input: IntelligenceSignalInput) {
  return withTransaction(async (client) => upsertIntelligenceSignalTx(client, input, {
    suppressAlertCandidate: true,
    suppressEarthObservation: true,
  }));
}

export async function upsertIntelligenceSignalTx(
  client: PoolClient,
  input: IntelligenceSignalInput,
  options: { suppressAlertCandidate?: boolean; suppressEarthObservation?: boolean; preserveCanonical?: boolean } = {},
) {
  const existing = await client.query<Pick<EventRow, "id" | "severity" | "confidence" | "metadata" | "primary_location_id" | "primary_country_iso2"> & SignalLocation & { has_geography: boolean }>(
    `SELECT event.id,event.severity,event.confidence,event.metadata,event.primary_location_id,event.primary_country_iso2,
       event.geography IS NOT NULL AS has_geography,location.location_type,location.latitude,location.longitude
     FROM intelligence_event event LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     WHERE event.dedupe_key = $1 FOR UPDATE OF event`,
    [input.dedupeKey],
  );
  const incomingCanonicalRank = canonicalSignalRank(input);
  const canonicalEvidenceKey = `${input.evidence.domain}:${input.evidence.sourceRecordType}:${input.evidence.sourceRecordId}`;
  let trustedIncomingCoordinates = input.coordinatesAreExact === true
    ? resolveSignalCoordinates({
        latitude: input.latitude,
        longitude: input.longitude,
        coordinatesAreExact: true,
      })
    : null;
  const eventMetadata = { ...(input.metadata ?? {}) };
  delete eventMetadata.exact_geography;
  delete eventMetadata.geography_provenance_key;
  if (trustedIncomingCoordinates) {
    eventMetadata.exact_geography = true;
    eventMetadata.geography_provenance_key = canonicalEvidenceKey;
  }
  const replaceCanonical = !options.preserveCanonical && shouldReplaceCanonicalSignal({
    eventExists: Boolean(existing.rows[0]),
    existingCanonicalEvidenceKey: existing.rows[0]?.metadata?.canonical_evidence_key,
    existingCanonicalRank: existingCanonicalRank(existing.rows[0]),
    incomingEvidenceKey: canonicalEvidenceKey,
    incomingCanonicalRank,
  });
  const retainedLocation = input.evidence.domain === "news" && trustedIncomingCoordinates
    ? existing.rows[0]?.primary_location_id && existing.rows[0].location_type !== "country"
      ? existing.rows[0] : await loadSignalLocation(client, input.primaryLocationId)
    : null;
  const coordinateConflict = input.evidence.domain === "news" && trustedIncomingCoordinates
    && newsCoordinateConflictsWithLocation(trustedIncomingCoordinates, retainedLocation);
  if (coordinateConflict) {
    trustedIncomingCoordinates = null;
    delete eventMetadata.exact_geography;
    delete eventMetadata.geography_provenance_key;
    eventMetadata.geography_conflict = { reason: "news_coordinates_conflict_with_named_location", source: canonicalEvidenceKey };
  }
  // Provenance must describe the coordinates actually retained by the SQL
  // update, rather than the last enrichment record to arrive.
  if (existing.rows[0]?.has_geography && existing.rows[0].metadata.exact_geography === true && !replaceCanonical) {
    delete eventMetadata.exact_geography;
    delete eventMetadata.geography_provenance_key;
  }
  // Origin describes the source that opened the investigation, even when a
  // stronger source later becomes its canonical headline. Context must also
  // retain its own epistemic label rather than relabelling the whole event.
  if (existing.rows[0]) delete eventMetadata.origin_domain;
  if (!replaceCanonical) delete eventMetadata.epistemic_class;
  const existingSeverity = existing.rows[0]?.severity;
  const severity = existingSeverity ? maxSeverity(existingSeverity, input.severity) : input.severity;
  const confidence = existing.rows[0] && ["context", "model_interpretation", "assessment"].includes(input.evidence.relationship)
    ? Number(existing.rows[0].confidence) : input.confidence;
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
       $14,$15,$16,$17::jsonb,
       $18::jsonb || jsonb_build_object('canonical_signal_rank',$20::double precision,'canonical_evidence_key',$21::text)
     )
     ON CONFLICT (dedupe_key) DO UPDATE SET
       event_type = CASE WHEN $19::boolean THEN EXCLUDED.event_type ELSE intelligence_event.event_type END,
       title = CASE WHEN $19::boolean THEN EXCLUDED.title ELSE intelligence_event.title END,
       summary = CASE WHEN $19::boolean THEN EXCLUDED.summary ELSE intelligence_event.summary END,
       status = CASE
         WHEN intelligence_event.status = 'resolved' THEN 'monitoring'
         WHEN intelligence_event.status IN ('active','monitoring') AND EXCLUDED.status = 'emerging' THEN intelligence_event.status
         ELSE EXCLUDED.status
       END,
       severity = EXCLUDED.severity,
       confidence = GREATEST(intelligence_event.confidence, EXCLUDED.confidence),
       start_time = LEAST(intelligence_event.start_time, EXCLUDED.start_time),
       last_activity_time = GREATEST(intelligence_event.last_activity_time, EXCLUDED.last_activity_time),
       primary_location_id = CASE
         WHEN intelligence_event.primary_location_id IS NULL THEN EXCLUDED.primary_location_id
         WHEN EXCLUDED.primary_location_id IS NULL THEN intelligence_event.primary_location_id
         WHEN (SELECT location_type FROM intelligence_location WHERE id=intelligence_event.primary_location_id)='country'
          AND (SELECT location_type FROM intelligence_location WHERE id=EXCLUDED.primary_location_id)<>'country'
           THEN EXCLUDED.primary_location_id
         ELSE intelligence_event.primary_location_id
       END,
       primary_country_iso2 = COALESCE(intelligence_event.primary_country_iso2, EXCLUDED.primary_country_iso2),
       geography = CASE
         WHEN $22::boolean AND EXCLUDED.geography IS NOT NULL
          AND (NOT intelligence_event.metadata @> '{"exact_geography":true}'::jsonb OR $19::boolean)
           THEN EXCLUDED.geography
         ELSE COALESCE(intelligence_event.geography,EXCLUDED.geography)
       END,
       relevance_score = GREATEST(intelligence_event.relevance_score, EXCLUDED.relevance_score),
       urgency_score = GREATEST(intelligence_event.urgency_score, EXCLUDED.urgency_score),
       materiality_score = GREATEST(intelligence_event.materiality_score, EXCLUDED.materiality_score),
       score_components = intelligence_event.score_components || EXCLUDED.score_components,
       metadata = intelligence_event.metadata || $18::jsonb || CASE WHEN $19::boolean
         THEN jsonb_build_object('canonical_signal_rank',$20::double precision,'canonical_evidence_key',$21::text)
         ELSE '{}'::jsonb END,
       updated_at = now()
     RETURNING *`,
    [
      input.dedupeKey, input.eventType, input.title, input.summary, input.status ?? "active",
      severity, Math.min(1, Math.max(0, confidence)), input.startTime, input.lastActivityTime,
      input.primaryLocationId ?? null, coordinateConflict ? existing.rows[0]?.primary_country_iso2 ?? null : input.primaryCountryIso2?.toUpperCase() ?? null,
      trustedIncomingCoordinates?.latitude ?? null,
      trustedIncomingCoordinates?.longitude ?? null,
      Math.min(1, Math.max(0, input.relevanceScore)),
      Math.min(1, Math.max(0, input.urgencyScore)),
      Math.min(1, Math.max(0, input.materialityScore)),
      JSON.stringify(input.scoreComponents), JSON.stringify(eventMetadata),
      replaceCanonical, incomingCanonicalRank, canonicalEvidenceKey, Boolean(trustedIncomingCoordinates),
    ],
  );
  let event = eventResult.rows[0];
  if (input.evidence.domain === "news" && existing.rows[0]?.has_geography
      && input.primaryLocationId && existing.rows[0].primary_location_id !== event.primary_location_id) {
    // A named story can arrive after its coordinate-bearing enrichment.
    // Validate that upgrade too. News geometry can fall back to the named
    // place; an observed physical position must retain its original anchor.
    const newsPosition = `(event.metadata->>'geography_provenance_key' LIKE 'news:%')`;
    const { rows } = await client.query<EventRow>(`UPDATE intelligence_event event SET
      geography=CASE WHEN ${newsPosition} THEN NULL ELSE event.geography END,
      primary_location_id=CASE WHEN ${newsPosition} THEN event.primary_location_id ELSE $3::uuid END,
      primary_country_iso2=CASE WHEN ${newsPosition} THEN location.country_iso2 ELSE $4::text END,
      metadata=CASE WHEN ${newsPosition} THEN
        (event.metadata-'exact_geography'-'geography_provenance_key')||jsonb_build_object('geography_repair_v1',jsonb_build_object(
          'reason','news_coordinates_conflict_with_named_location','previous_latitude',ST_Y(ST_PointOnSurface(event.geography)),
          'previous_longitude',ST_X(ST_PointOnSurface(event.geography)),
          'previous_provenance',event.metadata->>'geography_provenance_key','repaired_at',now()))
        ELSE event.metadata||jsonb_build_object('geography_conflict',jsonb_build_object(
          'reason','named_location_conflicts_with_observed_coordinates','rejected_location_id',location.id)) END,
      updated_at=now()
      FROM intelligence_location location WHERE event.id=$1::uuid AND location.id=event.primary_location_id
        AND location.location_type=ANY($2::text[]) AND location.center IS NOT NULL
        AND NOT ST_DWithin(location.center,ST_PointOnSurface(event.geography)::geography,150000)
      RETURNING event.*`, [event.id, NAMED_POINT_LOCATION_TYPES, existing.rows[0].primary_location_id, existing.rows[0].primary_country_iso2]);
    if (rows[0]) event = rows[0];
  }
  if (input.primaryLocationId && event.primary_location_id === input.primaryLocationId) {
    await client.query(
      `INSERT INTO intelligence_event_location (event_id, location_id, relationship, confidence)
       VALUES ($1, $2, 'primary', $3)
       ON CONFLICT (event_id, location_id, relationship) DO UPDATE SET confidence = GREATEST(intelligence_event_location.confidence, EXCLUDED.confidence)`,
      [event.id, input.primaryLocationId, input.evidence.confidence],
    );
  }
  const entityKeys = normalizedEntityKeys(input.entityKeys);
  if (entityKeys.length) {
    await client.query(
      `INSERT INTO intelligence_event_entity (
         event_id,entity_type,entity_key,display_name,relationship,confidence,metadata
       )
       SELECT $1::uuid,'correlation_key',entity_key,entity_key,'mentioned',$3,'{"normalization":"lowercase-whitespace-v1"}'::jsonb
       FROM unnest($2::text[]) entity_key
       ON CONFLICT (event_id,entity_type,entity_key,relationship) DO UPDATE SET
         confidence=GREATEST(intelligence_event_entity.confidence,EXCLUDED.confidence)`,
      [event.id, entityKeys, Math.min(1, Math.max(0, input.evidence.confidence))],
    );
  }
  const evidenceMetadata = {
    ...(input.evidence.metadata ?? {}),
    signal_relevance_score: Math.min(1, Math.max(0, input.relevanceScore)),
    signal_urgency_score: Math.min(1, Math.max(0, input.urgencyScore)),
    signal_materiality_score: Math.min(1, Math.max(0, input.materialityScore)),
  };
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
      JSON.stringify(evidenceMetadata),
    ],
  );
  const currentEvent = await recomputeIntelligenceEventAggregateTx(client, event.id) ?? event;
  if (!options.suppressAlertCandidate
      && ["high", "critical"].includes(severity)
      && Number(currentEvent.relevance_score) >= Number(process.env.EVENT_ALERT_RELEVANCE_THRESHOLD ?? 0.72)
      && process.env.EVENT_ALERTS_ENABLED?.toLowerCase() === "true") {
    const candidateResult = await client.query<{ id: string }>(
      `INSERT INTO alert_candidate (event_id, dedupe_key, severity, title, body, eligibility)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         severity = EXCLUDED.severity, title = EXCLUDED.title, body = EXCLUDED.body,
         eligibility = alert_candidate.eligibility || EXCLUDED.eligibility, updated_at = now()
       RETURNING id`,
      [event.id, buildAlertDedupeKey(event.id, input.lastActivityTime), severity, currentEvent.title, currentEvent.summary,
       JSON.stringify({ minimum_relevance: currentEvent.relevance_score, country_iso2: currentEvent.primary_country_iso2 ?? null })],
    );
    await client.query(`SELECT materialize_alert_candidate_recipients($1::uuid, NULL)`, [candidateResult.rows[0].id]);
  }
  const requestedProducts = earthObservationProducts(currentEvent.event_type);
  const configuredEoThreshold = correlationNumberEnv("EO_EVENT_RELEVANCE_THRESHOLD", 0.72, 0, 1);
  const observableThreshold = correlationNumberEnv(
    "EO_OBSERVABLE_EVENT_RELEVANCE_THRESHOLD",
    Math.min(configuredEoThreshold, 0.46),
    0.25,
    1,
  ) + (severity === "low" ? 0.08 : 0);
  if (!options.suppressEarthObservation
      && process.env.EARTH_OBSERVATION_ENABLED?.toLowerCase() === "true"
      && requestedProducts
      && Number(currentEvent.relevance_score) >= observableThreshold) {
    let canonicalCoordinates: { latitude: number | null; longitude: number | null } | undefined;
    if (!trustedIncomingCoordinates) {
      const { rows } = await client.query<{ latitude: number | null; longitude: number | null }>(
        `SELECT ST_Y(ST_PointOnSurface(geography))::double precision AS latitude,
                ST_X(ST_PointOnSurface(geography))::double precision AS longitude
         FROM intelligence_event
         WHERE id=$1::uuid AND geography IS NOT NULL
           AND metadata @> '{"exact_geography":true}'::jsonb`,
        [event.id],
      );
      canonicalCoordinates = rows[0];
    }
    const exactCoordinates = resolveTrustedEventCoordinates({
      incomingLatitude: trustedIncomingCoordinates?.latitude,
      incomingLongitude: trustedIncomingCoordinates?.longitude,
      incomingCoordinatesAreExact: Boolean(trustedIncomingCoordinates),
      canonicalLatitude: canonicalCoordinates?.latitude,
      canonicalLongitude: canonicalCoordinates?.longitude,
      canonicalCoordinatesAreExact: Boolean(canonicalCoordinates),
    });
    if (exactCoordinates) {
    const now = new Date();
    const eventTime = new Date(currentEvent.start_time);
    const discoveryDate = now.toISOString().slice(0, 10);
    const latitude = exactCoordinates!.latitude;
    const longitude = exactCoordinates!.longitude;
    const aoiBbox = [
      Math.max(-180, longitude - 0.15), Math.max(-90, latitude - 0.15),
      Math.min(180, longitude + 0.15), Math.min(90, latitude + 0.15),
    ];
    const priority = Math.max(1, 100 - Math.round(Number(currentEvent.relevance_score) * 90));
    const dedupe = buildDiscoveryDedupeKey({
      eventId: event.id,
      locationId: currentEvent.primary_location_id ?? null,
      discoverySeries: "signal",
      discoveryWindow: discoveryDate,
    });
    await client.query(
      `INSERT INTO earth_processing_job (
         dedupe_key,job_type,provider,event_id,location_id,priority,available_at,parameters
       ) VALUES ($1,'scene_discovery','copernicus',$2,$3,$4,now(),$5::jsonb)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         priority=LEAST(earth_processing_job.priority,EXCLUDED.priority),
         available_at=LEAST(earth_processing_job.available_at,EXCLUDED.available_at),
         status=CASE WHEN earth_processing_job.status IN ('success','running')
           THEN earth_processing_job.status ELSE 'queued' END,
         updated_at=now()`,
      [dedupe, event.id, currentEvent.primary_location_id ?? null, priority,
       JSON.stringify({
         event_time: eventTime.toISOString(), requested_products: requestedProducts,
         observation_reason: "establish_event_baseline_and_revisit",
         discovery_phase: "signal_trigger", discovery_series: "signal", discovery_window: discoveryDate,
         aoi_center: { latitude, longitude }, aoi_bbox: aoiBbox,
         aoi_source: exactCoordinates.source === "canonical_event"
           ? "canonical_event_exact_geography" : "signal_exact_coordinates",
         correlation_methodology: "weighted-v1",
         post_aggregation_relevance: Number(currentEvent.relevance_score),
       })],
    );
    }
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
  return eventToApi(currentEvent);
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
