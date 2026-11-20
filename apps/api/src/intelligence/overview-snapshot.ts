import { randomUUID } from "node:crypto";
import { countryAttentionScore, type CountryAttentionInput } from "./country-attention";
import { refreshPreparedIntelligenceFeed } from "./feed-snapshot";
import { query, withTransaction, withWorkerLease } from "../db";
import { SharedReadCache } from "../shared-read-cache";
import { assembleIntelligenceOverview, buildOverviewProjectionQuery, buildOverviewEventQuery,
  type HydratedOverviewRow, type IntelligenceOverview, type OverviewSnapshot } from "./overview";
import { buildOverviewAnalytics, normalizeOverviewOptions, overviewTopic, overviewWindow, OVERVIEW_EVENT_LIMIT, OVERVIEW_TOPICS,
  type OverviewOptions, type OverviewSample } from "./overview-model";
import { loadTranslationContext, translateEventPresentation, presentTranslatedSource, headlineTranslationFields,
  unavailableTranslationFields } from "./translation-presentation";

export type OverviewQuery = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
type State = { generation_id: string; generated_at: string | Date; pending_events?: number };
type Refresh = { generation_id: string; started_at: string | Date; cursor_time: string | Date | null; cursor_id: string | null; scanned_events: number };
type ProjectionRow = OverviewSample & HydratedOverviewRow;
type SavedCard = { sample: OverviewSample; event: HydratedOverviewRow };
type Aggregate = { summary: { event_count: number; previous_event_count: number; high_priority_count: number; location_count: number };
  topics: Array<Record<string, any>>; locations: Array<Record<string, any>>;
  countries: Array<CountryAttentionInput & { country_iso2: string }>;
  buckets: Array<{ index: number; event_count: number; previous_event_count: number; high_priority_count: number }> };
const cache = new SharedReadCache({ ttlMs: 30_000, maxEntries: 40, maxBytes: 8 * 1024 * 1024 });
const BATCH_SIZE = 500;
const REFRESH_INTERVAL_MS = 120_000;
const WINDOWS = [24, 72, 168] as const;
const PRIORITIES = ["high", "all"] as const;
const socialIdText = "split_part(sample->'metadata'->>'canonical_evidence_key',':',3)";
const prioritySql = `round((LEAST(priority_cap,priority_base+0.1*GREATEST(0,1-GREATEST(0,extract(epoch FROM ($2::timestamptz-last_activity_time)))/259200))*100)::numeric)::int`;
const highSql = `(severity IN ('high','critical') OR COALESCE((sample->>'news_priority')::numeric,0)>=0.6 OR ${prioritySql}>=70)`;
const scopeSql = `generation_id=$1::uuid AND last_activity_time>=$3::timestamptz AND last_activity_time<=$2::timestamptz
  AND ($4::text IS NULL OR country_iso2=$4) AND ($5::text IS NULL OR topic=$5) AND ($6::text='all' OR ${highSql})`;
const scopeParams = (state: State, options: Required<OverviewOptions>) => {
  const window = overviewWindow(options.hours, new Date(state.generated_at));
  return [state.generation_id, window.end, window.previous_start, options.country || null, options.topic || null, options.priority, window.start,
    window.bucket_hours * 3600, options.hours * 3600];
};

/** The persisted projection is the only input to scoped reader analytics. */
export function buildSavedOverviewAggregateQuery(state: State, options: Required<OverviewOptions>) {
  return { sql: `WITH eligible AS MATERIALIZED (
      SELECT id,last_activity_time,country_iso2,topic,location_key,location_name,
        last_activity_time>=$7::timestamptz AS current_period,${prioritySql} AS priority_score,${highSql} AS high_priority
      FROM intelligence_overview_projection WHERE ${scopeSql}
    ), topic_counts AS (
      SELECT topic AS key,count(*) FILTER (WHERE current_period)::int AS event_count,
        count(*) FILTER (WHERE NOT current_period)::int AS previous_event_count,
        COALESCE(max(priority_score) FILTER (WHERE current_period),0)::int AS priority_score,
        (array_agg(id ORDER BY priority_score DESC,id) FILTER (WHERE current_period))[1:3] AS event_ids
      FROM eligible GROUP BY topic
    ), location_counts AS (
      SELECT location_key AS key,max(location_name) AS name,max(country_iso2) AS country_iso2,
        count(*) FILTER (WHERE current_period)::int AS event_count,count(*) FILTER (WHERE NOT current_period)::int AS previous_event_count,
        COALESCE(max(priority_score) FILTER (WHERE current_period),0)::int AS priority_score,
        (array_agg(id ORDER BY priority_score DESC,id) FILTER (WHERE current_period))[1:3] AS event_ids
      FROM eligible WHERE location_key IS NOT NULL GROUP BY location_key
      ORDER BY event_count DESC,priority_score DESC,location_key LIMIT 8
    ), country_counts AS (
      SELECT country_iso2,count(*) FILTER(WHERE current_period)::int AS event_count,
        count(*) FILTER(WHERE current_period AND high_priority)::int AS high_priority_count,
        count(*) FILTER(WHERE NOT current_period)::int AS previous_event_count,
        COALESCE(max(priority_score) FILTER(WHERE current_period),0)::int AS peak_priority_score
      FROM eligible WHERE country_iso2 IS NOT NULL GROUP BY country_iso2
      HAVING count(*) FILTER(WHERE current_period)>0
    ), bucket_counts AS (
      SELECT LEAST(($9::numeric/$8::numeric)::int-1,floor((extract(epoch FROM (last_activity_time-$7::timestamptz))
        +CASE WHEN current_period THEN 0 ELSE $9::numeric END)/$8::numeric)::int) AS index,
        count(*) FILTER (WHERE current_period)::int AS event_count,count(*) FILTER (WHERE NOT current_period)::int AS previous_event_count,
        count(*) FILTER (WHERE current_period AND high_priority)::int AS high_priority_count
      FROM eligible GROUP BY 1
    ) SELECT jsonb_build_object('summary',jsonb_build_object(
      'event_count',count(*) FILTER (WHERE current_period)::int,'previous_event_count',count(*) FILTER (WHERE NOT current_period)::int,
      'high_priority_count',count(*) FILTER (WHERE current_period AND high_priority)::int,
      'location_count',count(DISTINCT location_key) FILTER (WHERE current_period)::int),
      'topics',COALESCE((SELECT jsonb_agg(to_jsonb(topic_counts) ORDER BY event_count DESC,priority_score DESC,key) FROM topic_counts),'[]'::jsonb),
      'locations',COALESCE((SELECT jsonb_agg(to_jsonb(location_counts) ORDER BY event_count DESC,priority_score DESC,key) FROM location_counts),'[]'::jsonb),
      'countries',COALESCE((SELECT jsonb_agg(to_jsonb(country_counts) ORDER BY event_count DESC,country_iso2) FROM country_counts),'[]'::jsonb),
      'buckets',COALESCE((SELECT jsonb_agg(to_jsonb(bucket_counts)) FROM bucket_counts),'[]'::jsonb)) AS aggregate
      FROM eligible`, params: scopeParams(state, options) };
}

export async function buildSavedIntelligenceOverview(state: State, options: Required<OverviewOptions>, read: OverviewQuery = query): Promise<IntelligenceOverview> {
  const statement = buildSavedOverviewAggregateQuery(state, options);
  const aggregate = (await read<{ aggregate: Aggregate }>(statement.sql, statement.params)).rows[0].aggregate;
  const params = scopeParams(state, options);
  const window = overviewWindow(options.hours, new Date(state.generated_at));
  const interval = options.bucket >= 0 ? {
    bucket: options.bucket,
    start: new Date(Date.parse(window.start) + options.bucket * window.bucket_hours * 3600_000).toISOString(),
    end: new Date(Date.parse(window.start) + (options.bucket + 1) * window.bucket_hours * 3600_000).toISOString(),
    event_count: aggregate.buckets.find((row) => row.index === options.bucket)?.event_count ?? 0,
    high_priority_count: aggregate.buckets.find((row) => row.index === options.bucket)?.high_priority_count ?? 0,
  } : null;
  const detailParams = [...params.slice(0, 7), interval?.start ?? null, interval?.end ?? null, interval?.end === window.end];
  const detailScope = `${scopeSql} AND last_activity_time>=$7::timestamptz
    AND ($8::timestamptz IS NULL OR (last_activity_time>=$8::timestamptz
      AND (last_activity_time<$9::timestamptz OR ($10::boolean AND last_activity_time=$9::timestamptz))))`;
  // Bound JSON/title processing independently for each topic. Full-period
  // counts and map coverage above/below still use every eligible saved event.
  const { rows: cards } = await read<SavedCard>(`WITH ranked AS (
      SELECT id,last_activity_time,topic,${prioritySql} AS attention,
        row_number() OVER (PARTITION BY topic ORDER BY ${prioritySql} DESC,last_activity_time DESC,id) AS topic_rank
      FROM intelligence_overview_projection WHERE ${detailScope}
    ), pool AS MATERIALIZED (
      SELECT id,last_activity_time,topic,attention FROM ranked WHERE topic_rank<=400
    ), candidates AS (
      SELECT pool.*,COALESCE(projection.sample->'metadata'->>'origin_domain','news') AS origin_domain,
        row_number() OVER (PARTITION BY CASE WHEN pool.topic='transport' THEN concat('transport:',event->>'title',':',COALESCE(location_key,''))
          ELSE COALESCE(NULLIF(lower(regexp_replace(event->>'title','[^[:alnum:]]','','g')),''),pool.id::text) END
          ORDER BY pool.last_activity_time DESC,pool.id) AS duplicate_rank
      FROM pool CROSS JOIN LATERAL (
        SELECT sample,event,location_key FROM intelligence_overview_projection
        WHERE generation_id=$1::uuid AND id=pool.id LIMIT 1
      ) projection
    ), diverse AS (
      SELECT id,last_activity_time,attention,row_number() OVER (PARTITION BY origin_domain,topic
        ORDER BY attention DESC,last_activity_time DESC,id) AS family_rank
      FROM candidates WHERE duplicate_rank=1
    ), selected AS MATERIALIZED (
      SELECT id,last_activity_time,attention,(family_rank>2) AS deferred
      FROM diverse ORDER BY (family_rank>2),attention DESC,last_activity_time DESC,id LIMIT ${OVERVIEW_EVENT_LIMIT}
    ) SELECT projection.sample,projection.event FROM selected
      JOIN intelligence_overview_projection projection ON projection.generation_id=$1::uuid AND projection.id=selected.id
      ORDER BY selected.deferred,selected.attention DESC,selected.last_activity_time DESC,selected.id`, detailParams);
  // Geography must come from the full selected window, not the latest cards:
  // a burst of unlocated reporting must not erase every known map position.
  const { rows: mapped } = await read<{ event: HydratedOverviewRow }>(`SELECT event FROM intelligence_overview_projection
    WHERE ${detailScope}
      AND event->>'latitude' IS NOT NULL AND event->>'longitude' IS NOT NULL
      AND COALESCE(event->>'location_type','')<>'country'
    ORDER BY last_activity_time DESC,id LIMIT 200`, detailParams);
  const { rows: visual } = await read<{ event: HydratedOverviewRow }>(`SELECT event FROM intelligence_overview_projection
    WHERE ${detailScope} AND event->'imagery'<>'null'::jsonb
    ORDER BY last_activity_time DESC,id LIMIT 8`, detailParams);
  const inInterval = `(last_activity_time >= $7::timestamptz AND (last_activity_time < $8::timestamptz OR ($9::boolean AND last_activity_time=$8::timestamptz)))`;
  const previousInterval = inInterval.replaceAll("last_activity_time", "(last_activity_time+($10::double precision*interval '1 second'))");
  const selectedCountries = interval ? (await read<CountryAttentionInput & { country_iso2: string }>(`
    SELECT country_iso2,count(*) FILTER(WHERE ${inInterval})::int AS event_count,
      count(*) FILTER(WHERE ${inInterval} AND ${highSql})::int AS high_priority_count,
      count(*) FILTER(WHERE ${previousInterval})::int AS previous_event_count,
      COALESCE(max(${prioritySql}) FILTER(WHERE ${inInterval}),0)::int AS peak_priority_score
    FROM intelligence_overview_projection WHERE ${scopeSql} AND country_iso2 IS NOT NULL
      AND (${inInterval} OR ${previousInterval}) GROUP BY country_iso2
    HAVING count(*) FILTER(WHERE ${inInterval})>0`, [...params.slice(0, 6), interval.start, interval.end, interval.end === window.end, options.hours * 3600])).rows : aggregate.countries;
  const now = new Date(state.generated_at);
  const samples = cards.map(({ sample }) => ({ ...sample, period: "current" as const }));
  const base = assembleIntelligenceOverview(samples, cards.map(({ event }) => event), options, now, cards.map(({ event }) => event.id));
  const change = (current: number, previous: number) => ({ change: current - previous, change_percent: previous ? Math.round((current - previous) / previous * 100) : null,
    direction: (!current && !previous ? "quiet" : !previous ? "new" : current > previous ? "rising" : current < previous ? "falling" : "steady") as "quiet" | "new" | "rising" | "falling" | "steady" });
  const decorate = (row: Record<string, any>) => ({ ...row, event_ids: row.event_ids ?? [], ...change(row.event_count, row.previous_event_count) });
  const topics = aggregate.topics.map((row) => ({ ...decorate(row), label: overviewTopicLabel(row.key) })) as IntelligenceOverview["topics"];
  const locations = aggregate.locations.map(decorate) as IntelligenceOverview["locations"];
  const buckets = base.buckets.map((bucket, index) => {
    const counts = aggregate.buckets.find((row) => row.index === index);
    return { ...bucket, event_count: counts?.event_count ?? 0, previous_event_count: counts?.previous_event_count ?? 0, high_priority_count: counts?.high_priority_count ?? 0 };
  });
  return { ...base, summary: { ...aggregate.summary, ...change(aggregate.summary.event_count, aggregate.summary.previous_event_count) }, topics, locations,
    selection: interval, countries: selectedCountries.map((country) => ({ ...country, previous_event_count: country.previous_event_count ?? 0,
      peak_priority_score: country.peak_priority_score ?? 0, attention_score: countryAttentionScore(country) })), map_events: mapped.map(({ event: { source_refs: _refs, ...event } }) => event),
    visual_events: visual.map(({ event: { source_refs: _refs, ...event } }) => event), buckets,
    coverage: { ...base.coverage, notice: "Key developments balance importance, recency and source/topic variety. Repeated updates are grouped in the list; chart totals cover every eligible saved investigation.", sample_limit: Math.max(aggregate.summary.event_count, aggregate.summary.previous_event_count),
      sampled_events: aggregate.summary.event_count + aggregate.summary.previous_event_count } };
}
const overviewTopicLabel = (key: string) => OVERVIEW_TOPICS.find((topic) => topic.key === key)?.label ?? key;

async function translateRows(rows: HydratedOverviewRow[], language: string) {
  const translations = await loadTranslationContext(rows.map((row) => row.id),
    rows.flatMap((row) => row.source_refs.map((ref) => ref.item_id).filter((id): id is string => Boolean(id))), language);
  return rows.map((row) => ({ ...translateEventPresentation({ ...row, title: row.original_title ?? row.title, summary: row.original_summary ?? row.summary }, translations),
    source_refs: row.source_refs.map((ref) => {
      const source = ref.item_id ? translations.items.get(ref.item_id) : null;
      if (!source) return translations.unavailable ? { ...ref, ...unavailableTranslationFields(ref.label, null, translations) } : ref;
      const display = presentTranslatedSource(source, translations.targetLanguage, translations.availability);
      const fields = headlineTranslationFields(display);
      delete fields.original_summary;
      return { ...ref, ...fields, label: display.title ?? ref.label };
    }) }));
}

async function readUncached(options: Required<OverviewOptions>, read: OverviewQuery): Promise<IntelligenceOverview & { snapshot: OverviewSnapshot }> {
  const { rows } = await read<State & { payload: IntelligenceOverview | null }>(`SELECT state.generation_id,state.generated_at,state.pending_events,snapshot.payload
    FROM intelligence_overview_state state LEFT JOIN intelligence_overview_snapshot snapshot
      ON snapshot.generation_id=state.generation_id AND snapshot.hours=$1 AND snapshot.priority=$2
    WHERE state.singleton=true`, [options.hours, options.priority]);
  const state = rows[0];
  if (!state) {
    const { current: _current, ...empty } = buildOverviewAnalytics([], options, new Date());
    return { ...empty, events: [], timeline: [], map_events: [], visual_events: [], snapshot: { status: "warming", generated_at: null, age_seconds: null } };
  }
  const savedGlobal = !options.country && !options.topic && options.bucket < 0 && state.payload;
  const overview = savedGlobal || await buildSavedIntelligenceOverview(state, options, read);
  // Global English presentation is prepared by the worker. Scoped views and
  // other languages need only a bounded lookup of existing translation rows.
  if ((!savedGlobal || options.displayLanguage !== "en") && overview.events.length) {
    const hydrated = overview.events.map((event) => ({ ...event, source_refs: overview.timeline.find((entry) => entry.event_id === event.id)?.source_refs ?? [],
      imagery: overview.timeline.find((entry) => entry.event_id === event.id)?.imagery ?? null })) as HydratedOverviewRow[];
    const presented = await translateRows(hydrated, options.displayLanguage);
    const byId = new Map(presented.map((row) => [row.id, row]));
    overview.events = overview.events.map((event) => {
      const { source_refs: _source, imagery: _imagery, ...translated } = byId.get(event.id)!;
      return { ...event, ...translated } as typeof event;
    });
    overview.timeline = overview.timeline.map((entry) => {
      const row = byId.get(entry.event_id)!;
      return { ...entry, ...headlineTranslationFields(row), title: row.title, source_refs: row.source_refs };
    });
  }
  return { ...overview, snapshot: snapshotFreshness(state.generated_at, new Date(), state.pending_events ?? 0) };
}
export function snapshotFreshness(generatedAt: Date | string, now = new Date(), pendingEvents = 0): OverviewSnapshot {
  const age = Math.max(0, Math.floor((now.getTime() - new Date(generatedAt).getTime()) / 1000));
  return { status: age > 300 || pendingEvents > 0 ? "stale" : "fresh", generated_at: new Date(generatedAt).toISOString(), age_seconds: age, pending_events: pendingEvents };
}
/** Auth remains at the route; only public intelligence data enters this cache. */
export async function readIntelligenceOverviewSnapshot(options: Required<OverviewOptions>, read?: OverviewQuery) {
  if (read) return readUncached(options, read);
  const result = await cache.get(JSON.stringify(options), () => readUncached(options, query));
  return result.snapshot.generated_at ? { ...result, snapshot: snapshotFreshness(result.snapshot.generated_at, new Date(), result.snapshot.pending_events ?? 0) } : result;
}

const projectionRecords = (rows: ProjectionRow[], generation: string) => rows.filter((row) => row.displayable).map((row) => {
  const sample: OverviewSample = { id: row.id, event_type: row.event_type, status: row.status, severity: row.severity,
    news_category: row.news_category, news_priority: Number(row.news_priority ?? 0), relevance_score: Number(row.relevance_score), urgency_score: Number(row.urgency_score), materiality_score: Number(row.materiality_score),
    source_diversity: row.source_diversity, domain_count: row.domain_count, last_activity_time: row.last_activity_time,
    primary_location_id: row.primary_location_id, primary_country_iso2: row.primary_country_iso2, location_name: row.location_name,
    country_name: row.country_name, metadata: row.metadata, period: "current", displayable: true };
  const origin = row.metadata?.origin_domain || "news";
  const event: HydratedOverviewRow = { ...row, origin_domain: origin, source_refs: row.source_refs ?? [], imagery: null, earth_observation_available: false };
  // Do not duplicate feed metadata and cursor internals inside every card.
  const { metadata: _metadata, period: _period, displayable: _displayable, country_name: _country, ...card } = event as HydratedOverviewRow & OverviewSample;
  return { generation_id: generation, id: row.id, last_activity_time: row.last_activity_time, country_iso2: row.primary_country_iso2,
    topic: overviewTopic(row.event_type, row.news_category).key, location_key: row.primary_location_id ? `location:${row.primary_location_id}` : row.primary_country_iso2 ? `country:${row.primary_country_iso2}` : null,
    location_name: row.location_name || row.country_name || row.primary_country_iso2, severity: row.severity,
    priority_base: .55 * Math.max(Number(row.relevance_score), Number(row.news_priority ?? 0)) + .2 * Number(row.urgency_score) + .15 * Number(row.materiality_score),
    priority_cap: ["social", "podcast"].includes(origin) && !Number(row.source_diversity) ? .6 : 1,
    sample, event: card };
});

export async function saveOverviewProjectionBatch(rows: ProjectionRow[], generation: string, write: OverviewQuery = query) {
  const records = projectionRecords(rows, generation);
  if (!records.length) return;
  await write(`INSERT INTO intelligence_overview_projection(generation_id,id,last_activity_time,country_iso2,topic,location_key,location_name,severity,priority_base,priority_cap,sample,event)
    SELECT generation_id,id,last_activity_time,country_iso2,topic,location_key,location_name,severity,priority_base,priority_cap,sample,event
    FROM jsonb_to_recordset($1::jsonb) AS row(generation_id uuid,id uuid,last_activity_time timestamptz,country_iso2 text,topic text,location_key text,location_name text,
      severity text,priority_base double precision,priority_cap double precision,sample jsonb,event jsonb)
    ON CONFLICT(generation_id,id) DO UPDATE SET last_activity_time=EXCLUDED.last_activity_time,country_iso2=EXCLUDED.country_iso2,topic=EXCLUDED.topic,
      location_key=EXCLUDED.location_key,location_name=EXCLUDED.location_name,severity=EXCLUDED.severity,priority_base=EXCLUDED.priority_base,
      priority_cap=EXCLUDED.priority_cap,sample=EXCLUDED.sample,event=EXCLUDED.event`, [JSON.stringify(records)]);
}

export async function publishOverviewSnapshots(state: State, read: OverviewQuery = query, enrich = true) {
  if (enrich) await refreshRetainedOverviewImages(state.generation_id, read);
  // The three windows usually share their latest cards. Hydrate and present
  // each selected investigation once across the six coordinated snapshots.
  const enrichedById = new Map<string, HydratedOverviewRow>();
  const attemptedIds = new Set<string>();
  for (const hours of WINDOWS) for (const priority of PRIORITIES) {
    const options = normalizeOverviewOptions({ hours, priority });
    let overview = await buildSavedIntelligenceOverview(state, options, read);
    if (enrich && overview.events.length) {
      const missing = overview.events.map((event) => event.id).filter((id) => !attemptedIds.has(id));
      if (missing.length) {
        const statement = buildOverviewEventQuery(missing);
        const enriched = await translateRows((await read<HydratedOverviewRow>(statement.sql, statement.params)).rows, "en");
        for (const id of missing) attemptedIds.add(id);
        for (const row of enriched) enrichedById.set(row.id, row);
      }
      const enriched = overview.events.flatMap((event) => enrichedById.get(event.id) ?? []);
      const samples = (await read<{ sample: OverviewSample }>(`SELECT sample FROM intelligence_overview_projection WHERE generation_id=$1 AND id=ANY($2::uuid[])`,
        [state.generation_id, overview.events.map((event) => event.id)])).rows.map(({ sample }) => ({ ...sample, period: "current" as const }));
      const presentation = assembleIntelligenceOverview(samples, enriched, options, new Date(state.generated_at), overview.events.map((event) => event.id));
      overview = { ...overview, events: presentation.events, timeline: presentation.timeline };
    }
    await read(`INSERT INTO intelligence_overview_snapshot(hours,priority,generation_id,generated_at,payload) VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(hours,priority) DO UPDATE SET generation_id=EXCLUDED.generation_id,generated_at=EXCLUDED.generated_at,payload=EXCLUDED.payload`,
      [hours, priority, state.generation_id, state.generated_at, JSON.stringify(overview)]);
  }
  // New arrivals belong to the next generation. Only unfinished work that
  // predates this generation's cutoff makes its saved result stale.
  const pending = (await read<{ count: number }>("SELECT count(*)::int AS count FROM intelligence_overview_dirty WHERE queued_at<=$1::timestamptz", [state.generated_at])).rows[0].count;
  await read(`INSERT INTO intelligence_overview_state(singleton,generation_id,generated_at,pending_events) VALUES(true,$1,$2,$3)
    ON CONFLICT(singleton) DO UPDATE SET generation_id=EXCLUDED.generation_id,generated_at=EXCLUDED.generated_at,pending_events=EXCLUDED.pending_events`, [state.generation_id, state.generated_at, pending]);
  return pending;
}

/** Retained assets are small and indexed. Join their linked events once in the
 * worker so country/topic readers keep imagery without rehydrating history. */
export async function refreshRetainedOverviewImages(generation: string, read: OverviewQuery = query) {
  await read(`WITH retained AS MATERIALIZED (
    SELECT observation.event_id,0 AS preference,observation.captured_at AS sort_time,
      jsonb_build_object('preview_url','/api/earth-observation/assets/'||asset.id::text||'?v='||left(asset.content_hash,16),
        'captured_at',observation.captured_at,'attribution',observation.attribution,'source_kind','satellite') AS imagery
    FROM earth_observation observation JOIN earth_observation_asset asset ON asset.observation_id=observation.id
    JOIN intelligence_overview_projection target ON target.id=observation.event_id AND target.generation_id=$1
    WHERE observation.event_id IS NOT NULL AND observation.status='available' AND observation.product_type='true_color'
      AND observation.captured_at BETWEEN target.last_activity_time-interval '72 hours' AND target.last_activity_time+interval '24 hours'
      AND asset.asset_type='preview' AND (asset.expires_at IS NULL OR asset.expires_at>now())
    UNION ALL
    SELECT evidence.event_id,1,image.collected_at,
      jsonb_build_object('preview_url','/api/news-images/'||image.id::text||'/preview','captured_at',NULL,
        'attribution',image.publisher,'source_kind','publisher')
    FROM news_article_image image JOIN news_image_asset asset USING(content_hash)
    JOIN item article ON article.id=image.item_id JOIN source ON source.id=article.source_id
    JOIN intelligence_event_evidence evidence ON evidence.domain='news' AND evidence.source_record_type='item'
      AND evidence.source_record_id=image.item_id::text
    JOIN intelligence_overview_projection target ON target.id=evidence.event_id AND target.generation_id=$1
    WHERE asset.expires_at>now() AND (lower(source.name)<>'gdelt' OR article.payload->>'quality_status'='accepted')
      AND article.event_time BETWEEN target.last_activity_time-interval '72 hours' AND target.last_activity_time+interval '24 hours'
  ), chosen AS MATERIALIZED (
    SELECT DISTINCT ON(event_id) event_id,imagery,preference FROM retained ORDER BY event_id,preference,sort_time DESC
  ) UPDATE intelligence_overview_projection projection
    SET event=jsonb_set(projection.event,'{imagery}',COALESCE(chosen.imagery,'null'::jsonb))
      ||jsonb_build_object('earth_observation_available',COALESCE(chosen.preference=0,false))
    FROM (SELECT projection.id,chosen.imagery,chosen.preference FROM intelligence_overview_projection projection
      LEFT JOIN chosen ON chosen.event_id=projection.id WHERE projection.generation_id=$1) chosen
    WHERE projection.generation_id=$1 AND projection.id=chosen.id
      AND (projection.event->'imagery' IS DISTINCT FROM COALESCE(chosen.imagery,'null'::jsonb))`, [generation]);
}

let running = false;
let nextCheckAt = 0;
/** Bounded work, durable cursors and a lease allow safe restarts and replicas. */
export async function runIntelligenceOverviewWorkerCycle() {
  if (running || Date.now() < nextCheckAt) return;
  running = true;
  try {
    await withWorkerLease("intelligence-overview", 180, async () => {
      await refreshPreparedIntelligenceFeed().catch((error) => {
        console.warn(JSON.stringify({ event: "intelligence_feed_prepare_failed", message: error instanceof Error ? error.message : String(error) }));
      });
      const state = (await query<State>("SELECT generation_id,generated_at,pending_events FROM intelligence_overview_state WHERE singleton=true")).rows[0];
      // The short poll keeps initial backfill moving. Two-minute snapshots
      // rotate the reporting window while bounding shared database CPU work.
      if (state && !state.pending_events && Date.now() - new Date(state.generated_at).getTime() < REFRESH_INTERVAL_MS) {
        nextCheckAt = new Date(state.generated_at).getTime() + REFRESH_INTERVAL_MS;
        return;
      }
      if (!state) {
        await query(`INSERT INTO intelligence_overview_refresh(singleton,generation_id,started_at) VALUES(true,$1,now()) ON CONFLICT(singleton) DO NOTHING`, [randomUUID()]);
        for (let batch = 0; batch < 4; batch++) {
          const refresh = (await query<Refresh>("SELECT * FROM intelligence_overview_refresh WHERE singleton=true")).rows[0];
          const cursor = refresh.cursor_time && refresh.cursor_id ? { time: new Date(refresh.cursor_time).toISOString(), id: refresh.cursor_id } : undefined;
          const statement = buildOverviewProjectionQuery(new Date(refresh.started_at), cursor, BATCH_SIZE);
          let rows: ProjectionRow[] = [];
          await withTransaction(async (client) => {
            await client.query("SET LOCAL jit=off");
            const run: OverviewQuery = async (sql, params) => ({ rows: (await client.query(sql, params)).rows });
            rows = (await run<ProjectionRow>(statement.sql, statement.params)).rows;
            await saveOverviewProjectionBatch(rows, refresh.generation_id, run);
            if (rows.length) {
              const last = rows.at(-1)!;
              await run(`UPDATE intelligence_overview_refresh SET cursor_time=$1,cursor_id=$2,scanned_events=scanned_events+$3,updated_at=now() WHERE singleton=true`,
                [last.last_activity_time, last.id, rows.length]);
            }
            if (rows.length < BATCH_SIZE) {
              // Dirty records include events that moved across the keyset cursor
              // during backfill. Replay them before publishing complete history.
              const cutoff = new Date();
              await applyOverviewDirtyBatch(refresh.generation_id, run, BATCH_SIZE, cutoff);
              const pending = (await run<{ pending: boolean }>("SELECT EXISTS(SELECT 1 FROM intelligence_overview_dirty WHERE queued_at<=$1::timestamptz) AS pending", [cutoff])).rows[0].pending;
              if (!pending) {
                await publishOverviewSnapshots({ generation_id: refresh.generation_id, generated_at: cutoff }, run);
                await run("DELETE FROM intelligence_overview_refresh WHERE singleton=true");
                nextCheckAt = Date.now() + REFRESH_INTERVAL_MS;
                console.info(JSON.stringify({ event: "intelligence_overview_backfill_complete", scanned_events: refresh.scanned_events + rows.length }));
              }
            }
          });
          if (batch === 3 || rows.length < BATCH_SIZE) console.info(JSON.stringify({ event: "intelligence_overview_backfill_progress",
            scanned_events: refresh.scanned_events + rows.length, cursor_time: rows.at(-1)?.last_activity_time ?? refresh.cursor_time }));
          if (rows.length < BATCH_SIZE) break;
        }
      } else {
        let pending = 0;
        const cutoff = new Date();
        await withTransaction(async (client) => {
          await client.query("SET LOCAL jit=off");
          const run: OverviewQuery = async (sql, params) => ({ rows: (await client.query(sql, params)).rows });
          for (let batch = 0; batch < 4; batch++) {
            if (await applyOverviewDirtyBatch(state.generation_id, run, BATCH_SIZE, cutoff) < BATCH_SIZE) break;
          }
          await run(`DELETE FROM intelligence_overview_projection WHERE generation_id=$1 AND last_activity_time<now()-interval '336 hours'`, [state.generation_id]);
          await purgeExpiredOverviewSocialLeads(state.generation_id, run);
          pending = await publishOverviewSnapshots({ generation_id: state.generation_id, generated_at: cutoff }, run);
        });
        nextCheckAt = Date.now() + (pending ? 1000 : REFRESH_INTERVAL_MS);
      }
    });
  } catch (error) {
    nextCheckAt = Date.now() + 15_000;
    console.warn(JSON.stringify({ event: "intelligence_overview_refresh_failed", message: error instanceof Error ? error.message : String(error) }));
  } finally { running = false; }
}

/** Retention is time dependent even when the canonical event is unchanged. */
export async function purgeExpiredOverviewSocialLeads(generation: string, read: OverviewQuery = query) {
  await read(`DELETE FROM intelligence_overview_projection WHERE generation_id=$1
    AND sample->'metadata'->>'canonical_evidence_key' LIKE 'social:social_signal:%'
    AND NOT EXISTS(SELECT 1 FROM social_signal retained
      WHERE retained.id=CASE WHEN ${socialIdText} ~ '^[0-9]{1,19}$'
        AND (length(${socialIdText})<19 OR ${socialIdText} COLLATE "C" <= '9223372036854775807' COLLATE "C")
        THEN ${socialIdText}::bigint ELSE NULL END AND retained.expires_at>now())`, [generation]);
}

export async function applyOverviewDirtyBatch(generation: string, read: OverviewQuery = query, limit = BATCH_SIZE, cutoff = new Date()) {
  // pg decodes timestamptz as JS Date, losing sub-millisecond precision. Keep
  // the exact database value so acknowledgement removes the claimed version
  // while preserving a row requeued during projection work.
  const dirty = (await read<{ id: string; queued_at: string }>(`SELECT dirty.id,dirty.queued_at::text AS queued_at FROM intelligence_overview_dirty dirty
    WHERE dirty.queued_at<=$2::timestamptz ORDER BY dirty.queued_at,dirty.id LIMIT $1`, [limit, cutoff])).rows;
  if (!dirty.length) return 0;
  const ids = dirty.map((row) => row.id);
  const base = buildOverviewProjectionQuery(cutoff, undefined, Math.min(1000, limit));
  // Keyset backfill and dirty replay share exactly the same visibility rules.
  const sql = base.sql.replace("WHERE feed.last_activity_time >=", "WHERE feed.id=ANY($6::uuid[]) AND feed.last_activity_time >=");
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + BATCH_SIZE);
    const rows = (await read<ProjectionRow>(sql, [...base.params, chunk])).rows;
    await read("DELETE FROM intelligence_overview_projection WHERE generation_id=$1 AND id=ANY($2::uuid[])", [generation, chunk]);
    await saveOverviewProjectionBatch(rows, generation, read);
  }
  await read(`DELETE FROM intelligence_overview_dirty dirty USING jsonb_to_recordset($1::jsonb) AS claimed(id uuid,queued_at timestamptz)
    WHERE dirty.id=claimed.id AND dirty.queued_at=claimed.queued_at`, [JSON.stringify(dirty)]);
  return dirty.length;
}

let timer: NodeJS.Timeout | null = null;
export function startIntelligenceOverviewWorker() {
  if (timer) return;
  timer = setInterval(() => { void runIntelligenceOverviewWorkerCycle(); }, 1000);
  timer.unref();
  const startup = setTimeout(() => { void runIntelligenceOverviewWorkerCycle(); }, 1500);
  startup.unref();
}
