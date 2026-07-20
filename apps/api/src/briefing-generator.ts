import { query } from "./db";
import { createLlmClientFromEnv, getLlmRuntimeConfig, type LlmClient } from "./llm";

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
  title: string | null;
  summary: string | null;
  url: string | null;
  country_iso2: string | null;
  event_time: string | Date | null;
};

type MarketContextRow = {
  symbol: string;
  company_name: string | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  price: number | null;
  change: number | null;
  percent_change: number | null;
  observed_at: string | Date;
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

type WeatherContextRow = {
  country_iso2: string;
  country_name: string | null;
  temp_c: number | null;
  feels_like_c: number | null;
  humidity: number | null;
  wind_speed: number | null;
  weather_main: string | null;
  weather_desc: string | null;
  observed_at: string | Date;
};

type LeadershipContextRow = {
  country_iso2: string;
  country_name: string;
  government_type: string | null;
  summary: string;
  source_updated_at: string | Date | null;
  retrieved_at: string | Date;
  roles: unknown;
};

type BriefingContext = {
  briefing_date: string;
  source_window_start: string;
  source_window_end: string;
  generated_at: string;
  counts: {
    news: number;
    podcasts: number;
    markets: number;
    weather: number;
    leadership: number;
  };
  news: Array<Record<string, unknown>>;
  podcasts: Array<Record<string, unknown>>;
  markets: Array<Record<string, unknown>>;
  weather: Array<Record<string, unknown>>;
  leadership: Array<Record<string, unknown>>;
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

const PROMPT_VERSION = "daily-signal-briefing.v2";

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
      description: "One concise briefing paragraph covering material news, attributed podcast intelligence, markets, weather, and relevant national leadership using only supplied evidence.",
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

  const [newsResult, podcastResult, marketResult, weatherResult, leadershipResult] = await Promise.all([
    query<NewsContextRow>(
      `SELECT
         i.id,
         s.name AS source_name,
         i.title,
         i.summary,
         i.url,
         i.country_iso2,
         COALESCE(i.event_time, i.created_at) AS event_time
       FROM item i
       JOIN source s ON s.id = i.source_id
       WHERE i.kind <> 'podcast_episode'
         AND COALESCE(i.event_time, i.created_at) >= $1::timestamptz
         AND COALESCE(i.event_time, i.created_at) < $2::timestamptz
       ORDER BY COALESCE(i.event_time, i.created_at) DESC, i.id DESC
       LIMIT $3`,
      [start, end, newsLimit]
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
    query<MarketContextRow>(
      `SELECT
         symbol,
         company_name,
         exchange,
         country,
         currency,
         price,
         change,
         percent_change,
         observed_at
       FROM market_snapshot
       WHERE observed_at <= $1::timestamptz
       ORDER BY ABS(COALESCE(percent_change, 0)) DESC, observed_at DESC, symbol ASC
       LIMIT $2`,
      [end, marketLimit]
    ),
    query<WeatherContextRow>(
      `SELECT
         ws.country_iso2,
         c.name AS country_name,
         ws.temp_c,
         ws.feels_like_c,
         ws.humidity,
         ws.wind_speed,
         ws.weather_main,
         ws.weather_desc,
         ws.observed_at
       FROM weather_snapshot ws
       LEFT JOIN country c ON c.iso2 = ws.country_iso2
       WHERE ws.observed_at <= $1::timestamptz
       ORDER BY ws.observed_at DESC, ws.country_iso2 ASC
       LIMIT $2`,
      [end, weatherLimit]
    ),
    query<LeadershipContextRow>(
      `SELECT
         upper(cl.country_iso2) AS country_iso2,
         cl.country_name,
         cl.government_type,
         cl.summary,
         cl.source_updated_at,
         cl.retrieved_at,
         COALESCE(jsonb_agg(jsonb_build_object(
           'role', clr.role_type,
           'person', clr.person_name,
           'wikidata_id', clr.person_wikidata_id,
           'started_at', clr.started_at,
           'source_url', clr.source_url
         ) ORDER BY clr.role_type, clr.person_name)
           FILTER (WHERE clr.id IS NOT NULL), '[]'::jsonb) AS roles
       FROM country_leadership cl
       LEFT JOIN country_leadership_role clr
         ON clr.country_iso2 = cl.country_iso2
       GROUP BY cl.country_iso2, cl.country_name, cl.government_type, cl.summary,
                cl.source_updated_at, cl.retrieved_at
       ORDER BY cl.country_name
       LIMIT $1`,
      [leadershipLimit]
    ),
  ]);

  const news = newsResult.rows.map((row) => ({
    id: Number(row.id),
    source: row.source_name,
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

  const markets = marketResult.rows.map((row) => ({
    symbol: row.symbol,
    company_name: row.company_name,
    exchange: row.exchange,
    country: row.country,
    currency: row.currency,
    price: row.price,
    change: row.change,
    percent_change: row.percent_change,
    observed_at: timestampToIso(row.observed_at),
    stale_for_window: new Date(row.observed_at).getTime() < new Date(start).getTime(),
  }));

  const weather = weatherResult.rows.map((row) => ({
    country: row.country_iso2,
    country_name: row.country_name,
    temp_c: row.temp_c,
    feels_like_c: row.feels_like_c,
    humidity: row.humidity,
    wind_speed: row.wind_speed,
    condition: row.weather_main,
    description: row.weather_desc,
    observed_at: timestampToIso(row.observed_at),
    stale_for_window: new Date(row.observed_at).getTime() < new Date(start).getTime(),
  }));

  const leadership = leadershipResult.rows.map((row) => ({
    country: row.country_iso2,
    country_name: row.country_name,
    government_type: row.government_type,
    summary: row.summary,
    current_officeholders: Array.isArray(row.roles) ? row.roles : [],
    source: "Wikidata",
    source_updated_at: timestampToIso(row.source_updated_at),
    retrieved_at: timestampToIso(row.retrieved_at),
  }));

  return {
    briefing_date: options.briefingDate,
    source_window_start: start,
    source_window_end: end,
    generated_at: new Date().toISOString(),
    counts: {
      news: news.length,
      podcasts: podcasts.length,
      markets: markets.length,
      weather: weather.length,
      leadership: leadership.length,
    },
    news,
    podcasts,
    markets,
    weather,
    leadership,
  };
}

function buildSystemPrompt(): string {
  return [
    "You generate Claritas daily signal briefings from supplied JSON evidence.",
    "Use only the supplied evidence. Do not invent facts, numbers, sources, causal links, or forecasts.",
    "Cover News, Podcast Intelligence, Markets, Weather, and relevant national Leadership when material evidence is available. If a category has thin, stale, or missing data, say that plainly.",
    "Treat podcast claims as attributed speaker statements, not independently verified facts. Retain uncertainty and attribution.",
    "Connect named leaders and countries only when the supplied evidence supports the relationship. Leadership records are context, not proof of involvement.",
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
