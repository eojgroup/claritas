import {
  ingestNewsApiEverything,
  ingestNewsApiTopHeadlines,
  type IngestEverythingParams,
  type IngestTopHeadlinesParams,
} from "./connectors/newsapi";
import { ingestTheNewsApiNews, type IngestTheNewsApiParams } from "./connectors/thenewsapi";
import { ingestOpenWeatherCountryCurrent } from "./connectors/openweather";
import { query } from "./db";

export type IngestionPipeline = "news" | "weather";
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
  newsapi: boolean;
  thenewsapi: boolean;
};

type NewsRunPlan = {
  providers: NewsRunProviders;
  everything: IngestEverythingParams | null;
  topHeadlines: IngestTopHeadlinesParams | null;
  theNewsApi: IngestTheNewsApiParams | null;
  requestPayload: Record<string, unknown>;
};

type WeatherRunPlan = {
  country?: string;
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
  sourceNameOverride?: "newsapi" | "thenewsapi" | "openweather";
};

const SOURCE_CONFIG: Record<"newsapi" | "thenewsapi" | "openweather", { sourceName: string; apiBaseUrl: string; provider: string }> = {
  newsapi: {
    sourceName: "newsapi",
    apiBaseUrl: "https://newsapi.org/v2",
    provider: "newsapi",
  },
  thenewsapi: {
    sourceName: "thenewsapi",
    apiBaseUrl: "https://api.thenewsapi.com/api/v1",
    provider: "thenewsapi",
  },
  openweather: {
    sourceName: "openweather",
    apiBaseUrl: "https://api.openweathermap.org",
    provider: "openweather",
  },
};

const PIPELINE_SOURCE_DEFAULT: Record<IngestionPipeline, "newsapi" | "openweather"> = {
  // For mixed-source news runs we keep NewsAPI as the canonical source row.
  news: "newsapi",
  weather: "openweather",
};

const DEFAULT_NEWS_EVERYTHING: IngestEverythingParams = {
  q: "OpenAI",
  pageSize: 50,
  maxPages: 2,
};

const DEFAULT_NEWS_TOP_HEADLINES: IngestTopHeadlinesParams = {
  country: "us",
  category: "technology",
  pageSize: 50,
  maxPages: 2,
};

const activeRunPromises = new Map<number, Promise<void>>();

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
  if (pipeline === "news" || pipeline === "weather") return pipeline;
  if (sourceName === "newsapi") return "news";
  if (sourceName === "thenewsapi") return "news";
  if (sourceName === "openweather") return "weather";
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
  sourceNameOverride?: "newsapi" | "thenewsapi" | "openweather"
): Promise<SourceRow> {
  const sourceName = sourceNameOverride ?? PIPELINE_SOURCE_DEFAULT[pipeline];
  const cfg = SOURCE_CONFIG[sourceName];
  const { rows } = await query<SourceRow>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider', $3::text))
     ON CONFLICT (name)
     DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url,
       metadata = COALESCE(source.metadata, '{}'::jsonb) || jsonb_build_object('provider', $3::text)
     RETURNING id, name`,
    [cfg.sourceName, cfg.apiBaseUrl, cfg.provider]
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
  const everythingRaw = body.everything;
  const topRaw = body.topHeadlines;
  const theNewsApiRaw = body.theNewsApi;
  const providersRaw = asRecord(body.providers);

  const providers: NewsRunProviders = {
    newsapi: asBoolean(providersRaw.newsapi, true),
    thenewsapi: asBoolean(providersRaw.thenewsapi, true),
  };

  if (!providers.newsapi && !providers.thenewsapi) {
    throw new IngestionValidationError("Select at least one news provider.");
  }
  if (providers.newsapi && !process.env.NEWSAPI_API_KEY) {
    throw new IngestionValidationError("NewsAPI selected but NEWSAPI_API_KEY is not configured.");
  }
  if (providers.thenewsapi && !process.env.THENEWSAPI_API_TOKEN) {
    throw new IngestionValidationError("TheNewsAPI selected but THENEWSAPI_API_TOKEN is not configured.");
  }

  let everything: IngestEverythingParams | null = null;
  if (providers.newsapi && everythingRaw !== false) {
    const cfg = asRecord(everythingRaw);
    const q = asString(cfg.q) || DEFAULT_NEWS_EVERYTHING.q;
    const language = asString(cfg.language);
    everything = {
      q,
      language,
      pageSize: clampInt(cfg.pageSize, 1, 100, DEFAULT_NEWS_EVERYTHING.pageSize ?? 50),
      maxPages: clampInt(cfg.maxPages, 1, 10, DEFAULT_NEWS_EVERYTHING.maxPages ?? 2),
    };
  }

  let topHeadlines: IngestTopHeadlinesParams | null = null;
  if (providers.newsapi && topRaw !== false) {
    const cfg = asRecord(topRaw);
    const country = normalizeIso2(cfg.country, true) || DEFAULT_NEWS_TOP_HEADLINES.country;
    const category = asString(cfg.category) || DEFAULT_NEWS_TOP_HEADLINES.category;
    const q = asString(cfg.q);
    topHeadlines = {
      country,
      category,
      q,
      pageSize: clampInt(cfg.pageSize, 1, 100, DEFAULT_NEWS_TOP_HEADLINES.pageSize ?? 50),
      maxPages: clampInt(cfg.maxPages, 1, 10, DEFAULT_NEWS_TOP_HEADLINES.maxPages ?? 2),
    };
  }

  if (providers.newsapi && !everything && !topHeadlines) {
    throw new IngestionValidationError("Enable at least one NewsAPI step or disable NewsAPI.");
  }

  let theNewsApi: IngestTheNewsApiParams | null = null;
  if (providers.thenewsapi) {
    const cfg = asRecord(theNewsApiRaw);
    const everythingCfg = asRecord(everythingRaw);
    const topCfg = asRecord(topRaw);

    theNewsApi = {
      search:
        asString(cfg.search) ||
        asString(cfg.q) ||
        asString(everythingCfg.q) ||
        asString(topCfg.q) ||
        DEFAULT_NEWS_EVERYTHING.q,
      language: asString(cfg.language) || asString(everythingCfg.language),
      locale:
        normalizeIso2(cfg.locale, true) ||
        normalizeIso2(cfg.country, true) ||
        normalizeIso2(topCfg.country, true) ||
        DEFAULT_NEWS_TOP_HEADLINES.country,
      pageSize: clampInt(cfg.pageSize, 1, 100, DEFAULT_NEWS_EVERYTHING.pageSize ?? 50),
      maxPages: clampInt(cfg.maxPages, 1, 10, DEFAULT_NEWS_EVERYTHING.maxPages ?? 2),
      publishedAfter: asString(cfg.publishedAfter),
    };
  }

  return {
    providers,
    everything,
    topHeadlines,
    theNewsApi,
    requestPayload: {
      providers,
      everything: everything ?? false,
      topHeadlines: topHeadlines ?? false,
      theNewsApi: theNewsApi ?? false,
    },
  };
}

export function buildWeatherRunPlan(rawBody: unknown): WeatherRunPlan {
  const body = asRecord(rawBody);
  const country = normalizeIso2(body.country, true);
  return {
    country: country ? country.toUpperCase() : undefined,
    requestPayload: country ? { country: country.toUpperCase() } : {},
  };
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

    if (!plan.providers.newsapi) {
      await safeAppendRunLog(runId, "info", "Skipping NewsAPI steps (provider not selected).");
    }

    if (plan.providers.newsapi && plan.everything) {
      const stepStartedAt = Date.now();
      await safeAppendRunLog(runId, "info", "Running NewsAPI everything ingest.", {
        params: plan.everything as unknown as Record<string, unknown>,
      });
      try {
        const result = (await ingestNewsApiEverything(plan.everything)) as unknown as Record<string, unknown>;
        const stepTotals = extractTotals(result);
        mergeTotals(totals, stepTotals);
        steps.push({
          step: "newsapi/everything",
          status: "success",
          started_at: new Date(stepStartedAt).toISOString(),
          finished_at: toIsoNow(),
          duration_ms: Date.now() - stepStartedAt,
          result,
        });
        await safeAppendRunLog(runId, "info", "NewsAPI everything ingest completed.", {
          result,
        });
      } catch (err) {
        const message = toErrorMessage(err);
        steps.push({
          step: "newsapi/everything",
          status: "failed",
          started_at: new Date(stepStartedAt).toISOString(),
          finished_at: toIsoNow(),
          duration_ms: Date.now() - stepStartedAt,
          error: message,
        });
        await safeAppendRunLog(runId, "error", "NewsAPI everything ingest failed.", {
          error: message,
        });
        throw err;
      }
    }

    if (plan.providers.newsapi && plan.topHeadlines) {
      const stepStartedAt = Date.now();
      await safeAppendRunLog(runId, "info", "Running NewsAPI top-headlines ingest.", {
        params: plan.topHeadlines as unknown as Record<string, unknown>,
      });
      try {
        const result = (await ingestNewsApiTopHeadlines(plan.topHeadlines)) as unknown as Record<string, unknown>;
        const stepTotals = extractTotals(result);
        mergeTotals(totals, stepTotals);
        steps.push({
          step: "newsapi/top-headlines",
          status: "success",
          started_at: new Date(stepStartedAt).toISOString(),
          finished_at: toIsoNow(),
          duration_ms: Date.now() - stepStartedAt,
          result,
        });
        await safeAppendRunLog(runId, "info", "NewsAPI top-headlines ingest completed.", {
          result,
        });
      } catch (err) {
        const message = toErrorMessage(err);
        steps.push({
          step: "newsapi/top-headlines",
          status: "failed",
          started_at: new Date(stepStartedAt).toISOString(),
          finished_at: toIsoNow(),
          duration_ms: Date.now() - stepStartedAt,
          error: message,
        });
        await safeAppendRunLog(runId, "error", "NewsAPI top-headlines ingest failed.", {
          error: message,
        });
        throw err;
      }
    }

    if (plan.providers.thenewsapi) {
      if (!process.env.THENEWSAPI_API_TOKEN) {
        throw new Error("TheNewsAPI selected but THENEWSAPI_API_TOKEN not set.");
      }
      const stepStartedAt = Date.now();
      const params: IngestTheNewsApiParams = {
        search: plan.theNewsApi?.search || DEFAULT_NEWS_EVERYTHING.q,
        language: plan.theNewsApi?.language,
        locale: plan.theNewsApi?.locale,
        pageSize: Math.min(Math.max(plan.theNewsApi?.pageSize || 50, 1), 100),
        maxPages: Math.min(Math.max(plan.theNewsApi?.maxPages || 2, 1), 10),
        publishedAfter: plan.theNewsApi?.publishedAfter,
      };

      await safeAppendRunLog(runId, "info", "Running TheNewsAPI /news/top ingest.", {
        params: params as unknown as Record<string, unknown>,
      });

      try {
        const result = (await ingestTheNewsApiNews(params)) as unknown as Record<string, unknown>;
        const stepTotals = extractTotals(result);
        mergeTotals(totals, stepTotals);
        steps.push({
          step: "thenewsapi/news-top",
          status: "success",
          started_at: new Date(stepStartedAt).toISOString(),
          finished_at: toIsoNow(),
          duration_ms: Date.now() - stepStartedAt,
          result,
        });
        await safeAppendRunLog(runId, "info", "TheNewsAPI /news/top ingest completed.", {
          result,
        });
      } catch (err) {
        const message = toErrorMessage(err);
        steps.push({
          step: "thenewsapi/news-top",
          status: "failed",
          started_at: new Date(stepStartedAt).toISOString(),
          finished_at: toIsoNow(),
          duration_ms: Date.now() - stepStartedAt,
          error: message,
        });
        await safeAppendRunLog(runId, "error", "TheNewsAPI /news/top ingest failed.", {
          error: message,
        });
        throw err;
      }
    } else {
      await safeAppendRunLog(runId, "info", "Skipping TheNewsAPI step (provider not selected).");
    }

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

    const stepStartedAt = Date.now();
    await safeAppendRunLog(runId, "info", "Running OpenWeather country-current ingest.", {
      params: plan.requestPayload,
    });

    try {
      const result = (await ingestOpenWeatherCountryCurrent(plan.country)) as unknown as Record<string, unknown>;
      const stepTotals = extractTotals(result);
      mergeTotals(totals, stepTotals);
      steps.push({
        step: "openweather/country-current",
        status: "success",
        started_at: new Date(stepStartedAt).toISOString(),
        finished_at: toIsoNow(),
        duration_ms: Date.now() - stepStartedAt,
        result,
      });
      await safeAppendRunLog(runId, "info", "OpenWeather country-current ingest completed.", {
        result,
      });
    } catch (err) {
      const message = toErrorMessage(err);
      steps.push({
        step: "openweather/country-current",
        status: "failed",
        started_at: new Date(stepStartedAt).toISOString(),
        finished_at: toIsoNow(),
        duration_ms: Date.now() - stepStartedAt,
        error: message,
      });
      await safeAppendRunLog(runId, "error", "OpenWeather country-current ingest failed.", {
        error: message,
      });
      throw err;
    }

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

export async function triggerNewsRun(input: {
  actor: TriggerActor;
  plan: NewsRunPlan;
}): Promise<{ runId: number }> {
  const sourceNameOverride =
    input.plan.providers.thenewsapi && !input.plan.providers.newsapi ? "thenewsapi" : "newsapi";
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
    sourceNameOverride: "openweather",
  });
  await safeAppendRunLog(run.id, "info", "Weather ingestion run queued.", {
    requested_by: input.actor.email || input.actor.userId,
  });
  startRunTask(run.id, () => executeWeatherRun(run.id, input.plan));
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
  const where: string[] = ["s.name IN ('newsapi', 'thenewsapi', 'openweather')"];
  if (options.pipeline) {
    const pipelineIdx = params.push(options.pipeline);
    where.push(
      `(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'newsapi')
        OR ($${pipelineIdx} = 'news' AND s.name = 'thenewsapi')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather'))`
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
       AND s.name IN ('newsapi', 'thenewsapi', 'openweather')
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
    "s.name IN ('newsapi', 'thenewsapi', 'openweather')",
  ];
  if (options?.pipeline) {
    const pipelineIdx = params.push(options.pipeline);
    where.push(
      `(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'newsapi')
        OR ($${pipelineIdx} = 'news' AND s.name = 'thenewsapi')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather'))`
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
