import { ingestOpenWeatherCountryWeather } from "./connectors/openweather";
import { ingestNwsAlerts } from "./connectors/nws";
import { ingestGdelt } from "./connectors/gdelt";
import { ingestInstitutionalRss } from "./connectors/institutional-rss";
import { ingestSecEdgar } from "./connectors/sec-edgar";
import { ingestEcbData } from "./connectors/ecb";
import { ingestOecdSharePrices } from "./connectors/oecd";
import { ingestPodcastIndex, podcastParamsFromEnv, type PodcastIngestParams } from "./connectors/podcastindex";
import { ingestWikidataLeadership } from "./connectors/wikidata-leadership";
import { query } from "./db";

export type IngestionPipeline = "news" | "weather" | "market" | "podcasts" | "leadership";
export type IngestionRunStatus = "queued" | "running" | "success" | "failed" | "unknown";
export type IngestionLogLevel = "info" | "warn" | "error";

export type AdminIngestionRun = {
  id: number;
  pipeline: IngestionPipeline;
  source_name: string;
  status: IngestionRunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: any;
  trigger_mode: string | null;
  requested_by_email: string | null;
  request_payload: any;
  log_count: number;
};

export type AdminIngestionLog = {
  id: number;
  run_id: number;
  logged_at: string;
  level: IngestionLogLevel;
  message: string;
  context: any | null;
};

export type AdminIngestionMetricPoint = {
  date: string;
  pipeline: IngestionPipeline;
  run_count: number;
  success_count: number;
  failed_count: number;
  queued_count: number;
  running_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  http_failures: number;
  db_errors: number;
};

export type AdminIngestionMetricTotal = {
  pipeline: IngestionPipeline;
  run_count: number;
  success_count: number;
  failed_count: number;
  queued_count: number;
  running_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  http_failures: number;
  db_errors: number;
};

type SourceRow = {
  id: number;
  name: string;
};

type DbTimestamp = string | Date;

type RunRow = {
  id: number;
  pipeline: string | null;
  source_name: string;
  status: string | null;
  started_at: DbTimestamp;
  finished_at: DbTimestamp | null;
  error: string | null;
  stats: any;
  trigger_mode: string | null;
  requested_by_email: string | null;
  request_payload: any;
  log_count: number;
};

type RunLogRow = {
  id: number;
  run_id: number;
  logged_at: DbTimestamp;
  level: string;
  message: string;
  context: any | null;
};

type MetricRunRow = {
  pipeline: string | null;
  source_name: string;
  status: string | null;
  started_at: DbTimestamp;
  stats: any;
};

type TriggerActor = {
  userId: number | null;
  email: string | null;
  triggerMode: string;
};

type IngestionTotals = {
  inserted: number;
  updated: number;
  skipped: number;
  http_failures: number;
  db_errors: number;
};

type NewsRunProviders = {
  gdelt: boolean;
  institutionalRss: boolean;
};

type NewsRunPlan = {
  providers: NewsRunProviders;
  requestPayload: Record<string, unknown>;
};

type WeatherRunPlan = {
  country?: string;
  providers: { openweather: boolean; nws: boolean };
  requestPayload: Record<string, unknown>;
};

type MarketRunPlan = {
  providers: { secEdgar: boolean; ecb: boolean; oecd: boolean };
  requestPayload: Record<string, unknown>;
};

type PodcastRunPlan = PodcastIngestParams & {
  requestPayload: Record<string, unknown>;
};

type LeadershipRunPlan = {
  requestPayload: Record<string, unknown>;
};

type StepResult = {
  step: string;
  status: "success" | "failed";
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result?: Record<string, unknown>;
  error?: string;
};

type TriggerRunInput = {
  pipeline: IngestionPipeline;
  actor: TriggerActor;
  requestPayload: Record<string, unknown>;
  sourceNameOverride?: SourceConfigKey;
};

type SourceConfigKey =
  | "gdelt"
  | "institutionalRss"
  | "openweather"
  | "nws"
  | "secEdgar"
  | "ecb"
  | "oecd"
  | "podcastindex"
  | "wikidata";

const SOURCE_CONFIG: Record<
  SourceConfigKey,
  { sourceName: string; apiBaseUrl: string; provider: string; authType: "api_key" | "none" }
> = {
  gdelt: {
    sourceName: "gdelt",
    apiBaseUrl: "https://api.gdeltproject.org/api/v2",
    provider: "gdelt",
    authType: "none",
  },
  institutionalRss: {
    sourceName: "institutional_rss",
    apiBaseUrl: "https://claritas.info/sources/institutional-rss",
    provider: "institutional_rss",
    authType: "none",
  },
  openweather: {
    sourceName: "openweather",
    apiBaseUrl: "https://api.openweathermap.org",
    provider: "openweather",
    authType: "api_key",
  },
  nws: {
    sourceName: "nws",
    apiBaseUrl: "https://api.weather.gov",
    provider: "nws",
    authType: "none",
  },
  secEdgar: {
    sourceName: "sec_edgar",
    apiBaseUrl: "https://data.sec.gov",
    provider: "sec_edgar",
    authType: "none",
  },
  ecb: {
    sourceName: "ecb",
    apiBaseUrl: "https://data-api.ecb.europa.eu/service/data",
    provider: "ecb",
    authType: "none",
  },
  oecd: {
    sourceName: "oecd",
    apiBaseUrl: "https://sdmx.oecd.org/public/rest/data",
    provider: "oecd",
    authType: "none",
  },
  podcastindex: {
    sourceName: "podcastindex",
    apiBaseUrl: "https://api.podcastindex.org/api/1.0",
    provider: "podcastindex",
    authType: "api_key",
  },
  wikidata: {
    sourceName: "wikidata",
    apiBaseUrl: "https://query.wikidata.org",
    provider: "wikidata",
    authType: "none",
  },
};

const PIPELINE_SOURCE_DEFAULT: Record<IngestionPipeline, SourceConfigKey> = {
  news: "gdelt",
  weather: "openweather",
  market: "secEdgar",
  podcasts: "podcastindex",
  leadership: "wikidata",
};

const activeRunPromises = new Map<number, Promise<void>>();

const INGESTION_SOURCE_NAMES = [
  "gdelt",
  "institutional_rss",
  "openweather",
  "nws",
  "sec_edgar",
  "ecb",
  "oecd",
  "podcastindex",
  "wikidata",
] as const;

const INGESTION_SOURCE_SQL = `('${INGESTION_SOURCE_NAMES.join("', '")}')`;

export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionValidationError";
  }
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function timestampToString(value: unknown): string {
  if (value instanceof Date) {
    const ts = value.getTime();
    if (!Number.isNaN(ts)) return value.toISOString();
    return toIsoNow();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return toIsoNow();
}

function timestampToDateKey(value: unknown): string | null {
  if (value instanceof Date) {
    const ts = value.getTime();
    if (!Number.isNaN(ts)) return value.toISOString().slice(0, 10);
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  }
  return fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeIso2(value: unknown, allowEmpty = false): string | undefined {
  const text = asString(value);
  if (!text) return allowEmpty ? undefined : undefined;
  if (!/^[a-zA-Z]{2}$/.test(text)) {
    throw new IngestionValidationError(`Invalid ISO2 country code: "${text}"`);
  }
  return text.toLowerCase();
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function emptyTotals(): IngestionTotals {
  return {
    inserted: 0,
    updated: 0,
    skipped: 0,
    http_failures: 0,
    db_errors: 0,
  };
}

function readTotal(stats: unknown, paths: string[]): number {
  for (const path of paths) {
    const value = getPath(stats, path);
    const numeric = toFiniteNumber(value);
    if (numeric != null) return numeric;
  }
  return 0;
}

function extractTotals(stats: unknown): IngestionTotals {
  return {
    inserted: readTotal(stats, ["totals.inserted", "inserted"]),
    updated: readTotal(stats, ["totals.updated", "updated"]),
    skipped: readTotal(stats, ["totals.skipped", "skipped"]),
    http_failures: readTotal(stats, ["totals.http_failures", "http_failures"]),
    db_errors: readTotal(stats, ["totals.db_errors", "db_errors"]),
  };
}

function mergeTotals(target: IngestionTotals, delta: IngestionTotals): void {
  target.inserted += delta.inserted;
  target.updated += delta.updated;
  target.skipped += delta.skipped;
  target.http_failures += delta.http_failures;
  target.db_errors += delta.db_errors;
}

function resolvePipeline(pipeline: string | null, sourceName: string): IngestionPipeline {
  if (
    pipeline === "news" ||
    pipeline === "weather" ||
    pipeline === "market" ||
    pipeline === "podcasts" ||
    pipeline === "leadership"
  ) {
    return pipeline;
  }
  if (sourceName === "gdelt") return "news";
  if (sourceName === "institutional_rss") return "news";
  if (sourceName === "openweather") return "weather";
  if (sourceName === "nws") return "weather";
  if (sourceName === "sec_edgar" || sourceName === "ecb" || sourceName === "oecd") return "market";
  if (sourceName === "podcastindex") return "podcasts";
  if (sourceName === "wikidata") return "leadership";
  return "news";
}

function normalizeStatus(status: string | null): IngestionRunStatus {
  if (status === "queued" || status === "running" || status === "success" || status === "failed") {
    return status;
  }
  return "unknown";
}

function normalizeLogLevel(level: string): IngestionLogLevel {
  if (level === "warn" || level === "error") return level;
  return "info";
}

function toAdminRun(row: RunRow): AdminIngestionRun {
  return {
    id: row.id,
    pipeline: resolvePipeline(row.pipeline, row.source_name),
    source_name: row.source_name,
    status: normalizeStatus(row.status),
    started_at: timestampToString(row.started_at),
    finished_at: row.finished_at == null ? null : timestampToString(row.finished_at),
    error: row.error,
    stats: row.stats ?? null,
    trigger_mode: row.trigger_mode,
    requested_by_email: row.requested_by_email,
    request_payload: row.request_payload ?? null,
    log_count: Number(row.log_count ?? 0),
  };
}

function toAdminLog(row: RunLogRow): AdminIngestionLog {
  return {
    id: row.id,
    run_id: row.run_id,
    logged_at: timestampToString(row.logged_at),
    level: normalizeLogLevel(row.level),
    message: row.message,
    context: row.context ?? null,
  };
}

async function ensureSource(
  pipeline: IngestionPipeline,
  sourceNameOverride?: SourceConfigKey
): Promise<SourceRow> {
  const sourceName = sourceNameOverride ?? PIPELINE_SOURCE_DEFAULT[pipeline];
  const cfg = SOURCE_CONFIG[sourceName];
  const { rows } = await query<SourceRow>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, $4, jsonb_build_object('provider', $3::text))
     ON CONFLICT (name)
     DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type,
       metadata = COALESCE(source.metadata, '{}'::jsonb) || jsonb_build_object('provider', $3::text)
     RETURNING id, name`,
    [cfg.sourceName, cfg.apiBaseUrl, cfg.provider, cfg.authType]
  );
  return rows[0];
}

async function createRun(input: TriggerRunInput): Promise<{ id: number }> {
  const source = await ensureSource(input.pipeline, input.sourceNameOverride);
  const stats = {
    pipeline: input.pipeline,
    steps: [],
    totals: emptyTotals(),
  };
  const { rows } = await query<{ id: number }>(
    `INSERT INTO ingestion_run (
      source_id, feed_id, started_at, finished_at, status, error, stats,
      pipeline, trigger_mode, requested_by_user_id, requested_by_email, request_payload
     )
     VALUES ($1, NULL, now(), NULL, 'queued', NULL, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      source.id,
      JSON.stringify(stats),
      input.pipeline,
      input.actor.triggerMode,
      input.actor.userId,
      input.actor.email,
      JSON.stringify(input.requestPayload),
    ]
  );
  return rows[0];
}

async function updateRunStatus(
  runId: number,
  status: "running" | "success" | "failed",
  details?: { error?: string | null; stats?: Record<string, unknown>; finished?: boolean }
): Promise<void> {
  const finishedAt = details?.finished ? "now()" : "NULL";
  await query(
    `UPDATE ingestion_run
     SET status = $2,
         error = $3,
         stats = COALESCE($4::jsonb, stats),
         finished_at = ${finishedAt}
     WHERE id = $1`,
    [runId, status, details?.error ?? null, details?.stats ? JSON.stringify(details.stats) : null]
  );
}

async function appendRunLog(
  runId: number,
  level: IngestionLogLevel,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO ingestion_run_log (run_id, logged_at, level, message, context)
     VALUES ($1, now(), $2, $3, $4)`,
    [runId, level, message, context ? JSON.stringify(context) : null]
  );
}

async function safeAppendRunLog(
  runId: number,
  level: IngestionLogLevel,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await appendRunLog(runId, level, message, context);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to append ingestion log:", err);
  }
}

function startRunTask(runId: number, task: () => Promise<void>) {
  const promise = (async () => {
    try {
      await task();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Unhandled error in ingestion run ${runId}:`, err);
    } finally {
      activeRunPromises.delete(runId);
    }
  })();
  activeRunPromises.set(runId, promise);
}

export function buildNewsRunPlan(rawBody: unknown): NewsRunPlan {
  const body = asRecord(rawBody);
  const providersRaw = asRecord(body.providers);
  const providers: NewsRunProviders = {
    gdelt: asBoolean(providersRaw.gdelt, true),
    institutionalRss: asBoolean(providersRaw.institutionalRss ?? providersRaw.institutional_rss, true),
  };
  if (!providers.gdelt && !providers.institutionalRss) {
    throw new IngestionValidationError("Select at least one news provider.");
  }
  return { providers, requestPayload: { providers } };
}

export function buildWeatherRunPlan(rawBody: unknown): WeatherRunPlan {
  const body = asRecord(rawBody);
  const country = normalizeIso2(body.country, true);
  const providerInput = asRecord(body.providers);
  const providers = {
    openweather: asBoolean(providerInput.openweather, true),
    nws: asBoolean(providerInput.nws, true),
  };
  if (!providers.openweather && !providers.nws) {
    throw new IngestionValidationError("Select at least one weather provider.");
  }
  if (providers.openweather && !process.env.OPENWEATHER_API_KEY) {
    throw new IngestionValidationError("OpenWeather selected but OPENWEATHER_API_KEY is not configured.");
  }
  return {
    country: country ? country.toUpperCase() : undefined,
    providers,
    requestPayload: { providers, ...(country ? { country: country.toUpperCase() } : {}) },
  };
}

export function buildMarketRunPlan(rawBody: unknown): MarketRunPlan {
  const body = asRecord(rawBody);
  const providerInput = asRecord(body.providers);
  const providers = {
    secEdgar: asBoolean(providerInput.secEdgar ?? providerInput.sec_edgar, true),
    ecb: asBoolean(providerInput.ecb, true),
    oecd: asBoolean(providerInput.oecd, true),
  };
  if (!providers.secEdgar && !providers.ecb && !providers.oecd) {
    throw new IngestionValidationError("Select at least one market provider.");
  }

  return {
    providers,
    requestPayload: { providers },
  };
}

export function buildPodcastRunPlan(rawBody: unknown): PodcastRunPlan {
  if (!process.env.PODCASTINDEX_API_KEY?.trim() || !process.env.PODCASTINDEX_API_SECRET?.trim()) {
    throw new IngestionValidationError("PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET must be configured.");
  }
  const body = asRecord(rawBody);
  const toList = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
  const feedIds = toList(body.feedIds ?? body.feed_ids)
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(0, 50);
  const searchTerms = toList(body.searchTerms ?? body.search_terms)
    .map(asString)
    .filter((value): value is string => Boolean(value))
    .slice(0, 20);
  const params = podcastParamsFromEnv({
    feedIds,
    searchTerms,
    maxFeeds: clampInt(body.maxFeeds ?? body.max_feeds, 1, 50, 10),
    maxEpisodesPerFeed: clampInt(body.maxEpisodesPerFeed ?? body.max_episodes_per_feed, 1, 100, 10),
    since: toFiniteNumber(body.since) ?? undefined,
    fetchTranscripts: asBoolean(body.fetchTranscripts ?? body.fetch_transcripts, true),
    extractIntelligence: asBoolean(body.extractIntelligence ?? body.extract_intelligence, true),
  });
  if (!params.feedIds?.length && !params.searchTerms?.length) {
    throw new IngestionValidationError(
      "Provide feedIds/searchTerms or configure PODCAST_FEED_IDS/PODCAST_DISCOVERY_TERMS."
    );
  }
  return {
    ...params,
    requestPayload: {
      feedIds: params.feedIds,
      searchTerms: params.searchTerms,
      maxFeeds: params.maxFeeds,
      maxEpisodesPerFeed: params.maxEpisodesPerFeed,
      since: params.since,
      fetchTranscripts: params.fetchTranscripts,
      extractIntelligence: params.extractIntelligence,
    },
  };
}

export function buildLeadershipRunPlan(_rawBody: unknown): LeadershipRunPlan {
  return { requestPayload: {} };
}

async function executeProviderStep(
  runId: number,
  steps: StepResult[],
  totals: IngestionTotals,
  step: string,
  action: () => Promise<Record<string, unknown>>,
): Promise<boolean> {
  const startedAt = Date.now();
  await safeAppendRunLog(runId, "info", `Running ${step} ingest.`);
  try {
    const result = await action();
    mergeTotals(totals, extractTotals(result));
    steps.push({
      step,
      status: "success",
      started_at: new Date(startedAt).toISOString(),
      finished_at: toIsoNow(),
      duration_ms: Date.now() - startedAt,
      result,
    });
    await safeAppendRunLog(runId, "info", `${step} ingest completed.`, { result });
    return true;
  } catch (error) {
    const message = toErrorMessage(error);
    steps.push({
      step,
      status: "failed",
      started_at: new Date(startedAt).toISOString(),
      finished_at: toIsoNow(),
      duration_ms: Date.now() - startedAt,
      error: message,
    });
    totals.http_failures += 1;
    await safeAppendRunLog(runId, "error", `${step} ingest failed.`, { error: message });
    return false;
  }
}

async function executeNewsRun(runId: number, plan: NewsRunPlan): Promise<void> {
  const runStartedAt = Date.now();
  const steps: StepResult[] = [];
  const totals = emptyTotals();

  try {
    await updateRunStatus(runId, "running");
    await safeAppendRunLog(runId, "info", "News ingestion run started.", {
      request: plan.requestPayload,
    });

    if (plan.providers.gdelt) {
      await executeProviderStep(runId, steps, totals, "gdelt/doc-event-gkg", async () => ingestGdelt());
    }
    if (plan.providers.institutionalRss) {
      await executeProviderStep(runId, steps, totals, "institutional-rss/primary-source-releases", ingestInstitutionalRss);
    }

    const succeeded = steps.filter((step) => step.status === "success").length;
    if (succeeded === 0) throw new Error("All selected news providers failed.");

    const stats = {
      pipeline: "news",
      duration_ms: Date.now() - runStartedAt,
      steps,
      totals,
    };

    await updateRunStatus(runId, "success", { stats, finished: true });
    await safeAppendRunLog(runId, "info", "News ingestion run finished successfully.", {
      totals,
    });
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    const stats = {
      pipeline: "news",
      duration_ms: Date.now() - runStartedAt,
      steps,
      totals,
    };
    await updateRunStatus(runId, "failed", {
      error: errorMessage,
      stats,
      finished: true,
    });
    await safeAppendRunLog(runId, "error", "News ingestion run failed.", {
      error: errorMessage,
      totals,
    });
  }
}

async function executeWeatherRun(runId: number, plan: WeatherRunPlan): Promise<void> {
  const runStartedAt = Date.now();
  const steps: StepResult[] = [];
  const totals = emptyTotals();

  try {
    await updateRunStatus(runId, "running");
    await safeAppendRunLog(runId, "info", "Weather ingestion run started.", {
      request: plan.requestPayload,
    });

    if (plan.providers.openweather) {
      await executeProviderStep(runId, steps, totals, "openweather/one-call-forecast-air-alerts", async () =>
        ingestOpenWeatherCountryWeather(plan.country));
    }
    if (plan.providers.nws && (!plan.country || plan.country === "US")) {
      await executeProviderStep(runId, steps, totals, "nws/active-alerts", ingestNwsAlerts);
    }

    const succeeded = steps.filter((step) => step.status === "success").length;
    if (succeeded === 0) throw new Error("All selected weather providers failed.");

    const stats = {
      pipeline: "weather",
      duration_ms: Date.now() - runStartedAt,
      steps,
      totals,
    };

    await updateRunStatus(runId, "success", { stats, finished: true });
    await safeAppendRunLog(runId, "info", "Weather ingestion run finished successfully.", {
      totals,
    });
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    const stats = {
      pipeline: "weather",
      duration_ms: Date.now() - runStartedAt,
      steps,
      totals,
    };
    await updateRunStatus(runId, "failed", {
      error: errorMessage,
      stats,
      finished: true,
    });
    await safeAppendRunLog(runId, "error", "Weather ingestion run failed.", {
      error: errorMessage,
      totals,
    });
  }
}

async function executeMarketRun(runId: number, plan: MarketRunPlan): Promise<void> {
  const runStartedAt = Date.now();
  const steps: StepResult[] = [];
  const totals = emptyTotals();

  try {
    await updateRunStatus(runId, "running");
    await safeAppendRunLog(runId, "info", "Market ingestion run started.", {
      request: plan.requestPayload,
    });

    if (plan.providers.secEdgar) {
      await executeProviderStep(runId, steps, totals, "sec-edgar/filings-companyfacts", async () =>
        ingestSecEdgar());
    }
    if (plan.providers.ecb) {
      await executeProviderStep(runId, steps, totals, "ecb/fx-rates", async () => ingestEcbData());
    }
    if (plan.providers.oecd) {
      await executeProviderStep(runId, steps, totals, "oecd/monthly-share-price-indices", ingestOecdSharePrices);
    }
    const succeeded = steps.filter((step) => step.status === "success").length;
    if (succeeded === 0) throw new Error("All selected market providers failed.");

    const stats = {
      pipeline: "market",
      duration_ms: Date.now() - runStartedAt,
      steps,
      totals,
    };

    await updateRunStatus(runId, "success", { stats, finished: true });
    await safeAppendRunLog(runId, "info", "Market ingestion run finished successfully.", {
      totals,
    });
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    const stats = {
      pipeline: "market",
      duration_ms: Date.now() - runStartedAt,
      steps,
      totals,
    };
    await updateRunStatus(runId, "failed", {
      error: errorMessage,
      stats,
      finished: true,
    });
    await safeAppendRunLog(runId, "error", "Market ingestion run failed.", {
      error: errorMessage,
      totals,
    });
  }
}

async function executePodcastRun(runId: number, plan: PodcastRunPlan): Promise<void> {
  const startedAt = Date.now();
  const totals = emptyTotals();
  try {
    await updateRunStatus(runId, "running");
    await safeAppendRunLog(runId, "info", "PodcastIndex ingestion run started.", { request: plan.requestPayload });
    const result = await ingestPodcastIndex(plan);
    totals.inserted = result.inserted;
    totals.updated = result.updated;
    totals.skipped = result.skipped;
    const stats = {
      pipeline: "podcasts",
      duration_ms: Date.now() - startedAt,
      totals,
      podcast: result,
    };
    await updateRunStatus(runId, "success", { stats, finished: true });
    await safeAppendRunLog(runId, "info", "PodcastIndex ingestion run finished successfully.", {
      totals,
      feeds: result.feeds,
      episodes: result.episodes,
      evidence_segments: result.evidence_segments,
      intelligence_signals: result.intelligence_signals,
    });
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    await updateRunStatus(runId, "failed", {
      error: errorMessage,
      stats: { pipeline: "podcasts", duration_ms: Date.now() - startedAt, totals },
      finished: true,
    });
    await safeAppendRunLog(runId, "error", "PodcastIndex ingestion run failed.", { error: errorMessage, totals });
  }
}

async function executeLeadershipRun(runId: number, plan: LeadershipRunPlan): Promise<void> {
  const startedAt = Date.now();
  const totals = emptyTotals();
  try {
    await updateRunStatus(runId, "running");
    await safeAppendRunLog(runId, "info", "Wikidata leadership ingestion run started.", {
      request: plan.requestPayload,
    });
    const result = await ingestWikidataLeadership();
    totals.inserted = result.inserted;
    totals.updated = result.updated;
    totals.skipped = result.skipped;
    const stats = {
      pipeline: "leadership",
      duration_ms: Date.now() - startedAt,
      totals,
      leadership: result,
    };
    await updateRunStatus(runId, "success", { stats, finished: true });
    await safeAppendRunLog(runId, "info", "Wikidata leadership ingestion run finished successfully.", {
      totals,
      countries: result.countries,
      roles: result.roles,
      source_updated_at: result.source_updated_at,
      retrieved_at: result.retrieved_at,
    });
  } catch (err) {
    const errorMessage = toErrorMessage(err);
    await updateRunStatus(runId, "failed", {
      error: errorMessage,
      stats: { pipeline: "leadership", duration_ms: Date.now() - startedAt, totals },
      finished: true,
    });
    await safeAppendRunLog(runId, "error", "Wikidata leadership ingestion run failed.", {
      error: errorMessage,
      totals,
    });
  }
}

export async function triggerNewsRun(input: {
  actor: TriggerActor;
  plan: NewsRunPlan;
}): Promise<{ runId: number }> {
  const sourceNameOverride: SourceConfigKey = input.plan.providers.gdelt ? "gdelt" : "institutionalRss";
  const run = await createRun({
    pipeline: "news",
    actor: input.actor,
    requestPayload: input.plan.requestPayload,
    sourceNameOverride,
  });
  await safeAppendRunLog(run.id, "info", "News ingestion run queued.", {
    requested_by: input.actor.email || input.actor.userId,
  });
  startRunTask(run.id, () => executeNewsRun(run.id, input.plan));
  return { runId: run.id };
}

export async function triggerWeatherRun(input: {
  actor: TriggerActor;
  plan: WeatherRunPlan;
}): Promise<{ runId: number }> {
  const run = await createRun({
    pipeline: "weather",
    actor: input.actor,
    requestPayload: input.plan.requestPayload,
    sourceNameOverride: input.plan.providers.openweather ? "openweather" : "nws",
  });
  await safeAppendRunLog(run.id, "info", "Weather ingestion run queued.", {
    requested_by: input.actor.email || input.actor.userId,
  });
  startRunTask(run.id, () => executeWeatherRun(run.id, input.plan));
  return { runId: run.id };
}

export async function triggerMarketRun(input: {
  actor: TriggerActor;
  plan: MarketRunPlan;
}): Promise<{ runId: number }> {
  const run = await createRun({
    pipeline: "market",
    actor: input.actor,
    requestPayload: input.plan.requestPayload,
    sourceNameOverride: input.plan.providers.secEdgar
      ? "secEdgar" : input.plan.providers.ecb ? "ecb" : "oecd",
  });
  await safeAppendRunLog(run.id, "info", "Market ingestion run queued.", {
    requested_by: input.actor.email || input.actor.userId,
  });
  startRunTask(run.id, () => executeMarketRun(run.id, input.plan));
  return { runId: run.id };
}

export async function triggerPodcastRun(input: {
  actor: TriggerActor;
  plan: PodcastRunPlan;
}): Promise<{ runId: number }> {
  const run = await createRun({
    pipeline: "podcasts",
    actor: input.actor,
    requestPayload: input.plan.requestPayload,
    sourceNameOverride: "podcastindex",
  });
  await safeAppendRunLog(run.id, "info", "PodcastIndex ingestion run queued.", {
    requested_by: input.actor.email || input.actor.userId,
  });
  startRunTask(run.id, () => executePodcastRun(run.id, input.plan));
  return { runId: run.id };
}

export async function triggerLeadershipRun(input: {
  actor: TriggerActor;
  plan: LeadershipRunPlan;
}): Promise<{ runId: number }> {
  const run = await createRun({
    pipeline: "leadership",
    actor: input.actor,
    requestPayload: input.plan.requestPayload,
    sourceNameOverride: "wikidata",
  });
  await safeAppendRunLog(run.id, "info", "Wikidata leadership ingestion run queued.", {
    requested_by: input.actor.email || input.actor.userId,
  });
  startRunTask(run.id, () => executeLeadershipRun(run.id, input.plan));
  return { runId: run.id };
}

export async function listRuns(options: {
  pipeline?: IngestionPipeline;
  limit?: number;
  offset?: number;
}): Promise<AdminIngestionRun[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: any[] = [];
  const where: string[] = [
    `s.name IN ${INGESTION_SOURCE_SQL}`,
  ];
  if (options.pipeline) {
    const pipelineIdx = params.push(options.pipeline);
    where.push(
      `(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'gdelt')
        OR ($${pipelineIdx} = 'news' AND s.name = 'institutional_rss')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'nws')
        OR ($${pipelineIdx} = 'market' AND s.name = 'sec_edgar')
        OR ($${pipelineIdx} = 'market' AND s.name = 'ecb')
        OR ($${pipelineIdx} = 'market' AND s.name = 'oecd')
        OR ($${pipelineIdx} = 'podcasts' AND s.name = 'podcastindex')
        OR ($${pipelineIdx} = 'leadership' AND s.name = 'wikidata'))`
    );
  }
  const limitIdx = params.push(limit);
  const offsetIdx = params.push(offset);

  const { rows } = await query<RunRow>(
    `SELECT
       r.id,
       r.pipeline,
       s.name AS source_name,
       r.status,
       r.started_at,
       r.finished_at,
       r.error,
       r.stats,
       r.trigger_mode,
       r.requested_by_email,
       r.request_payload,
       COALESCE((
         SELECT COUNT(*)::int
         FROM ingestion_run_log l
         WHERE l.run_id = r.id
       ), 0) AS log_count
     FROM ingestion_run r
     JOIN source s ON s.id = r.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.started_at DESC, r.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return rows.map(toAdminRun);
}

export async function getRunDetail(
  runId: number,
  logLimit = 200
): Promise<{ run: AdminIngestionRun; logs: AdminIngestionLog[] } | null> {
  const { rows } = await query<RunRow>(
    `SELECT
       r.id,
       r.pipeline,
       s.name AS source_name,
       r.status,
       r.started_at,
       r.finished_at,
       r.error,
       r.stats,
       r.trigger_mode,
       r.requested_by_email,
       r.request_payload,
       COALESCE((
         SELECT COUNT(*)::int
         FROM ingestion_run_log l
         WHERE l.run_id = r.id
       ), 0) AS log_count
     FROM ingestion_run r
     JOIN source s ON s.id = r.source_id
     WHERE r.id = $1
       AND s.name IN ${INGESTION_SOURCE_SQL}
     LIMIT 1`,
    [runId]
  );
  if (!rows[0]) return null;

  const logs = await getRunLogs(runId, { limit: logLimit });
  return { run: toAdminRun(rows[0]), logs };
}

export async function getRunLogs(
  runId: number,
  options?: { afterId?: number; limit?: number }
): Promise<AdminIngestionLog[]> {
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
  const afterId = Math.max(options?.afterId ?? 0, 0);
  const { rows } = await query<RunLogRow>(
    `SELECT id, run_id, logged_at, level, message, context
     FROM ingestion_run_log
     WHERE run_id = $1
       AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [runId, afterId, limit]
  );
  return rows.map(toAdminLog);
}

export async function getMetrics(options?: {
  days?: number;
  pipeline?: IngestionPipeline;
}): Promise<{ days: number; points: AdminIngestionMetricPoint[]; totals: AdminIngestionMetricTotal[] }> {
  const days = Math.min(Math.max(options?.days ?? 30, 1), 180);
  const params: any[] = [days];
  const where: string[] = [
    "r.started_at >= now() - make_interval(days => $1::int)",
    `s.name IN ${INGESTION_SOURCE_SQL}`,
  ];
  if (options?.pipeline) {
    const pipelineIdx = params.push(options.pipeline);
    where.push(
      `(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'gdelt')
        OR ($${pipelineIdx} = 'news' AND s.name = 'institutional_rss')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'nws')
        OR ($${pipelineIdx} = 'market' AND s.name = 'sec_edgar')
        OR ($${pipelineIdx} = 'market' AND s.name = 'ecb')
        OR ($${pipelineIdx} = 'market' AND s.name = 'oecd')
        OR ($${pipelineIdx} = 'podcasts' AND s.name = 'podcastindex')
        OR ($${pipelineIdx} = 'leadership' AND s.name = 'wikidata'))`
    );
  }

  const { rows } = await query<MetricRunRow>(
    `SELECT
       r.pipeline,
       s.name AS source_name,
       r.status,
       r.started_at,
       r.stats
     FROM ingestion_run r
     JOIN source s ON s.id = r.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.started_at ASC, r.id ASC`,
    params
  );

  const pointsByKey = new Map<string, AdminIngestionMetricPoint>();
  for (const row of rows) {
    const resolvedPipeline = resolvePipeline(row.pipeline, row.source_name);
    const dateKey = timestampToDateKey(row.started_at);
    if (!dateKey) continue;
    const key = `${dateKey}:${resolvedPipeline}`;
    if (!pointsByKey.has(key)) {
      pointsByKey.set(key, {
        date: dateKey,
        pipeline: resolvedPipeline,
        run_count: 0,
        success_count: 0,
        failed_count: 0,
        queued_count: 0,
        running_count: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        http_failures: 0,
        db_errors: 0,
      });
    }
    const point = pointsByKey.get(key)!;
    point.run_count += 1;
    const status = normalizeStatus(row.status);
    if (status === "success") point.success_count += 1;
    if (status === "failed") point.failed_count += 1;
    if (status === "queued") point.queued_count += 1;
    if (status === "running") point.running_count += 1;

    const totals = extractTotals(row.stats);
    mergeTotals(point, totals);
  }

  const points = Array.from(pointsByKey.values()).sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.pipeline.localeCompare(b.pipeline);
  });

  const totalsByPipeline = new Map<IngestionPipeline, AdminIngestionMetricTotal>();
  for (const point of points) {
    if (!totalsByPipeline.has(point.pipeline)) {
      totalsByPipeline.set(point.pipeline, {
        pipeline: point.pipeline,
        run_count: 0,
        success_count: 0,
        failed_count: 0,
        queued_count: 0,
        running_count: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        http_failures: 0,
        db_errors: 0,
      });
    }
    const total = totalsByPipeline.get(point.pipeline)!;
    total.run_count += point.run_count;
    total.success_count += point.success_count;
    total.failed_count += point.failed_count;
    total.queued_count += point.queued_count;
    total.running_count += point.running_count;
    total.inserted += point.inserted;
    total.updated += point.updated;
    total.skipped += point.skipped;
    total.http_failures += point.http_failures;
    total.db_errors += point.db_errors;
  }

  return {
    days,
    points,
    totals: Array.from(totalsByPipeline.values()).sort((a, b) => a.pipeline.localeCompare(b.pipeline)),
  };
}
