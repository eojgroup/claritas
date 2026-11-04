import { query } from "../db";
import { SharedReadCache } from "../shared-read-cache";
import { loadTranslationContext, translateEventPresentation, presentTranslatedSource, headlineTranslationFields, unavailableTranslationFields, type HeadlineTranslationPresentation } from "./translation-presentation";
import { sourceRecordBigintSql, canonicalSocialSignalBigintSql } from "./source-record";
import { activeSocialEvidenceSql } from "./event-priority";
import { intelligenceEventExpiresAtSql, intelligenceEventFreshness } from "./freshness";
import { OVERVIEW_TOPICS, OVERVIEW_SAMPLE_LIMIT, OVERVIEW_EVENT_LIMIT, OVERVIEW_TIMELINE_LIMIT,
  normalizeOverviewOptions, overviewWindow, buildOverviewAnalytics, overviewTopic, overviewPriority,
  overviewPriorityReasons, type OverviewOptions, type OverviewSample } from "./overview-model";
export { normalizeOverviewOptions, OVERVIEW_TOPICS } from "./overview-model";
export type { OverviewOptions, OverviewTopic } from "./overview-model";

const cache = new SharedReadCache({ ttlMs: 60_000, maxEntries: 40, maxBytes: 4 * 1024 * 1024 });
const topicSql = `CASE ${OVERVIEW_TOPICS.filter((topic) => topic.pattern).map((topic) =>
  `WHEN lower(feed.event_type) ~ '${topic.pattern}' THEN '${topic.key}'`).join(" ")} ELSE 'developments' END`;
const acceptedEvidenceSql = (itemAlias: string, sourceAlias: string) => `(${activeSocialEvidenceSql()} AND
  (evidence.source_record_type<>'item' OR CASE WHEN lower(COALESCE(${sourceAlias}.name,''))='gdelt'
    THEN ${itemAlias}.payload->>'quality_status'='accepted'
    ELSE COALESCE(${itemAlias}.payload->>'quality_status','accepted')='accepted' END))`;

export function buildOverviewSampleQuery(options: Required<OverviewOptions>, now: Date) {
  const window = overviewWindow(options.hours, now);
  const periodQuery = (period: "current" | "previous") => `(
    SELECT feed.id,feed.event_type,feed.status,feed.severity,feed.source_diversity,feed.domain_count,
      feed.relevance_score,feed.urgency_score,feed.materiality_score,feed.last_activity_time,
      feed.primary_location_id,feed.primary_country_iso2,feed.metadata,'${period}'::text AS period
    FROM intelligence_event_feed feed
    WHERE feed.status<>'dismissed'
      AND feed.last_activity_time>=${period === "current" ? "$1" : "$3"}::timestamptz
      AND feed.last_activity_time${period === "current" ? "<=$2" : "<$1"}::timestamptz
      AND ($4::text IS NULL OR feed.primary_country_iso2=$4)
      AND ($5::text IS NULL OR ${topicSql}=$5)
      AND NOT (COALESCE(feed.metadata->>'canonical_evidence_key','') LIKE 'news:global_event:%'
        AND feed.domain_count<=1 AND feed.source_diversity<=1 AND feed.relevance_score<0.65)
    ORDER BY feed.last_activity_time DESC,feed.id LIMIT $6
  )`;
  return { sql: `WITH sampled AS MATERIALIZED (${periodQuery("current")} UNION ALL ${periodQuery("previous")})
    SELECT sampled.*,location.canonical_name AS location_name,country.name AS country_name,
      ((COALESCE(sampled.metadata->>'canonical_evidence_key','') NOT LIKE 'social:social_signal:%'
        OR EXISTS(SELECT 1 FROM social_signal retained WHERE retained.id=${canonicalSocialSignalBigintSql("sampled")}
          AND retained.expires_at>now() LIMIT 1 OFFSET 0))
        AND EXISTS(SELECT 1 FROM intelligence_event_evidence evidence
          LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
          LEFT JOIN item article ON article.id=${sourceRecordBigintSql("evidence", "item")}
          WHERE evidence.event_id=sampled.id AND ${acceptedEvidenceSql("article", "evidence_source")}
          LIMIT 1 OFFSET 0)) AS displayable
    FROM sampled LEFT JOIN intelligence_location location ON location.id=sampled.primary_location_id
    LEFT JOIN country ON country.iso2=sampled.primary_country_iso2
    ORDER BY sampled.period,sampled.last_activity_time DESC,sampled.id`,
    params: [window.start, window.end, window.previous_start, options.country || null, options.topic || null, OVERVIEW_SAMPLE_LIMIT + 1] };
}

export type OverviewSourceRef = Partial<HeadlineTranslationPresentation> & { label: string; url: string; domain: string; item_id?: string | null };
export type OverviewImageryRef = { preview_url: string; captured_at: string; attribution: string };
type HydratedOverviewRow = Partial<HeadlineTranslationPresentation> & {
  id: string; event_type: string; title: string; summary: string; status: string; severity: string; confidence: number;
  start_time: string | Date; last_activity_time: string | Date; expires_at: string | Date;
  primary_location_id: string | null; primary_country_iso2: string | null;
  source_diversity: number; domain_count: number; relevance_score: number; urgency_score: number; materiality_score: number;
  location_name: string | null; location_type: string | null; latitude: number | null; longitude: number | null;
  monitoring_tier: number | null; evidence_count: number; signal_domains: string[];
  earth_observation_available: boolean; origin_domain: string;
  source_refs: OverviewSourceRef[]; imagery: OverviewImageryRef | null;
};

export function buildOverviewEventQuery(ids: string[]) {
  return { sql: `SELECT event.id,event.event_type,event.title,left(event.summary,500) AS summary,event.status,event.severity,event.confidence,
      event.start_time,event.last_activity_time,event.primary_location_id,event.primary_country_iso2,
      event.source_diversity,event.domain_count,event.relevance_score,event.urgency_score,event.materiality_score,
      ${intelligenceEventExpiresAtSql("event")} AS expires_at,
      COALESCE(NULLIF(feed.metadata->>'origin_domain',''),'news') AS origin_domain,
      location.canonical_name AS location_name,location.location_type,location.monitoring_tier,
      COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END,location.latitude) AS latitude,
      COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END,location.longitude) AS longitude,
      coverage.evidence_count,coverage.signal_domains,
      EXISTS(SELECT 1 FROM earth_observation available_observation
        JOIN earth_observation_asset available_asset ON available_asset.observation_id=available_observation.id
        WHERE available_observation.event_id=event.id AND available_observation.status='available'
          AND (available_asset.expires_at IS NULL OR available_asset.expires_at>now())) AS earth_observation_available,
      CASE WHEN imagery.preview_url IS NULL THEN NULL ELSE jsonb_build_object('preview_url',imagery.preview_url,
        'captured_at',imagery.captured_at,'attribution',imagery.attribution) END AS imagery,
      COALESCE(source_refs.records,'[]'::jsonb) AS source_refs
    FROM intelligence_event event JOIN intelligence_event_feed feed ON feed.id=event.id
    LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS evidence_count,
        COALESCE(array_agg(DISTINCT CASE
          WHEN evidence.relationship='model_interpretation' AND evidence.domain<>'podcast' THEN 'model_interpretation'
          WHEN evidence.domain='disaster' THEN 'earth_observation'
          WHEN evidence.domain='earth_observation' AND evidence.source_record_type IN ('earth_observation','earth_scene') THEN 'imagery'
          ELSE evidence.domain END) FILTER (WHERE evidence.relationship<>'assessment'),ARRAY[]::text[]) AS signal_domains
      FROM intelligence_event_evidence evidence
      LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
      LEFT JOIN item article ON article.id=${sourceRecordBigintSql("evidence", "item")}
      WHERE evidence.event_id=event.id AND ${acceptedEvidenceSql("article", "evidence_source")}
    ) coverage
    LEFT JOIN LATERAL (
      SELECT '/api/earth-observation/assets/'||asset.id::text||'?v='||left(asset.content_hash,16) AS preview_url,
        observation.captured_at,observation.attribution
      FROM earth_observation observation JOIN earth_observation_asset asset ON asset.observation_id=observation.id
      WHERE observation.event_id=event.id AND observation.status='available' AND observation.product_type='true_color'
        AND asset.asset_type='preview' AND (asset.expires_at IS NULL OR asset.expires_at>now())
      ORDER BY observation.captured_at DESC,observation.id LIMIT 1
    ) imagery ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('label',record.label,'url',record.url,'domain',record.domain,'item_id',record.item_id)
        ORDER BY record.observed_at DESC,record.id) AS records FROM (
        SELECT evidence.id,evidence.observed_at,evidence.domain,article.id::text AS item_id,
          COALESCE(NULLIF(article.title,''),NULLIF(evidence.attribution,''),NULLIF(evidence_source.name,''),'Source record') AS label,
          COALESCE(article.url,NULLIF(evidence.provenance->>'url','')) AS url
        FROM intelligence_event_evidence evidence
        LEFT JOIN source evidence_source ON evidence_source.id=evidence.source_id
        LEFT JOIN item article ON article.id=${sourceRecordBigintSql("evidence", "item")}
        WHERE evidence.event_id=event.id AND ${acceptedEvidenceSql("article", "evidence_source")}
          AND COALESCE(article.url,NULLIF(evidence.provenance->>'url','')) ~ '^https?://'
          AND evidence.relationship<>'model_interpretation'
        ORDER BY evidence.observed_at DESC,evidence.id LIMIT 2
      ) record
    ) source_refs ON true
    WHERE event.id=ANY($1::uuid[]) AND event.status<>'dismissed'`, params: [ids.slice(0, OVERVIEW_EVENT_LIMIT)] };
}

const iso = (value: Date | string) => new Date(value).toISOString();
const safeSourceRefs = (refs: OverviewSourceRef[]) => (Array.isArray(refs) ? refs : []).filter((ref) => {
  try { const url = new URL(ref.url); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}).map((ref) => ({ ...ref, label: ref.label.slice(0, 180) }));

export function assembleIntelligenceOverview(rawRows: OverviewSample[], eventRows: HydratedOverviewRow[], options: Required<OverviewOptions>, now: Date) {
  const { current, ...analytics } = buildOverviewAnalytics(rawRows, options, now);
  const byId = new Map(eventRows.map((row) => [row.id, row]));
  const events = current.slice(0, OVERVIEW_EVENT_LIMIT).flatMap((sample) => {
    const row = byId.get(sample.id);
    if (!row) return [];
    const { source_refs: _sourceRefs, imagery: _imagery, ...event } = row;
    return [{ ...event, confidence: Number(row.confidence), start_time: iso(row.start_time), last_activity_time: iso(row.last_activity_time),
      expires_at: iso(row.expires_at), freshness_state: intelligenceEventFreshness({ expiresAt: row.expires_at, status: row.status, now }),
      source_diversity: Number(row.source_diversity), domain_count: Number(row.domain_count), relevance_score: Number(row.relevance_score),
      urgency_score: Number(row.urgency_score), materiality_score: Number(row.materiality_score), evidence_count: Number(row.evidence_count),
      latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude),
      priority_score: overviewPriority(sample, now) / 100, priority_reasons: overviewPriorityReasons(sample) }];
  });
  const timeline = events.slice(0, OVERVIEW_TIMELINE_LIMIT).map((event) => {
    const row = byId.get(event.id)!;
    const topic = overviewTopic(event.event_type);
    return { ...headlineTranslationFields(event), event_id: event.id, occurred_at: event.last_activity_time, title: event.title, topic: topic.key, topic_label: topic.label,
      location_name: event.location_name, country_iso2: event.primary_country_iso2, severity: event.severity,
      priority_score: Math.round(event.priority_score * 100), priority_reasons: event.priority_reasons,
      source_refs: safeSourceRefs(row.source_refs), imagery: row.imagery ? { ...row.imagery, captured_at: iso(row.imagery.captured_at) } : null };
  });
  return { ...analytics, events, timeline };
}

/** Called after auth only; shared data cache never contains account state. */
export async function getIntelligenceOverview(input: OverviewOptions = {}) {
  const options = normalizeOverviewOptions(input);
  return cache.get(JSON.stringify(options), async () => {
    const now = new Date();
    const sampleStatement = buildOverviewSampleQuery(options, now);
    const { rows } = await query<OverviewSample>(sampleStatement.sql, sampleStatement.params);
    const analytics = buildOverviewAnalytics(rows, options, now);
    const ids = analytics.current.slice(0, OVERVIEW_EVENT_LIMIT).map((row) => row.id);
    const eventStatement = buildOverviewEventQuery(ids);
    const eventRows = ids.length ? (await query<HydratedOverviewRow>(eventStatement.sql, eventStatement.params)).rows : [];
    const translations = await loadTranslationContext(ids,
      eventRows.flatMap((row) => row.source_refs.map((ref) => ref.item_id).filter((id): id is string => Boolean(id))), options.displayLanguage);
    const presented = eventRows.map((row) => ({ ...translateEventPresentation(row, translations),
      source_refs: row.source_refs.map((ref) => {
        const source = ref.item_id ? translations.items.get(ref.item_id) : null;
        if (!source) return translations.unavailable ? { ...ref, ...unavailableTranslationFields(ref.label, null, translations) } : ref;
        const display = presentTranslatedSource(source, translations.targetLanguage, translations.availability);
        const fields = headlineTranslationFields(display);
        delete fields.original_summary;
        return { ...ref, ...fields, label: display.title ?? ref.label };
      }),
    }));
    return assembleIntelligenceOverview(rows, presented, options, now);
  });
}
