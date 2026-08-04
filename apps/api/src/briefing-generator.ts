import { query } from "./db";
import { createLlmClientFromEnv, getLlmRuntimeConfig, type LlmClient } from "./llm";
import { getCountryLeadershipLatest } from "./connectors/wikidata-leadership";
import { getTransportOverviewForBriefing } from "./connectors/transport";
import { getCountryMarketOverview } from "./connectors/market-overview";
import { getCountryWeatherLatest } from "./connectors/weather";

export type GeneratedBriefingStatus = "draft" | "published";

export type GeneratedDailySignalBriefingPayload = {
  title: string;
  update_text: string;
  key_takeaways: string[];
  status: GeneratedBriefingStatus;
  source_window_start: string | null;
  source_window_end: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  published_at: string | null;
};

export type DailyBriefingGenerationOptions = {
  briefingDate: string;
  status?: GeneratedBriefingStatus;
  instructions?: string | null;
  lookbackHours?: number | null;
  maxNewsItems?: number;
  maxPodcastItems?: number;
  maxMarketItems?: number;
  maxWeatherItems?: number;
  maxLeadershipItems?: number;
};

type NewsContextRow = {
  id: number;
  source_name: string;
  publisher: string | null;
  title: string | null;
  summary: string | null;
  url: string | null;
  country_iso2: string | null;
  event_time: string | Date | null;
};

type MarketEventContextRow = {
  event_type: string;
  symbol: string | null;
  company_name: string | null;
  country: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  event_time: string | Date;
  source_name: string;
};

type GdeltEventContextRow = {
  event_code: string | null;
  quad_class: number | null;
  goldstein_scale: number | null;
  avg_tone: number | null;
  actor1_name: string | null;
  actor2_name: string | null;
  country: string | null;
  location: string | null;
  mention_count: number | null;
  source_count: number | null;
  article_count: number | null;
  event_time: string | Date;
  url: string | null;
};

type GdeltSignalContextRow = {
  domain: string | null;
  language_code: string | null;
  source_country: string | null;
  tone: number | null;
  themes: unknown;
  persons: unknown;
  organizations: unknown;
  locations: unknown;
  event_time: string | Date;
  url: string | null;
};

type PodcastContextRow = {
  id: number;
  title: string;
  summary: string | null;
  event_time: string | Date | null;
  feed_title: string;
  publisher_url: string | null;
  external_links: unknown;
  evidence: unknown;
  signals: unknown;
};

type BriefingContext = {
  briefing_date: string;
  source_window_start: string;
  source_window_end: string;
  generated_at: string;
  counts: {
    news: number;
    news_events: number;
    news_signals: number;
    podcasts: number;
    markets: number;
    weather: number;
    leadership: number;
    transport: number;
  };
  news: Array<Record<string, unknown>>;
  global_events: Array<Record<string, unknown>>;
  news_intelligence: Array<Record<string, unknown>>;
  podcasts: Array<Record<string, unknown>>;
  markets: Array<Record<string, unknown>>;
  market_primary_events: Array<Record<string, unknown>>;
  market_analysis: Record<string, unknown>;
  weather: Array<Record<string, unknown>>;
  weather_analysis: Record<string, unknown>;
  leadership: Array<Record<string, unknown>>;
  transport: Record<string, unknown>;
};

type BriefingModelOutput = {
  title?: unknown;
  update_text?: unknown;
  key_takeaways?: unknown;
  data_quality_notes?: unknown;
};

export class BriefingGenerationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BriefingGenerationError";
    this.status = status;
  }
}

const PROMPT_VERSION = "daily-signal-briefing.v6";

const BRIEFING_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      description: "Short title for the briefing, 8 to 80 characters.",
    },
    update_text: {
      type: "string",
      description: "One concise briefing paragraph covering material news, attributed podcast intelligence, markets, weather, and transport using only supplied evidence. Leadership changes may appear only when directly reported by supplied news.",
    },
    key_takeaways: {
      type: "array",
      description: "Three to six short bullets with the most important updates.",
      items: { type: "string" },
    },
    data_quality_notes: {
      type: "array",
      description: "Short notes about missing, stale, or thin source data. Empty array if source coverage is adequate.",
      items: { type: "string" },
    },
  },
  required: ["title", "update_text", "key_takeaways", "data_quality_notes"],
};

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value as number)) return fallback;
  return Math.min(Math.max(Math.trunc(value as number), min), max);
}

function timestampToIso(value: string | Date | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function sanitizeTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
  return Array.from(new Set(items));
}

function getSourceWindow(briefingDate: string, lookbackHours?: number | null) {
  const dayStart = new Date(`${briefingDate}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) {
    throw new BriefingGenerationError(400, "briefingDate must be a valid YYYY-MM-DD date.");
  }

  const now = new Date();
  if (dayStart.getTime() > now.getTime() + 60_000) {
    throw new BriefingGenerationError(400, "Cannot generate a daily briefing for a future date.");
  }

  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const end = dayStart <= now && now < dayEnd ? now : dayEnd;
  const boundedLookbackHours =
    Number.isFinite(lookbackHours as number) && (lookbackHours as number) > 0
      ? Math.min(Math.max(Math.trunc(lookbackHours as number), 1), 168)
      : null;
  const start = boundedLookbackHours
    ? new Date(end.getTime() - boundedLookbackHours * 60 * 60 * 1000)
    : dayStart;

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function collectBriefingContext(options: Required<Pick<DailyBriefingGenerationOptions, "briefingDate">> &
  Omit<DailyBriefingGenerationOptions, "briefingDate">): Promise<BriefingContext> {
  const { start, end } = getSourceWindow(options.briefingDate, options.lookbackHours);
  const newsLimit = clampInteger(options.maxNewsItems, 24, 5, 80);
  const podcastLimit = clampInteger(options.maxPodcastItems, 12, 1, 40);
  const marketLimit = clampInteger(options.maxMarketItems, 16, 5, 60);
  const weatherLimit = clampInteger(options.maxWeatherItems, 16, 5, 80);
  const leadershipLimit = clampInteger(options.maxLeadershipItems, 200, 1, 250);

  const [
    newsResult,
    gdeltEventResult,
    gdeltSignalResult,
    podcastResult,
    marketOverview,
    marketEventResult,
    weatherResult,
    leadershipResult,
    transportResult,
  ] = await Promise.all([
    query<NewsContextRow>(
      `SELECT
         i.id,
         s.name AS source_name,
         COALESCE(NULLIF(i.payload->>'source', ''), NULLIF(i.payload->>'domain', ''), s.name) AS publisher,
         i.title,
         i.summary,
         i.url,
         i.country_iso2,
         COALESCE(i.event_time, i.created_at) AS event_time
       FROM item i
       JOIN source s ON s.id = i.source_id
       WHERE i.kind = 'news_article'
         AND COALESCE(i.event_time, i.created_at) >= $1::timestamptz
         AND COALESCE(i.event_time, i.created_at) < $2::timestamptz
       ORDER BY COALESCE(i.event_time, i.created_at) DESC, i.id DESC
       LIMIT $3`,
      [start, end, newsLimit]
    ),
    query<GdeltEventContextRow>(
      `SELECT event_code, quad_class, goldstein_scale, avg_tone,
              actor1_name, actor2_name, upper(action_country_iso2::text) AS country,
              action_geo_name AS location, mention_count, source_count, article_count,
              event_time, url
       FROM global_event
       WHERE event_time >= $1::timestamptz AND event_time < $2::timestamptz
       ORDER BY mention_count DESC NULLS LAST, abs(COALESCE(goldstein_scale, 0)) DESC, event_time DESC
       LIMIT $3`,
      [start, end, Math.min(newsLimit, 24)]
    ),
    query<GdeltSignalContextRow>(
      `SELECT domain, language_code, upper(source_country_iso2::text) AS source_country,
              tone, themes, persons, organizations, locations, event_time, url
       FROM news_signal
       WHERE event_time >= $1::timestamptz AND event_time < $2::timestamptz
       ORDER BY abs(COALESCE(tone, 0)) DESC, event_time DESC
       LIMIT $3`,
      [start, end, Math.min(newsLimit, 24)]
    ),
    query<PodcastContextRow>(
      `SELECT
         i.id,
         i.title,
         i.summary,
         COALESCE(i.event_time, i.created_at) AS event_time,
         pf.title AS feed_title,
         i.url AS publisher_url,
         pe.external_links,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'start_ms', evidence.start_ms,
             'end_ms', evidence.end_ms,
             'speaker', evidence.speaker,
             'text', evidence.text
           ) ORDER BY evidence.start_ms)
           FROM (
             SELECT start_ms, end_ms, speaker, text
             FROM evidence_segment
             WHERE episode_id = pe.id
             ORDER BY segment_index
             LIMIT 8
           ) evidence
         ), '[]'::jsonb) AS evidence,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'kind', signal.signal_type,
             'title', signal.title,
             'summary', signal.summary,
             'entities', signal.entities,
             'topics', signal.topics,
             'countries', CASE
               WHEN jsonb_typeof(signal.metadata->'countries') = 'array' THEN signal.metadata->'countries'
               ELSE '[]'::jsonb
             END,
             'risk_level', signal.risk_level,
             'confidence', signal.confidence
           ) ORDER BY signal.confidence DESC NULLS LAST)
           FROM intelligence_signal signal
           WHERE signal.episode_id = pe.id
         ), '[]'::jsonb) AS signals
       FROM item i
       JOIN podcast_episode pe ON pe.item_id = i.id
       JOIN podcast_feed pf ON pf.id = pe.feed_id
       WHERE COALESCE(i.event_time, i.created_at) >= $1::timestamptz
         AND COALESCE(i.event_time, i.created_at) < $2::timestamptz
       ORDER BY COALESCE(i.event_time, i.created_at) DESC, i.id DESC
       LIMIT $3`,
      [start, end, podcastLimit]
    ),
    getCountryMarketOverview(),
    query<MarketEventContextRow>(
      `SELECT
         me.event_type,
         me.symbol,
         me.company_name,
         upper(me.country_iso2::text) AS country,
         me.title,
         me.summary,
         me.url,
         me.event_time,
         s.name AS source_name
       FROM market_event me
       JOIN source s ON s.id = me.source_id
       WHERE me.event_time >= $1::timestamptz
         AND me.event_time < $2::timestamptz
       ORDER BY me.event_time DESC
       LIMIT $3`,
      [start, end, marketLimit]
    ),
    getCountryWeatherLatest(),
    getCountryLeadershipLatest(),
    getTransportOverviewForBriefing(),
  ]);

  const news = newsResult.rows.map((row) => ({
    id: Number(row.id),
    publisher: row.publisher,
    provider: row.source_name,
    title: row.title,
    summary: row.summary,
    country: row.country_iso2,
    event_time: timestampToIso(row.event_time),
    url: row.url,
  }));

  const podcasts = podcastResult.rows.map((row) => ({
    id: Number(row.id),
    podcast: row.feed_title,
    publisher_url: row.publisher_url,
    episode: row.title,
    publisher_summary: row.summary,
    event_time: timestampToIso(row.event_time),
    findings: Array.isArray(row.signals) ? row.signals : [],
    timestamped_evidence: Array.isArray(row.evidence) ? row.evidence : [],
    external_links: row.external_links && typeof row.external_links === "object" ? row.external_links : {},
  }));

  const globalEvents = gdeltEventResult.rows.map((row) => ({
    event_code: row.event_code,
    quad_class: row.quad_class,
    goldstein_scale: row.goldstein_scale,
    avg_tone: row.avg_tone,
    actors: [row.actor1_name, row.actor2_name].filter(Boolean),
    country: row.country,
    location: row.location,
    mentions: row.mention_count,
    sources: row.source_count,
    articles: row.article_count,
    event_time: timestampToIso(row.event_time),
    url: row.url,
    methodology: "Machine-coded GDELT event; corroborate with supplied publisher stories before presenting as confirmed fact.",
  }));
  const newsIntelligence = gdeltSignalResult.rows.map((row) => ({
    publisher_domain: row.domain,
    language: row.language_code,
    source_country: row.source_country,
    tone: row.tone,
    themes: Array.isArray(row.themes) ? row.themes : [],
    persons: Array.isArray(row.persons) ? row.persons : [],
    organizations: Array.isArray(row.organizations) ? row.organizations : [],
    locations: Array.isArray(row.locations) ? row.locations : [],
    event_time: timestampToIso(row.event_time),
    url: row.url,
  }));

  const markets = [...marketOverview.countries]
    .sort((left, right) =>
      Math.abs(right.composite_change_percent ?? 0) - Math.abs(left.composite_change_percent ?? 0) ||
      right.filing_count_7d - left.filing_count_7d
    )
    .slice(0, marketLimit)
    .map((row) => ({
      country: row.country,
      country_name: row.country_name,
      currency: row.currency,
      country_index: row.index_symbol ? {
        symbol: row.index_symbol,
        name: row.index_name,
        percent_change: row.index_change_percent,
        source: row.index_source,
        observed_at: row.index_observed_at,
      } : null,
      currency_vs_eur: row.fx_symbol ? {
        symbol: row.fx_symbol,
        rate: row.fx_rate,
        percent_change: row.fx_change_percent,
        period_end: row.fx_period_end,
      } : null,
      broad_effective_fx: row.effective_fx_symbol ? {
        symbol: row.effective_fx_symbol,
        index_value: row.effective_fx_rate,
        percent_change: row.effective_fx_change_percent,
        period_end: row.effective_fx_period_end,
        source: row.effective_fx_source,
      } : null,
      sec_filings_7d: row.filing_count_7d,
      composite_change_percent: row.composite_change_percent,
      composite_basis: row.composite_basis,
      freshness: row.freshness,
    }));

  const marketPrimaryEvents = marketEventResult.rows.map((row) => ({
    event_type: row.event_type,
    symbol: row.symbol,
    company_name: row.company_name,
    country: row.country,
    title: row.title,
    summary: row.summary,
    url: row.url,
    event_time: timestampToIso(row.event_time),
    source: row.source_name,
  }));

  const weatherSeverity = (row: (typeof weatherResult)[number]): number =>
    Math.max(
      row.temp_c == null ? 0 : Math.abs(row.temp_c - 20),
      (row.precipitation_mm ?? 0) * 2,
      (row.wind_gust ?? row.wind_speed ?? 0) / 2,
      (row.air_quality?.european_aqi ?? row.air_quality?.us_aqi ?? 0) / 4,
      row.alert_count > 0 ? 40 + row.alert_count : 0
    );
  const weatherRows = [...weatherResult].sort((left, right) => weatherSeverity(right) - weatherSeverity(left));
  const weather = weatherRows.slice(0, weatherLimit).map((row) => ({
    country: row.country,
    temp_c: row.temp_c,
    apparent_temp_c: row.apparent_temp_c,
    humidity: row.humidity,
    precipitation_mm: row.precipitation_mm,
    wind_speed: row.wind_speed,
    wind_gust: row.wind_gust,
    condition: row.weather_main,
    description: row.weather_desc,
    air_quality: row.air_quality,
    active_alerts: row.alerts.slice(0, 5),
    alert_count: row.alert_count,
    forecast_3d: row.forecast.slice(0, 3),
    source: row.source_name,
    attribution: row.attribution,
    observed_at: timestampToIso(row.observed_at),
    stale_for_window: new Date(row.observed_at).getTime() < new Date(start).getTime(),
  }));

  const hottest = [...weatherResult].filter((row) => row.temp_c != null).sort((a, b) => (b.temp_c ?? -Infinity) - (a.temp_c ?? -Infinity))[0];
  const coldest = [...weatherResult].filter((row) => row.temp_c != null).sort((a, b) => (a.temp_c ?? Infinity) - (b.temp_c ?? Infinity))[0];
  const wettest = [...weatherResult].sort((a, b) => (b.precipitation_mm ?? 0) - (a.precipitation_mm ?? 0))[0];
  const windiest = [...weatherResult].sort((a, b) => (b.wind_gust ?? b.wind_speed ?? 0) - (a.wind_gust ?? a.wind_speed ?? 0))[0];
  const worstAir = [...weatherResult].sort((a, b) => (b.air_quality?.european_aqi ?? 0) - (a.air_quality?.european_aqi ?? 0))[0];
  const mostAlerted = [...weatherResult].sort((a, b) => b.alert_count - a.alert_count)[0];
  const weatherAnalysis = {
    countries_covered: weatherResult.length,
    hottest: hottest ? { country: hottest.country, temp_c: hottest.temp_c } : null,
    coldest: coldest ? { country: coldest.country, temp_c: coldest.temp_c } : null,
    wettest: wettest ? { country: wettest.country, precipitation_mm: wettest.precipitation_mm } : null,
    windiest: windiest ? { country: windiest.country, wind_gust: windiest.wind_gust, wind_speed: windiest.wind_speed } : null,
    worst_air_quality: worstAir?.air_quality ? { country: worstAir.country, ...worstAir.air_quality } : null,
    most_alerted: mostAlerted?.alert_count ? {
      country: mostAlerted.country,
      alert_count: mostAlerted.alert_count,
      alerts: mostAlerted.alerts.slice(0, 5).map((alert) => ({ event: alert.event, severity: alert.severity, source: alert.source_name })),
    } : null,
    note: "Extrema compare the latest representative country-level observations; forecasts are supplied separately and are not observed outcomes.",
  };
  const marketAnalysis = {
    coverage: marketOverview.coverage,
    methodology: marketOverview.methodology,
    sources: marketOverview.sources,
    note: "SEC filing activity is contextual rather than directional. Missing country-index data is not imputed.",
  };

  const leadership = leadershipResult.slice(0, leadershipLimit).map((row) => ({
    country: row.country,
    country_name: row.country_name,
    government_type: row.government_type,
    summary: row.summary,
    current_officeholders: row.roles.map((role) => ({
      role: role.role_type,
      person: role.person_name,
      wikidata_id: role.person_wikidata_id,
      started_at: role.started_at,
      source_url: role.source_url,
    })),
    source: "Wikidata",
    source_updated_at: row.source_updated_at,
    retrieved_at: row.retrieved_at,
  }));
  const transport = {
    generated_at: transportResult.generated_at,
    summary: transportResult.summary,
    trends: transportResult.trends,
    takeaways: transportResult.takeaways,
    activity_ranking: {
      ...transportResult.activity_ranking,
      countries: transportResult.activity_ranking.countries.slice(0, 12),
    },
    leading_countries: transportResult.countries.slice(0, 12),
    leading_routes: transportResult.routes.slice(0, 12),
    monitored_ports: transportResult.ports.slice(0, 12),
    methodology: {
      maritime: transportResult.coverage.maritime.movement_method,
      cargo: transportResult.coverage.maritime.cargo_method,
      aviation:
        "Flight activity reflects Claritas polling areas and available ADS-B reception.",
    },
  };

  return {
    briefing_date: options.briefingDate,
    source_window_start: start,
    source_window_end: end,
    generated_at: new Date().toISOString(),
    counts: {
      news: news.length,
      news_events: globalEvents.length,
      news_signals: newsIntelligence.length,
      podcasts: podcasts.length,
      markets: markets.length,
      weather: weather.length,
      leadership: leadership.length,
      transport: transportResult.summary.active,
    },
    news,
    global_events: globalEvents,
    news_intelligence: newsIntelligence,
    podcasts,
    markets,
    market_primary_events: marketPrimaryEvents,
    market_analysis: marketAnalysis,
    weather,
    weather_analysis: weatherAnalysis,
    leadership,
    transport,
  };
}

function buildSystemPrompt(): string {
  return [
    "You generate Claritas daily signal briefings from supplied JSON evidence.",
    "Use only the supplied evidence. Do not invent facts, numbers, sources, causal links, or forecasts.",
    "Cover News, Podcast Intelligence, Markets, Weather, and Transport when material evidence is available. If a category has thin, stale, or missing data, say that plainly.",
    "For news, name the publisher when supplied and distinguish it from the aggregation provider. Do not imply that an aggregation provider is the publisher.",
    "GDELT Event records are machine-coded indicators, and GKG themes and tone are analytical metadata. Use them to identify coverage patterns and corroboration candidates; do not present an uncorroborated coded event, theme, or tone score as confirmed fact or public sentiment.",
    "For markets, distinguish country-index direction, local-currency performance versus EUR, SEC filing activity, and the composite methodology. A filing count is activity, not positive or negative performance. Do not imply index coverage where the country-index component is missing.",
    "For weather, explain the overall regime and material extrema using temperature, apparent temperature, precipitation, wind or gusts, air quality, and the supplied forecast horizon. Clearly distinguish current observations from forecasts.",
    "Connect weather, news, markets, filings, and transport only when the supplied geography or entity provides evidence for the relationship. Never claim causation from temporal or geographic coincidence.",
    "Transport comparisons use tracked observations, monitored-port geofences, and 24-hour comparison windows. Surface the leading country activity rank and the strongest material acceleration when ranking evidence is available, including the underlying ship-movement, tracked-flight, and live-link counts. Describe the index as relative within Claritas coverage, not total national activity. Describe cargo-vessel departures as a movement proxy; never present them as cargo tonnage, load, trade value, or complete port-authority counts.",
    "Treat podcast claims as attributed speaker statements, not independently verified facts. Retain uncertainty and attribution.",
    "Leadership records are reference context only. Never surface current officeholders, government type, or leadership records as a standalone signal. Mention a leadership change only when a supplied news item directly reports that change; keep it within the news update and cite no inference from Wikidata as evidence of a change.",
    "Markets content is informational only. Do not give investment advice or tell users to buy, sell, or hold.",
    "Keep the result concise, executive, and neutral.",
    "Return JSON only, matching the requested schema.",
  ].join(" ");
}

function buildUserPrompt(context: BriefingContext, instructions?: string | null): string {
  const extraInstructions = sanitizeText(instructions, 2000);
  return [
    `Briefing date: ${context.briefing_date}`,
    `Source window: ${context.source_window_start} to ${context.source_window_end}`,
    extraInstructions ? `Additional editorial instruction: ${extraInstructions}` : "",
    "Evidence JSON:",
    JSON.stringify(context),
    "",
    "Return JSON with title, update_text, key_takeaways, and data_quality_notes.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeModelOutput(output: BriefingModelOutput, context: BriefingContext) {
  const title = sanitizeText(output.title, 120) || "Daily signal brief";
  const updateText =
    sanitizeText(output.update_text, 1800) ||
    "No reliable briefing could be generated from the available cross-source data.";
  const takeaways = sanitizeTextList(output.key_takeaways, 8, 220);
  const dataQualityNotes = sanitizeTextList(output.data_quality_notes, 8, 240);

  return {
    title,
    update_text: updateText,
    key_takeaways:
      takeaways.length > 0
        ? takeaways
        : ["Briefing data was limited; review source coverage before relying on this update."],
    data_quality_notes: dataQualityNotes,
    context,
  };
}

export async function generateDailySignalBriefing(
  options: DailyBriefingGenerationOptions,
  llmClient: LlmClient = createLlmClientFromEnv()
) {
  const status = options.status || "published";
  const context = await collectBriefingContext(options);
  const response = await llmClient.generateStructured<BriefingModelOutput>({
    title: `Claritas briefing ${options.briefingDate}`,
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(context, options.instructions),
    schema: BRIEFING_OUTPUT_SCHEMA,
    retryCount: 2,
  });

  const normalized = normalizeModelOutput(response.output, context);
  const generatedAt = new Date().toISOString();

  const payload: GeneratedDailySignalBriefingPayload = {
    title: normalized.title,
    update_text: normalized.update_text,
    key_takeaways: normalized.key_takeaways,
    status,
    source_window_start: context.source_window_start,
    source_window_end: context.source_window_end,
    generated_by: response.model ? `${response.provider}:${response.model}` : response.provider,
    metadata: {
      prompt_version: PROMPT_VERSION,
      generated_at: generatedAt,
      llm: {
        provider: response.provider,
        model: response.model,
        ...response.metadata,
      },
      source_counts: context.counts,
      data_quality_notes: normalized.data_quality_notes,
      options: {
        lookback_hours: options.lookbackHours ?? null,
        max_news_items: options.maxNewsItems ?? null,
        max_podcast_items: options.maxPodcastItems ?? null,
        max_market_items: options.maxMarketItems ?? null,
        max_weather_items: options.maxWeatherItems ?? null,
        max_leadership_items: options.maxLeadershipItems ?? null,
      },
    },
    published_at: status === "published" ? generatedAt : null,
  };

  return {
    payload,
    generation: {
      provider: response.provider,
      model: response.model,
      source_counts: context.counts,
      source_window_start: context.source_window_start,
      source_window_end: context.source_window_end,
      data_quality_notes: normalized.data_quality_notes,
    },
  };
}

export function getDailyBriefingGeneratorConfig() {
  return {
    prompt_version: PROMPT_VERSION,
    llm: getLlmRuntimeConfig(),
  };
}
