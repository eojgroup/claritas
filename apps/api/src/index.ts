import express from "express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { ingestNewsApiEverything, ingestNewsApiTopHeadlines } from "./connectors/newsapi";
import { ingestTheNewsApiNews } from "./connectors/thenewsapi";
import {
  discoverPodcastFeeds,
  ingestPodcastIndex,
  podcastParamsFromEnv,
  type PodcastIngestParams,
} from "./connectors/podcastindex";
import { ingestOpenWeatherCountryCurrent } from "./connectors/openweather";
import {
  getCountryWeatherForecast,
  getCountryWeatherLatest,
  getHistoricalWeather,
  getMarineWeather,
  ingestOpenMeteoCountryWeather,
} from "./connectors/openmeteo";
import { getGdeltEvents, getGdeltSignals, ingestGdelt } from "./connectors/gdelt";
import { getMarketFilings, getMarketIndicators, ingestSecEdgar } from "./connectors/sec-edgar";
import { getLatestFxRates, getLatestPolicyRates, ingestEcbData } from "./connectors/ecb";
import { getCountryMarketDetail, getCountryMarketOverview } from "./connectors/market-overview";
import {
  getCountryLeadershipLatest,
  ingestWikidataLeadership,
} from "./connectors/wikidata-leadership";
import {
  getTransportEntity,
  getTransportOverview,
  startTransportIngestionWorkers,
  type TransportMode,
} from "./connectors/transport";
import {
  getDatabasePoolStats,
  isDatabaseUnavailableError,
  pool,
  query,
  startDatabasePoolMonitoring,
  withTransaction,
} from "./db";
import authRouter, { requireAuth, requirePaidAccess, requireRole } from "./auth";
import {
  IngestionValidationError,
  buildMarketRunPlan,
  buildNewsRunPlan,
  buildLeadershipRunPlan,
  buildPodcastRunPlan,
  buildWeatherRunPlan,
  getMetrics,
  getRunDetail,
  getRunLogs,
  listRuns,
  triggerMarketRun,
  triggerNewsRun,
  triggerLeadershipRun,
  triggerPodcastRun,
  triggerWeatherRun,
  type IngestionPipeline,
} from "./ingestion-admin";
import {
  AutomationValidationError,
  getAutomationOverview,
  parseAutomationRulePatch,
  startIngestionAutomationWorker,
  trackDemandSignal,
  updateAutomationRule,
} from "./ingestion-automation";
import { getBillingPublicUrls } from "./billing";
import {
  BriefingGenerationError,
  generateDailySignalBriefing,
  getDailyBriefingGeneratorConfig,
  type DailyBriefingGenerationOptions,
  type GeneratedBriefingStatus,
} from "./briefing-generator";
import { checkLlmConnectionFromEnv, LlmConfigurationError, LlmProviderError } from "./llm";
import { getEmailRuntimeConfig, sendEmailVerificationEmail } from "./email";
import {
  enqueueDuePersonalBriefingJobs,
  enqueuePersonalBriefingJob,
  getLatestPersonalBriefing,
  getPersonalBriefingJob,
  getPersonalBriefingReferenceOptions,
  processPersonalBriefingJob,
  startPersonalBriefingWorker,
} from "./personal-briefing";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const DAILY_BRIEFING_SCHEDULER_LOCK_NAMESPACE = 9433;
const DAILY_BRIEFING_SCHEDULER_LOCK_KEY = 1;
const DAILY_BRIEFING_SCHEDULER_POLL_SECONDS = parseBoundedIntEnv(
  process.env.DAILY_BRIEFING_SCHEDULER_POLL_SECONDS,
  30,
  3600,
  60
);
const DAILY_BRIEFING_SCHEDULER_BATCH_SIZE = parseBoundedIntEnv(
  process.env.DAILY_BRIEFING_SCHEDULER_BATCH_SIZE,
  1,
  500,
  100
);

app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const poolStats = getDatabasePoolStats();
    res.setHeader("X-Claritas-DB-Pool-Waiting", String(poolStats.waiting));
    return res.status(200).send("ready");
  } catch (error) {
    console.warn("Readiness check failed: database unavailable.");
    return res.status(503).send("not ready");
  }
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
app.use("/api/auth", authRouter);

const requireAdminRole = requireRole("admin");
const requireSession = requireAuth();
const requireAuthenticated = requirePaidAccess();

let dailyBriefingSchedulerTimer: NodeJS.Timeout | null = null;
let dailyBriefingSchedulerRunning = false;

type AdminRoleRow = {
  id: number;
  key: string;
  description: string | null;
  user_count: number;
};

type AdminUserRow = {
  id: number;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  roles: string[] | null;
  providers: string[] | null;
  last_seen_at: string | null;
  subscription_id: number | null;
  subscription_status: string | null;
  subscription_provider: string | null;
  subscription_started_at: string | null;
  subscription_current_period_end: string | null;
  subscription_canceled_at: string | null;
  subscription_plan_code: string | null;
  subscription_plan_name: string | null;
};

type BillingPlanRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval_unit: string;
  is_active: boolean;
  metadata: unknown;
};

type DailySignalBriefingStatus = "draft" | "published" | "archived";

type DailySignalBriefingRow = {
  id: number;
  briefing_date: string | Date;
  title: string;
  update_text: string;
  key_takeaways: unknown;
  status: DailySignalBriefingStatus;
  source_window_start: string | Date | null;
  source_window_end: string | Date | null;
  generated_by: string | null;
  metadata: unknown;
  published_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DailySignalBriefingPayload = {
  title: string;
  update_text: string;
  key_takeaways: string[];
  status: DailySignalBriefingStatus;
  source_window_start: string | null;
  source_window_end: string | null;
  generated_by: string | null;
  metadata: Record<string, unknown>;
  published_at: string | null;
};

type DailyBriefingGenerationJobStatus = "queued" | "running" | "success" | "failed";

type DailyBriefingGenerationJobRow = {
  id: string;
  briefing_date: string | Date;
  status: DailyBriefingGenerationJobStatus;
  options: unknown;
  briefing_id: number | null;
  generation: unknown;
  error: string | null;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  updated_at: string | Date;
};

type DailyBriefingScheduleRow = {
  user_id: number;
  enabled: boolean;
  email_enabled: boolean;
  email_theme: "light" | "dark";
  scheduled_time: string;
  schedule_timezone: string;
  industries: string[];
  company_symbols: string[];
  country_iso2s: string[];
  regions: string[];
  max_items: number;
  last_scheduled_for: string | Date | null;
  last_triggered_at: string | Date | null;
  last_job_id: string | null;
  last_personal_job_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DueDailyBriefingScheduleRow = DailyBriefingScheduleRow & {
  local_schedule_date: string | Date;
};

class AdminApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ADMIN_USER_BASE_SELECT = `
  SELECT
    u.id,
    u.email,
    u.display_name,
    u.avatar_url,
    u.is_active,
    u.created_at,
    u.updated_at,
    COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.key), NULL), '{}') AS roles,
    COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT ai.provider), NULL), '{}') AS providers,
    MAX(s.last_seen_at) AS last_seen_at,
    bs_latest.subscription_id,
    bs_latest.subscription_status,
    bs_latest.subscription_provider,
    bs_latest.subscription_started_at,
    bs_latest.subscription_current_period_end,
    bs_latest.subscription_canceled_at,
    bs_latest.subscription_plan_code,
    bs_latest.subscription_plan_name
  FROM app_user u
  LEFT JOIN auth_user_role ur ON ur.user_id = u.id
  LEFT JOIN auth_role r ON r.id = ur.role_id
  LEFT JOIN auth_identity ai ON ai.user_id = u.id
  LEFT JOIN auth_session s ON s.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT
      bs.id AS subscription_id,
      bs.status AS subscription_status,
      bs.provider AS subscription_provider,
      bs.started_at AS subscription_started_at,
      bs.current_period_end AS subscription_current_period_end,
      bs.canceled_at AS subscription_canceled_at,
      bp.code AS subscription_plan_code,
      bp.name AS subscription_plan_name
    FROM billing_subscription bs
    JOIN billing_plan bp ON bp.id = bs.plan_id
    WHERE bs.user_id = u.id
    ORDER BY
      CASE
        WHEN bs.status IN ('active', 'trialing', 'grace_period') THEN 0
        WHEN bs.status = 'past_due' THEN 1
        ELSE 2
      END,
      COALESCE(bs.current_period_end, 'infinity'::timestamptz) DESC,
      bs.started_at DESC,
      bs.id DESC
    LIMIT 1
  ) bs_latest ON true
`;

function isValidRoleKey(key: string): boolean {
  return /^[a-z][a-z0-9_-]{1,31}$/.test(key);
}

function normalizeRoleKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new AdminApiError(400, "body.roles must be an array of role keys.");
  const keys = raw
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter(Boolean);
  for (const key of keys) {
    if (!isValidRoleKey(key)) throw new AdminApiError(400, `Invalid role key: ${key}`);
  }
  return Array.from(new Set(keys)).sort();
}

function toAdminUser(row: AdminUserRow) {
  const subscription =
    row.subscription_id == null
      ? null
      : {
          id: row.subscription_id,
          status: row.subscription_status,
          provider: row.subscription_provider,
          started_at: row.subscription_started_at,
          current_period_end: row.subscription_current_period_end,
          canceled_at: row.subscription_canceled_at,
          plan: {
            code: row.subscription_plan_code,
            name: row.subscription_plan_name,
          },
        };
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    roles: row.roles || [],
    providers: row.providers || [],
    last_seen_at: row.last_seen_at,
    subscription,
  };
}

async function getAdminUserById(userId: number): Promise<ReturnType<typeof toAdminUser> | null> {
  const { rows } = await query<AdminUserRow>(
    `${ADMIN_USER_BASE_SELECT}
     WHERE u.id = $1
     GROUP BY
       u.id,
       bs_latest.subscription_id,
       bs_latest.subscription_status,
       bs_latest.subscription_provider,
       bs_latest.subscription_started_at,
       bs_latest.subscription_current_period_end,
       bs_latest.subscription_canceled_at,
       bs_latest.subscription_plan_code,
       bs_latest.subscription_plan_name
     LIMIT 1`,
    [userId]
  );
  return rows[0] ? toAdminUser(rows[0]) : null;
}

async function getActiveAdminCountTx(client: import("pg").PoolClient): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(DISTINCT ur.user_id)::int AS count
     FROM auth_user_role ur
     JOIN auth_role r ON r.id = ur.role_id
     JOIN app_user u ON u.id = ur.user_id
     WHERE r.key = 'admin'
       AND u.is_active = true`
  );
  return Number(rows[0]?.count || 0);
}

function parsePipeline(value: unknown): IngestionPipeline | undefined {
  if (
    value === "news" ||
    value === "weather" ||
    value === "market" ||
    value === "podcasts" ||
    value === "leadership"
  ) {
    return value;
  }
  return undefined;
}

function parseBoundedIntEnv(raw: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.trunc(raw)
      : typeof raw === "string" && raw.trim()
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parsePodcastIngestParams(raw: unknown): PodcastIngestParams {
  const body = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
  const feedIds = list(body.feed_ids ?? body.feedIds)
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(0, 50);
  const searchTerms = list(body.queries ?? body.search_terms ?? body.searchTerms)
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean)
    .slice(0, 20);
  const booleanValue = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
    return fallback;
  };
  return podcastParamsFromEnv({
    feedIds,
    searchTerms,
    maxFeeds: parseBoundedIntEnv(body.max_feeds_per_query ?? body.maxFeedsPerQuery ?? body.max_feeds ?? body.maxFeeds, 1, 50, 10),
    maxEpisodesPerFeed: parseBoundedIntEnv(body.max_episodes_per_feed ?? body.maxEpisodesPerFeed, 1, 100, 10),
    fetchTranscripts: booleanValue(body.fetch_transcripts ?? body.fetchTranscripts, true),
    extractIntelligence: booleanValue(body.process_intelligence ?? body.processIntelligence ?? body.extract_intelligence ?? body.extractIntelligence, true),
  });
}

function podcastErrorStatus(message: string): number {
  return message.includes("PODCASTINDEX_") || message.startsWith("Provide") ? 400 : 502;
}

function timestampToApiString(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? null : value.toISOString();
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return value;
}

function dateToApiString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function timeToApiString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const match = value.trim().match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value.trim();
}

function parseBriefingDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminApiError(400, "briefing_date is required.");
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new AdminApiError(400, "briefing_date must use YYYY-MM-DD.");
  }
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== trimmed) {
    throw new AdminApiError(400, "briefing_date must be a valid date.");
  }
  return trimmed;
}

function parseBriefingStatus(value: unknown): DailySignalBriefingStatus {
  if (value == null || value === "") return "draft";
  if (typeof value !== "string") throw new AdminApiError(400, "status must be draft, published, or archived.");
  const normalized = value.trim().toLowerCase();
  if (normalized === "draft" || normalized === "published" || normalized === "archived") return normalized;
  throw new AdminApiError(400, "status must be draft, published, or archived.");
}

function parseGeneratedBriefingStatus(value: unknown): GeneratedBriefingStatus {
  const status = parseBriefingStatus(value);
  if (status === "archived") {
    throw new AdminApiError(400, "Generated briefings can only be draft or published.");
  }
  return status;
}

function sanitizeBriefingPayload(raw: unknown): DailySignalBriefingPayload {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const titleRaw = typeof body.title === "string" ? body.title.trim() : "";
  const updateRaw =
    typeof body.update_text === "string"
      ? body.update_text.trim()
      : typeof body.update === "string"
        ? body.update.trim()
        : "";
  const rawTakeaways = Array.isArray(body.key_takeaways)
    ? body.key_takeaways
    : Array.isArray(body.takeaways)
      ? body.takeaways
      : [];
  const keyTakeaways = rawTakeaways
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  return {
    title: titleRaw || "Daily signal brief",
    update_text: updateRaw,
    key_takeaways: keyTakeaways,
    status: parseBriefingStatus(body.status),
    source_window_start: parseOptionalIsoDateTime(body.source_window_start, "source_window_start") ?? null,
    source_window_end: parseOptionalIsoDateTime(body.source_window_end, "source_window_end") ?? null,
    generated_by: typeof body.generated_by === "string" && body.generated_by.trim() ? body.generated_by.trim() : null,
    metadata,
    published_at: parseOptionalIsoDateTime(body.published_at, "published_at") ?? null,
  };
}

function toDailySignalBriefing(row: DailySignalBriefingRow) {
  return {
    id: Number(row.id),
    briefing_date: dateToApiString(row.briefing_date),
    title: row.title,
    update_text: row.update_text,
    key_takeaways: Array.isArray(row.key_takeaways) ? row.key_takeaways : [],
    status: row.status,
    source_window_start: timestampToApiString(row.source_window_start),
    source_window_end: timestampToApiString(row.source_window_end),
    generated_by: row.generated_by,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    published_at: timestampToApiString(row.published_at),
    created_at: timestampToApiString(row.created_at) || new Date().toISOString(),
    updated_at: timestampToApiString(row.updated_at) || new Date().toISOString(),
  };
}

async function upsertDailySignalBriefing(
  briefingDate: string,
  payload: DailySignalBriefingPayload
) {
  const { rows } = await query<DailySignalBriefingRow>(
    `INSERT INTO daily_signal_briefing (
       briefing_date,
       title,
       update_text,
       key_takeaways,
       status,
       source_window_start,
       source_window_end,
       generated_by,
       metadata,
       published_at
     )
     VALUES (
       $1::date,
       $2,
       $3,
       $4::jsonb,
       $5,
       $6,
       $7,
       $8,
       $9::jsonb,
       CASE WHEN $5 = 'published' THEN COALESCE($10::timestamptz, now()) ELSE $10::timestamptz END
     )
     ON CONFLICT (briefing_date)
     DO UPDATE SET
       title = EXCLUDED.title,
       update_text = EXCLUDED.update_text,
       key_takeaways = EXCLUDED.key_takeaways,
       status = EXCLUDED.status,
       source_window_start = EXCLUDED.source_window_start,
       source_window_end = EXCLUDED.source_window_end,
       generated_by = EXCLUDED.generated_by,
       metadata = EXCLUDED.metadata,
       published_at = CASE
         WHEN EXCLUDED.status = 'published'
           THEN COALESCE(EXCLUDED.published_at, daily_signal_briefing.published_at, now())
         ELSE EXCLUDED.published_at
       END,
       updated_at = now()
     RETURNING
       id,
       briefing_date,
       title,
       update_text,
       key_takeaways,
       status,
       source_window_start,
       source_window_end,
       generated_by,
       metadata,
       published_at,
       created_at,
       updated_at`,
    [
      briefingDate,
      payload.title,
      payload.update_text,
      JSON.stringify(payload.key_takeaways),
      payload.status,
      payload.source_window_start,
      payload.source_window_end,
      payload.generated_by,
      JSON.stringify(payload.metadata),
      payload.published_at,
    ]
  );
  if (!rows[0]) throw new AdminApiError(500, "Failed to upsert daily briefing.");
  return toDailySignalBriefing(rows[0]);
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function getDailySignalBriefingById(id: number) {
  const { rows } = await query<DailySignalBriefingRow>(
    `SELECT
       id,
       briefing_date,
       title,
       update_text,
       key_takeaways,
       status,
       source_window_start,
       source_window_end,
       generated_by,
       metadata,
       published_at,
       created_at,
       updated_at
     FROM daily_signal_briefing
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ? toDailySignalBriefing(rows[0]) : null;
}

function toDailyBriefingGenerationJob(
  row: DailyBriefingGenerationJobRow,
  briefing: ReturnType<typeof toDailySignalBriefing> | null = null
) {
  return {
    id: row.id,
    briefing_date: dateToApiString(row.briefing_date),
    status: row.status,
    options: asPlainObject(row.options),
    briefing_id: row.briefing_id == null ? null : Number(row.briefing_id),
    briefing,
    generation: row.generation && typeof row.generation === "object" ? row.generation : null,
    error: row.error,
    created_at: timestampToApiString(row.created_at) || new Date().toISOString(),
    started_at: timestampToApiString(row.started_at),
    finished_at: timestampToApiString(row.finished_at),
    updated_at: timestampToApiString(row.updated_at) || new Date().toISOString(),
  };
}

function optionsFromGenerationJob(row: DailyBriefingGenerationJobRow): DailyBriefingGenerationOptions {
  const options = asPlainObject(row.options);
  const status = options.status === "draft" ? "draft" : "published";
  const optionalNumber = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
  };
  return {
    briefingDate: dateToApiString(row.briefing_date),
    status,
    instructions: typeof options.instructions === "string" ? options.instructions : null,
    lookbackHours: optionalNumber(options.lookbackHours),
    maxNewsItems: optionalNumber(options.maxNewsItems),
    maxPodcastItems: optionalNumber(options.maxPodcastItems),
    maxMarketItems: optionalNumber(options.maxMarketItems),
    maxWeatherItems: optionalNumber(options.maxWeatherItems),
  };
}

function describeGenerationError(error: unknown): string {
  if (
    error instanceof AdminApiError ||
    error instanceof BriefingGenerationError ||
    error instanceof LlmConfigurationError ||
    error instanceof LlmProviderError
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function createDailyBriefingGenerationJob(
  briefingDate: string,
  options: DailyBriefingGenerationOptions
) {
  const id = randomUUID();
  const { rows } = await query<DailyBriefingGenerationJobRow>(
    `INSERT INTO daily_signal_briefing_generation_job (
       id,
       briefing_date,
       status,
       options
     )
     VALUES ($1, $2::date, 'queued', $3::jsonb)
     RETURNING
       id,
       briefing_date,
       status,
       options,
       briefing_id,
       generation,
       error,
       created_at,
       started_at,
       finished_at,
       updated_at`,
    [id, briefingDate, JSON.stringify(options)]
  );
  if (!rows[0]) throw new AdminApiError(500, "Failed to queue daily briefing generation.");
  return toDailyBriefingGenerationJob(rows[0]);
}

async function getDailyBriefingGenerationJob(jobId: string) {
  const { rows } = await query<DailyBriefingGenerationJobRow>(
    `SELECT
       id,
       briefing_date,
       status,
       options,
       briefing_id,
       generation,
       error,
       created_at,
       started_at,
       finished_at,
       updated_at
     FROM daily_signal_briefing_generation_job
     WHERE id = $1
     LIMIT 1`,
    [jobId]
  );
  if (!rows[0]) return null;
  const briefing = rows[0].briefing_id == null ? null : await getDailySignalBriefingById(Number(rows[0].briefing_id));
  return toDailyBriefingGenerationJob(rows[0], briefing);
}

async function runDailyBriefingGenerationJob(jobId: string): Promise<void> {
  const { rows } = await query<DailyBriefingGenerationJobRow>(
    `UPDATE daily_signal_briefing_generation_job
     SET status = 'running',
         started_at = COALESCE(started_at, now()),
         updated_at = now()
     WHERE id = $1
       AND status = 'queued'
     RETURNING
       id,
       briefing_date,
       status,
       options,
       briefing_id,
       generation,
       error,
       created_at,
       started_at,
       finished_at,
       updated_at`,
    [jobId]
  );
  const job = rows[0];
  if (!job) return;

  try {
    const options = optionsFromGenerationJob(job);
    const generated = await generateDailySignalBriefing(options);
    const briefing = await upsertDailySignalBriefing(options.briefingDate, generated.payload);
    await query(
      `UPDATE daily_signal_briefing_generation_job
       SET status = 'success',
           briefing_id = $2,
           generation = $3::jsonb,
           error = NULL,
           finished_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [jobId, briefing.id, JSON.stringify(generated.generation)]
    );
  } catch (error) {
    const message = describeGenerationError(error);
    console.error(`[daily-briefing-generation] job ${jobId} failed: ${message}`);
    await query(
      `UPDATE daily_signal_briefing_generation_job
       SET status = 'failed',
           error = $2,
           finished_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [jobId, message]
    );
  }
}

function startDailyBriefingGenerationJob(jobId: string): void {
  void runDailyBriefingGenerationJob(jobId).catch((error) => {
    console.error(`[daily-briefing-generation] job ${jobId} crashed:`, error);
  });
}

function normalizeBriefingScheduleTime(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminApiError(400, "scheduled_time must use HH:mm.");
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) {
    throw new AdminApiError(400, "scheduled_time must use HH:mm.");
  }
  return `${match[1]}:${match[2]}`;
}

function normalizeBriefingScheduleTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminApiError(400, "timezone is required.");
  }
  const timezone = value.trim();
  if (timezone.length > 64) {
    throw new AdminApiError(400, "timezone is too long.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new AdminApiError(400, "timezone must be a valid IANA timezone.");
  }
  return timezone;
}

function normalizeBriefingSelectionList(
  value: unknown,
  fieldName: string,
  options: {
    maxItems: number;
    maxLength: number;
    uppercase?: boolean;
    pattern?: RegExp;
  }
): string[] {
  if (!Array.isArray(value)) {
    throw new AdminApiError(400, `${fieldName} must be an array of strings.`);
  }
  if (value.length > options.maxItems) {
    throw new AdminApiError(400, `${fieldName} supports at most ${options.maxItems} selections.`);
  }
  const values = value.map((entry) => {
    if (typeof entry !== "string") {
      throw new AdminApiError(400, `${fieldName} must contain only strings.`);
    }
    const trimmed = entry.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > options.maxLength) {
      throw new AdminApiError(
        400,
        `${fieldName} values must be between 1 and ${options.maxLength} characters.`
      );
    }
    const normalized = options.uppercase ? trimmed.toUpperCase() : trimmed;
    if (options.pattern && !options.pattern.test(normalized)) {
      throw new AdminApiError(400, `${fieldName} contains an invalid value: ${trimmed}.`);
    }
    return normalized;
  });
  return Array.from(new Set(values));
}

function parseBriefingSchedulePatch(raw: unknown): {
  enabled?: boolean;
  email_enabled?: boolean;
  email_theme?: "light" | "dark";
  scheduled_time?: string;
  schedule_timezone?: string;
  industries?: string[];
  company_symbols?: string[];
  country_iso2s?: string[];
  regions?: string[];
  max_items?: number;
} {
  const body = asPlainObject(raw);
  const patch: {
    enabled?: boolean;
    email_enabled?: boolean;
    email_theme?: "light" | "dark";
    scheduled_time?: string;
    schedule_timezone?: string;
    industries?: string[];
    company_symbols?: string[];
    country_iso2s?: string[];
    regions?: string[];
    max_items?: number;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    if (typeof body.enabled !== "boolean") {
      throw new AdminApiError(400, "enabled must be a boolean.");
    }
    patch.enabled = body.enabled;
  }

  if (Object.prototype.hasOwnProperty.call(body, "email_enabled")) {
    if (typeof body.email_enabled !== "boolean") {
      throw new AdminApiError(400, "email_enabled must be a boolean.");
    }
    patch.email_enabled = body.email_enabled;
  }

  if (Object.prototype.hasOwnProperty.call(body, "email_theme")) {
    if (body.email_theme !== "light" && body.email_theme !== "dark") {
      throw new AdminApiError(400, "email_theme must be light or dark.");
    }
    patch.email_theme = body.email_theme;
  }

  const scheduledTime = body.scheduled_time ?? body.schedule_time;
  if (typeof scheduledTime !== "undefined") {
    patch.scheduled_time = normalizeBriefingScheduleTime(scheduledTime);
  }

  const timezone = body.schedule_timezone ?? body.timezone;
  if (typeof timezone !== "undefined") {
    patch.schedule_timezone = normalizeBriefingScheduleTimezone(timezone);
  }

  if (Object.prototype.hasOwnProperty.call(body, "industries")) {
    patch.industries = normalizeBriefingSelectionList(body.industries, "industries", {
      maxItems: 20,
      maxLength: 80,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "company_symbols")) {
    patch.company_symbols = normalizeBriefingSelectionList(
      body.company_symbols,
      "company_symbols",
      {
        maxItems: 50,
        maxLength: 16,
        uppercase: true,
        pattern: /^[A-Z0-9][A-Z0-9._-]*$/,
      }
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "country_iso2s")) {
    patch.country_iso2s = normalizeBriefingSelectionList(body.country_iso2s, "country_iso2s", {
      maxItems: 50,
      maxLength: 2,
      uppercase: true,
      pattern: /^[A-Z]{2}$/,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "regions")) {
    patch.regions = normalizeBriefingSelectionList(body.regions, "regions", {
      maxItems: 20,
      maxLength: 80,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "max_items")) {
    if (
      typeof body.max_items !== "number" ||
      !Number.isInteger(body.max_items) ||
      body.max_items < 3 ||
      body.max_items > 25
    ) {
      throw new AdminApiError(400, "max_items must be an integer between 3 and 25.");
    }
    patch.max_items = body.max_items;
  }

  return patch;
}

function toDailyBriefingSchedule(row: DailyBriefingScheduleRow) {
  return {
    user_id: Number(row.user_id),
    enabled: !!row.enabled,
    email_enabled: !!row.email_enabled,
    email_theme: row.email_theme === "light" ? "light" : "dark",
    scheduled_time: timeToApiString(row.scheduled_time),
    timezone: row.schedule_timezone,
    industries: Array.isArray(row.industries) ? row.industries : [],
    company_symbols: Array.isArray(row.company_symbols) ? row.company_symbols : [],
    country_iso2s: Array.isArray(row.country_iso2s) ? row.country_iso2s : [],
    regions: Array.isArray(row.regions) ? row.regions : [],
    max_items: Number(row.max_items) || 10,
    last_scheduled_for: row.last_scheduled_for ? dateToApiString(row.last_scheduled_for) : null,
    last_triggered_at: timestampToApiString(row.last_triggered_at),
    last_job_id: row.last_job_id,
    last_personal_job_id: row.last_personal_job_id,
    created_at: timestampToApiString(row.created_at) || new Date().toISOString(),
    updated_at: timestampToApiString(row.updated_at) || new Date().toISOString(),
  };
}

async function ensureUserDailyBriefingSchedule(userId: number): Promise<void> {
  await query(
    `INSERT INTO user_daily_briefing_schedule (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getUserDailyBriefingSchedule(userId: number) {
  await ensureUserDailyBriefingSchedule(userId);
  const { rows } = await query<DailyBriefingScheduleRow>(
    `SELECT
       user_id,
       enabled,
       email_enabled,
       email_theme,
       scheduled_time::text AS scheduled_time,
       schedule_timezone,
       industries,
       company_symbols,
       country_iso2s,
       regions,
       max_items,
       last_scheduled_for,
       last_triggered_at,
       last_job_id,
       last_personal_job_id,
       created_at,
       updated_at
     FROM user_daily_briefing_schedule
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw new AdminApiError(500, "Failed to load daily briefing schedule.");
  return toDailyBriefingSchedule(rows[0]);
}

async function updateUserDailyBriefingSchedule(
  userId: number,
  patch: ReturnType<typeof parseBriefingSchedulePatch>
) {
  await ensureUserDailyBriefingSchedule(userId);
  const { rows } = await query<DailyBriefingScheduleRow>(
    `UPDATE user_daily_briefing_schedule
     SET enabled = COALESCE($2, enabled),
         scheduled_time = COALESCE($3::time, scheduled_time),
         schedule_timezone = COALESCE($4, schedule_timezone),
         email_enabled = COALESCE($5, email_enabled),
         industries = COALESCE($6::text[], industries),
         company_symbols = COALESCE($7::text[], company_symbols),
         country_iso2s = COALESCE($8::text[], country_iso2s),
         regions = COALESCE($9::text[], regions),
         max_items = COALESCE($10::int, max_items),
         email_theme = COALESCE($11, email_theme),
         updated_at = now()
     WHERE user_id = $1
     RETURNING
       user_id,
       enabled,
       email_enabled,
       email_theme,
       scheduled_time::text AS scheduled_time,
       schedule_timezone,
       industries,
       company_symbols,
       country_iso2s,
       regions,
       max_items,
       last_scheduled_for,
       last_triggered_at,
       last_job_id,
       last_personal_job_id,
       created_at,
       updated_at`,
    [
      userId,
      typeof patch.enabled === "boolean" ? patch.enabled : null,
      patch.scheduled_time ?? null,
      patch.schedule_timezone ?? null,
      typeof patch.email_enabled === "boolean" ? patch.email_enabled : null,
      patch.industries ?? null,
      patch.company_symbols ?? null,
      patch.country_iso2s ?? null,
      patch.regions ?? null,
      patch.max_items ?? null,
      patch.email_theme ?? null,
    ]
  );
  if (!rows[0]) throw new AdminApiError(500, "Failed to update daily briefing schedule.");
  return toDailyBriefingSchedule(rows[0]);
}

function getUtcBriefingDateForSchedule(localScheduleDate: string): string {
  const utcToday = new Date().toISOString().slice(0, 10);
  return localScheduleDate > utcToday ? utcToday : localScheduleDate;
}

async function getDueDailyBriefingSchedules(): Promise<DueDailyBriefingScheduleRow[]> {
  const { rows } = await query<DueDailyBriefingScheduleRow>(
    `SELECT
       user_id,
       enabled,
       scheduled_time::text AS scheduled_time,
       schedule_timezone,
       last_scheduled_for,
       last_triggered_at,
       last_job_id,
       timezone(schedule_timezone, now())::date AS local_schedule_date
     FROM user_daily_briefing_schedule
     WHERE enabled = true
       AND timezone(schedule_timezone, now())::time >= scheduled_time
       AND (
         last_scheduled_for IS NULL
         OR last_scheduled_for < timezone(schedule_timezone, now())::date
       )
     ORDER BY schedule_timezone ASC, scheduled_time ASC, user_id ASC
     LIMIT $1`,
    [DAILY_BRIEFING_SCHEDULER_BATCH_SIZE]
  );
  return rows;
}

async function getActiveDailyBriefingGenerationJob(
  briefingDate: string
): Promise<DailyBriefingGenerationJobRow | null> {
  const { rows } = await query<DailyBriefingGenerationJobRow>(
    `SELECT id, briefing_date, status, options, briefing_id, generation, error,
            created_at, started_at, finished_at, updated_at
     FROM daily_signal_briefing_generation_job
     WHERE briefing_date = $1::date
       AND status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [briefingDate]
  );
  return rows[0] ?? null;
}

async function ensurePublishedDailyBriefingGenerationJob(briefingDate: string): Promise<string | null> {
  const published = await query<{ id: number }>(
    `SELECT id FROM daily_signal_briefing
     WHERE briefing_date = $1::date AND status = 'published'
     LIMIT 1`,
    [briefingDate]
  );
  if (published.rows[0]) return null;

  const activeJob = await getActiveDailyBriefingGenerationJob(briefingDate);
  if (activeJob) {
    if (activeJob.status === "queued") startDailyBriefingGenerationJob(activeJob.id);
    return activeJob.id;
  }

  const job = await createDailyBriefingGenerationJob(briefingDate, {
    briefingDate,
    status: "published",
    lookbackHours: 24,
  });
  startDailyBriefingGenerationJob(job.id);
  return job.id;
}

async function markDailyBriefingSchedulesTriggered(
  userIds: number[],
  localScheduleDate: string,
  jobId: string | null
): Promise<void> {
  if (userIds.length === 0) return;
  await query(
    `UPDATE user_daily_briefing_schedule
     SET last_scheduled_for = $2::date,
         last_triggered_at = now(),
         last_job_id = COALESCE($3, last_job_id),
         updated_at = now()
     WHERE user_id = ANY($1::bigint[])`,
    [userIds, localScheduleDate, jobId]
  );
}

async function withDailyBriefingSchedulerLock(task: () => Promise<void>): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS locked`,
      [DAILY_BRIEFING_SCHEDULER_LOCK_NAMESPACE, DAILY_BRIEFING_SCHEDULER_LOCK_KEY]
    );
    if (!rows[0]?.locked) return;
    await task();
  });
}

async function runDailyBriefingSchedulerCycle(): Promise<void> {
  if (dailyBriefingSchedulerRunning) return;
  dailyBriefingSchedulerRunning = true;

  try {
    await withDailyBriefingSchedulerLock(async () => {
      const dueSchedules = await getDueDailyBriefingSchedules();
      const scheduleGroups = new Map<string, {
        localScheduleDate: string;
        briefingDate: string;
        userIds: number[];
      }>();

      for (const row of dueSchedules) {
        const localScheduleDate = dateToApiString(row.local_schedule_date);
        const briefingDate = getUtcBriefingDateForSchedule(localScheduleDate);
        const key = `${localScheduleDate}:${briefingDate}`;
        const group = scheduleGroups.get(key) ?? { localScheduleDate, briefingDate, userIds: [] };
        group.userIds.push(Number(row.user_id));
        scheduleGroups.set(key, group);
      }

      for (const group of scheduleGroups.values()) {
        const jobId = await ensurePublishedDailyBriefingGenerationJob(group.briefingDate);
        await markDailyBriefingSchedulesTriggered(group.userIds, group.localScheduleDate, jobId);
      }

      await enqueueDuePersonalBriefingJobs(DAILY_BRIEFING_SCHEDULER_BATCH_SIZE);
    });
  } finally {
    dailyBriefingSchedulerRunning = false;
  }
}

function parseDailyBriefingSchedulerEnabled(): boolean {
  const raw = (process.env.DAILY_BRIEFING_SCHEDULER_ENABLED || "true").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(raw);
}

function startDailyBriefingSchedulerWorker(): void {
  if (!parseDailyBriefingSchedulerEnabled()) {
    console.log("Daily briefing scheduler disabled via DAILY_BRIEFING_SCHEDULER_ENABLED.");
    return;
  }
  if (dailyBriefingSchedulerTimer) return;

  console.log(`Daily briefing scheduler started (interval=${DAILY_BRIEFING_SCHEDULER_POLL_SECONDS}s).`);
  dailyBriefingSchedulerTimer = setInterval(() => {
    void runDailyBriefingSchedulerCycle().catch((error) => {
      console.error("Daily briefing scheduler cycle failed:", error);
    });
  }, DAILY_BRIEFING_SCHEDULER_POLL_SECONDS * 1000);

  setTimeout(() => {
    void runDailyBriefingSchedulerCycle().catch((error) => {
      console.error("Daily briefing scheduler initial cycle failed:", error);
    });
  }, 5_000);
}

function parseBillingStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "trialing" ||
    normalized === "active" ||
    normalized === "past_due" ||
    normalized === "grace_period" ||
    normalized === "canceled" ||
    normalized === "unpaid" ||
    normalized === "incomplete"
  ) {
    return normalized;
  }
  return undefined;
}

function parseOptionalIsoDateTime(value: unknown, fieldName: string): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AdminApiError(400, `${fieldName} must be an ISO date-time string or null.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new AdminApiError(400, `${fieldName} must be a valid date-time.`);
  }
  return new Date(parsed).toISOString();
}

function parseOptionalPositiveInt(value: unknown, fieldName: string, max: number): number | undefined {
  if (typeof value === "undefined" || value === null || value === "") return undefined;
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AdminApiError(400, `${fieldName} must be a positive integer.`);
  }
  return Math.min(parsed, max);
}

function parseBriefingGenerationOptions(
  briefingDate: string,
  raw: unknown
): DailyBriefingGenerationOptions {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const status =
    typeof body.publish === "boolean"
      ? body.publish
        ? "published"
        : "draft"
      : typeof body.status === "undefined"
        ? "published"
        : parseGeneratedBriefingStatus(body.status);
  const instructions =
    typeof body.instructions === "string"
      ? body.instructions.trim().slice(0, 2000)
      : typeof body.prompt === "string"
        ? body.prompt.trim().slice(0, 2000)
        : null;

  return {
    briefingDate,
    status,
    instructions,
    lookbackHours: parseOptionalPositiveInt(body.lookback_hours ?? body.lookbackHours, "lookback_hours", 168),
    maxNewsItems: parseOptionalPositiveInt(body.max_news_items ?? body.maxNewsItems, "max_news_items", 80),
    maxPodcastItems: parseOptionalPositiveInt(body.max_podcast_items ?? body.maxPodcastItems, "max_podcast_items", 40),
    maxMarketItems: parseOptionalPositiveInt(body.max_market_items ?? body.maxMarketItems, "max_market_items", 60),
    maxWeatherItems: parseOptionalPositiveInt(body.max_weather_items ?? body.maxWeatherItems, "max_weather_items", 80),
    maxLeadershipItems: parseOptionalPositiveInt(
      body.max_leadership_items ?? body.maxLeadershipItems,
      "max_leadership_items",
      250
    ),
  };
}

function sanitizeAutomationPayload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new AdminApiError(400, "default_payload must be an object.");
}

function getRequestActor(res: express.Response): { userId: number | null; email: string | null; triggerMode: string } {
  const locals = res.locals as {
    auth?: {
      user?: {
        id?: number;
        email?: string | null;
      };
    };
  };
  return {
    userId: typeof locals.auth?.user?.id === "number" ? locals.auth.user.id : null,
    email: typeof locals.auth?.user?.email === "string" ? locals.auth.user.email : null,
    triggerMode: "admin_ui",
  };
}

function getAuthenticatedUserId(res: express.Response): number {
  const locals = res.locals as {
    auth?: {
      user?: {
        id?: number;
      };
    };
  };
  const userId = locals.auth?.user?.id;
  if (typeof userId !== "number") throw new AdminApiError(401, "unauthorized");
  return userId;
}

function requireIngestionAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sharedToken = process.env.INGEST_API_TOKEN;
  if (sharedToken) {
    const supplied = req.get("x-ingest-token");
    if (supplied && supplied === sharedToken) return next();
  }
  return requireAdminRole(req, res, next);
}

// Simple endpoint to test DB connectivity
app.get("/api/db/ping", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT 1 as ok");
    res.json(rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/billing/me", requireSession, async (_req, res) => {
  try {
    const locals = res.locals as {
      auth?: {
        user?: {
          billing?: unknown;
        };
      };
    };
    const billing = locals.auth?.user?.billing ?? null;
    const urls = getBillingPublicUrls();
    return res.json({
      billing: billing || {
        paywall_enabled: false,
        has_access: true,
        reason: "paywall_disabled",
        checkout_url: urls.checkout_url,
        portal_url: urls.portal_url,
        subscription: null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

const handleGetDailyBriefingSchedule: express.RequestHandler = async (_req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    const schedule = await getUserDailyBriefingSchedule(userId);
    return res.json({ schedule });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
};

const handleUpdateDailyBriefingSchedule: express.RequestHandler = async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    const patch = parseBriefingSchedulePatch(req.body);
    const schedule = await updateUserDailyBriefingSchedule(userId, patch);
    return res.json({ schedule });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
};

app.get("/api/briefings/daily/schedule", requireSession, handleGetDailyBriefingSchedule);
app.put("/api/briefings/daily/schedule", requireSession, handleUpdateDailyBriefingSchedule);
app.get("/api/me/briefings/daily/schedule", requireSession, handleGetDailyBriefingSchedule);
app.put("/api/me/briefings/daily/schedule", requireSession, handleUpdateDailyBriefingSchedule);
app.get("/api/auth/me/briefings/daily/schedule", requireSession, handleGetDailyBriefingSchedule);
app.put("/api/auth/me/briefings/daily/schedule", requireSession, handleUpdateDailyBriefingSchedule);

app.get("/api/briefings/daily/preferences/options", requireSession, async (_req, res) => {
  try {
    const options = await getPersonalBriefingReferenceOptions();
    return res.json({ options });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/briefings/daily/email/status", requireSession, async (_req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    const { rows } = await query<{ email: string | null; email_verified: boolean }>(
      `SELECT email, email_verified FROM app_user WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const emailConfig = getEmailRuntimeConfig();
    return res.json({
      email: {
        configured: emailConfig.configured,
        from: emailConfig.from,
        recipient: rows[0]?.email ?? null,
        recipient_verified: !!rows[0]?.email_verified,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

function validEmail(value: string | null): value is string {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function verificationRedirect(verified: boolean): string {
  const base = getEmailRuntimeConfig().public_base_url;
  return `${base || ""}/?email_verification=${verified ? "success" : "invalid"}`;
}

app.post("/api/email-verifications", requireSession, async (_req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    const { rows } = await query<{ email: string | null; email_verified: boolean; last_requested_at: string | Date | null }>(
      `SELECT u.email, u.email_verified, MAX(t.created_at) AS last_requested_at
       FROM app_user u LEFT JOIN email_verification_token t ON t.user_id = u.id
       WHERE u.id = $1 GROUP BY u.id`, [userId]
    );
    const user = rows[0];
    if (!user || !validEmail(user.email)) return res.status(400).json({ error: "Your account has no valid email address." });
    if (user.email_verified) return res.json({ ok: true, already_verified: true });
    if (user.last_requested_at && Date.now() - new Date(user.last_requested_at).getTime() < 60_000) {
      return res.status(429).json({ error: "Please wait one minute before requesting another verification email." });
    }
    const emailConfig = getEmailRuntimeConfig();
    if (!emailConfig.configured) return res.status(503).json({ error: "SMTP is not configured." });
    if (!emailConfig.public_base_url) return res.status(503).json({ error: "EMAIL_PUBLIC_BASE_URL is not configured." });
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await query(`UPDATE email_verification_token SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [userId]);
    await query(`INSERT INTO email_verification_token (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`, [userId, user.email, tokenHash]);
    await sendEmailVerificationEmail(user.email, `${emailConfig.public_base_url}/api/email-verifications/confirm?token=${encodeURIComponent(token)}`);
    return res.status(202).json({ ok: true });
  } catch (e: any) { return res.status(500).json({ error: e.message || String(e) }); }
});

app.get("/api/email-verifications/confirm", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) return res.redirect(303, verificationRedirect(false));
  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query<{ user_id: number; email: string }>(
        `UPDATE email_verification_token SET consumed_at = now()
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         RETURNING user_id, email`, [tokenHash]
      );
      const verification = rows[0];
      if (!verification) return false;
      const result = await client.query(`UPDATE app_user SET email_verified = true WHERE id = $1 AND email = $2`, [verification.user_id, verification.email]);
      return result.rowCount === 1;
    });
    return res.redirect(303, verificationRedirect(updated));
  } catch { return res.redirect(303, verificationRedirect(false)); }
});

app.get("/api/briefings/daily/personal/latest", requireSession, async (_req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    const briefing = await getLatestPersonalBriefing(userId);
    return res.json({ briefing });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/briefings/daily/personal/preview", requireAuthenticated, async (_req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    await ensureUserDailyBriefingSchedule(userId);
    const { rows } = await query<{ briefing_date: string | Date }>(
      `SELECT timezone(schedule_timezone, now())::date AS briefing_date
       FROM user_daily_briefing_schedule
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    const briefingDate = dateToApiString(rows[0]?.briefing_date ?? new Date());
    const job = await enqueuePersonalBriefingJob(userId, briefingDate, {
      deliveryRequested: true,
      force: true,
    });
    void processPersonalBriefingJob(job.id).catch((error) => {
      console.error(`Personal briefing preview job ${job.id} failed to start:`, error);
    });
    return res.status(202).json({ job });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/briefings/daily/personal/jobs/:id", requireSession, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(res);
    const job = await getPersonalBriefingJob(userId, req.params.id);
    if (!job) return res.status(404).json({ error: "Personal briefing job not found." });
    return res.json({ job });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/briefings/daily/latest", requireAuthenticated, async (_req, res) => {
  try {
    const { rows } = await query<DailySignalBriefingRow>(
      `SELECT
         id,
         briefing_date,
         title,
         update_text,
         key_takeaways,
         status,
         source_window_start,
         source_window_end,
         generated_by,
         metadata,
         published_at,
         created_at,
         updated_at
       FROM daily_signal_briefing
       WHERE status = 'published'
       ORDER BY briefing_date DESC, updated_at DESC
       LIMIT 1`
    );
    return res.json({ briefing: rows[0] ? toDailySignalBriefing(rows[0]) : null });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/briefings/daily", requireAdminRole, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 100);
    const { rows } = await query<DailySignalBriefingRow>(
      `SELECT
         id,
         briefing_date,
         title,
         update_text,
         key_takeaways,
         status,
         source_window_start,
         source_window_end,
         generated_by,
         metadata,
         published_at,
         created_at,
         updated_at
       FROM daily_signal_briefing
       ORDER BY briefing_date DESC, updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.json({ briefings: rows.map(toDailySignalBriefing) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/briefings/daily/generation/config", requireAdminRole, async (_req, res) => {
  try {
    return res.json({ generator: getDailyBriefingGeneratorConfig() });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/briefings/daily/generation/test", requireAdminRole, async (_req, res) => {
  try {
    const connection = await checkLlmConnectionFromEnv();
    return res.json({ connection });
  } catch (e: any) {
    if (e instanceof LlmConfigurationError) return res.status(503).json({ error: e.message });
    if (e instanceof LlmProviderError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/briefings/daily/generation/jobs/:jobId", requireAdminRole, async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) throw new AdminApiError(400, "jobId is required.");
    const job = await getDailyBriefingGenerationJob(jobId);
    if (!job) return res.status(404).json({ error: "Daily briefing generation job not found." });
    if (job.status === "queued") startDailyBriefingGenerationJob(job.id);
    return res.json({ job });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/briefings/daily/:date/generate", requireAdminRole, async (req, res) => {
  try {
    const briefingDate = parseBriefingDate(req.params.date);
    const options = parseBriefingGenerationOptions(briefingDate, req.body);
    const job = await createDailyBriefingGenerationJob(briefingDate, options);
    startDailyBriefingGenerationJob(job.id);
    res.setHeader("Location", `/api/admin/briefings/daily/generation/jobs/${encodeURIComponent(job.id)}`);
    return res.status(202).json({ job });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    if (e instanceof BriefingGenerationError) return res.status(e.status).json({ error: e.message });
    if (e instanceof LlmConfigurationError) return res.status(503).json({ error: e.message });
    if (e instanceof LlmProviderError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.put("/api/admin/briefings/daily/:date", requireAdminRole, async (req, res) => {
  try {
    const briefingDate = parseBriefingDate(req.params.date);
    const payload = sanitizeBriefingPayload(req.body);
    const briefing = await upsertDailySignalBriefing(briefingDate, payload);
    return res.json({ briefing });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/ingest/briefings/daily/:date/generate", requireIngestionAccess, async (req, res) => {
  try {
    const briefingDate = parseBriefingDate(req.params.date);
    const generated = await generateDailySignalBriefing(parseBriefingGenerationOptions(briefingDate, req.body));
    const briefing = await upsertDailySignalBriefing(briefingDate, generated.payload);
    return res.json({ briefing, generation: generated.generation });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    if (e instanceof BriefingGenerationError) return res.status(e.status).json({ error: e.message });
    if (e instanceof LlmConfigurationError) return res.status(503).json({ error: e.message });
    if (e instanceof LlmProviderError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.put("/api/ingest/briefings/daily/:date", requireIngestionAccess, async (req, res) => {
  try {
    const briefingDate = parseBriefingDate(req.params.date);
    const payload = sanitizeBriefingPayload(req.body);
    const briefing = await upsertDailySignalBriefing(briefingDate, payload);
    return res.json({ briefing });
  } catch (e: any) {
    if (e instanceof AdminApiError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// List recent news items with optional filters
app.get("/api/news", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";
    const language = typeof req.query.language === "string" ? req.query.language.trim().toLowerCase() : "";
    const sourceCountry = typeof req.query.source_country === "string" ? req.query.source_country.trim().toUpperCase() : "";
    const provider = typeof req.query.provider === "string" ? req.query.provider.trim().toLowerCase() : "";

    const params: any[] = [];
    const where: string[] = ["i.kind = 'news_article'"];
    if (q) {
      const i1 = params.push(`%${q}%`); // returns new length as index
      const i2 = params.push(`%${q}%`);
      where.push(`(i.title ILIKE $${i1} OR i.summary ILIKE $${i2})`);
    }
    if (country) {
      const ci = params.push(country);
      where.push(`upper(i.country_iso2) = $${ci}`);
    }
    if (language) {
      const li = params.push(language);
      where.push(`lower(i.language_code) = $${li}`);
    }
    if (sourceCountry) {
      const sci = params.push(sourceCountry);
      where.push(`upper(i.source_country_iso2) = $${sci}`);
    }
    if (provider) {
      const pi = params.push(provider);
      where.push(`lower(s.name) = $${pi}`);
    }
    const li = params.push(limit);
    const oi = params.push(offset);

    const sql = `
      SELECT i.id, i.kind, i.title, i.summary, i.url, i.country_iso2,
             i.language_code, i.source_country_iso2, i.tone,
             i.event_time, i.payload, s.name AS source_name,
             COALESCE(NULLIF(i.payload->>'source', ''), NULLIF(i.payload->>'domain', ''), s.name) AS publisher
      FROM item i
      JOIN source s ON s.id = i.source_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY i.event_time DESC NULLS LAST, i.id DESC
      LIMIT $${li} OFFSET $${oi}
    `;
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Available languages, source countries and providers for global-news discovery.
app.get("/api/news/coverage", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const { rows } = await query(
      `SELECT COALESCE(i.language_code, 'unknown') AS language,
              i.source_country_iso2 AS source_country, s.name AS provider,
              COUNT(*)::int AS article_count,
              MAX(COALESCE(i.event_time, i.created_at)) AS latest_at
       FROM item i JOIN source s ON s.id = i.source_id
       WHERE i.kind = 'news_article'
         AND COALESCE(i.event_time, i.created_at) >= now() - ($1 || ' days')::interval
       GROUP BY COALESCE(i.language_code, 'unknown'), i.source_country_iso2, s.name
       ORDER BY article_count DESC`,
      [days]
    );
    return res.json({ coverage: rows, window_days: days });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/news/events", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const events = await getGdeltEvents({
      country: typeof req.query.country === "string" ? req.query.country : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    return res.json({ events, count: events.length, attribution: "GDELT Project" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/news/signals", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const signals = await getGdeltSignals({
      country: typeof req.query.country === "string" ? req.query.country : undefined,
      theme: typeof req.query.theme === "string" ? req.query.theme : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    return res.json({ signals, count: signals.length, attribution: "GDELT Project" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Podcast episodes are intelligence sources. Audio remains external; Claritas returns evidence and outbound links.
app.get("/api/podcasts", requireAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 300) : "";
    const signalType = typeof req.query.signal_type === "string" ? req.query.signal_type.trim().toLowerCase() : "";
    if (signalType && !["entity", "topic", "claim", "event", "risk"].includes(signalType)) {
      return res.status(400).json({ error: "signal_type must be entity, topic, claim, event, or risk." });
    }
    trackDemandSignal("podcasts");
    const { rows } = await query(
      `SELECT
         i.id, pe.id AS episode_id, pe.podcast_index_id, i.kind, i.title, i.summary,
         i.url, i.event_time, i.payload, pf.id AS feed_id,
         pf.podcast_index_id AS podcast_index_feed_id, pf.title AS feed_title,
         pf.author AS feed_author, pf.image_url AS feed_image_url, pf.site_url AS feed_site_url,
         pe.duration_seconds, pe.image_url, pe.transcript_status,
         CASE
           WHEN jsonb_typeof(pe.external_links) = 'array' THEN pe.external_links
           ELSE '[]'::jsonb
         END AS external_links,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', sr.id, 'type', sr.signal_type, 'title', sr.title, 'summary', sr.summary,
             'entities', sr.entities, 'topics', sr.topics, 'risk_level', sr.risk_level,
             'confidence', sr.confidence,
             'countries', CASE
               WHEN jsonb_typeof(sr.metadata->'countries') = 'array' THEN sr.metadata->'countries'
               ELSE '[]'::jsonb
             END
           ) ORDER BY sr.id)
           FROM (
             SELECT s.* FROM intelligence_signal s
             WHERE s.episode_id = pe.id AND ($4::text = '' OR s.signal_type = $4::text)
             ORDER BY CASE s.signal_type WHEN 'risk' THEN 0 WHEN 'event' THEN 1 WHEN 'claim' THEN 2 ELSE 3 END, s.id
             LIMIT 12
           ) sr
         ), '[]'::jsonb) AS signals,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', er.id, 'segment_index', er.segment_index, 'start_ms', er.start_ms,
             'end_ms', er.end_ms, 'speaker', er.speaker, 'text', er.text,
             'timing_method', er.timing_method, 'source_url', er.source_url
           ) ORDER BY er.segment_index)
           FROM (
             SELECT es.* FROM evidence_segment es
             WHERE es.episode_id = pe.id
               AND ($3::text = '' OR es.search_vector @@ websearch_to_tsquery('simple', $3::text))
             ORDER BY es.segment_index LIMIT 6
           ) er
         ), '[]'::jsonb) AS evidence
       FROM podcast_episode pe
       JOIN item i ON i.id = pe.item_id
       JOIN podcast_feed pf ON pf.id = pe.feed_id
       WHERE ($3::text = '' OR i.title ILIKE '%' || $3::text || '%' OR
              i.summary ILIKE '%' || $3::text || '%' OR pf.title ILIKE '%' || $3::text || '%' OR
              EXISTS (SELECT 1 FROM evidence_segment es WHERE es.episode_id = pe.id AND es.search_vector @@ websearch_to_tsquery('simple', $3::text)) OR
              EXISTS (SELECT 1 FROM intelligence_signal s WHERE s.episode_id = pe.id AND (s.title ILIKE '%' || $3::text || '%' OR s.summary ILIKE '%' || $3::text || '%')))
         AND ($4::text = '' OR EXISTS (SELECT 1 FROM intelligence_signal s WHERE s.episode_id = pe.id AND s.signal_type = $4::text))
       ORDER BY COALESCE(i.event_time, i.created_at) DESC, i.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, q, signalType]
    );
    return res.json({ items: rows, limit, offset, query: q || null });
  } catch (error) {
    console.error("Failed to list podcast intelligence:", error);
    return res.status(500).json({ error: "Failed to list podcast intelligence." });
  }
});

app.get("/api/podcasts/:itemId/evidence", requireAuthenticated, async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) return res.status(400).json({ error: "Invalid podcast item id." });
    const { rows } = await query(
      `SELECT es.id, es.segment_index, es.start_ms, es.end_ms, es.speaker, es.text,
              es.source_url, es.mime_type, es.timing_method,
              COALESCE(jsonb_agg(jsonb_build_object(
                'id', s.id, 'type', s.signal_type, 'title', s.title,
                'risk_level', s.risk_level, 'confidence', s.confidence
              )) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS signals
       FROM podcast_episode pe
       JOIN evidence_segment es ON es.episode_id = pe.id
       LEFT JOIN intelligence_signal_evidence se ON se.evidence_segment_id = es.id
       LEFT JOIN intelligence_signal s ON s.id = se.signal_id
       WHERE pe.item_id = $1
       GROUP BY es.id
       ORDER BY es.segment_index`,
      [itemId]
    );
    return res.json({ item_id: itemId, evidence: rows });
  } catch (error) {
    console.error("Failed to load podcast evidence:", error);
    return res.status(500).json({ error: "Failed to load podcast evidence." });
  }
});

app.get("/api/intelligence/entities/:name/evidence", requireAuthenticated, async (req, res) => {
  try {
    const name = req.params.name.trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: "Entity name is required." });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const { rows } = await query(
      `SELECT i.id AS item_id, i.title AS episode_title, i.event_time,
              pf.title AS feed_title, pe.external_links,
              s.id AS signal_id, s.signal_type, s.title AS signal_title, s.summary,
              s.entities, s.topics, s.risk_level, s.confidence,
              es.id AS evidence_id, es.start_ms, es.end_ms, es.speaker, es.text, es.source_url
       FROM intelligence_signal s
       JOIN podcast_episode pe ON pe.id = s.episode_id
       JOIN podcast_feed pf ON pf.id = pe.feed_id
       JOIN item i ON i.id = pe.item_id
       LEFT JOIN intelligence_signal_evidence se ON se.signal_id = s.id
       LEFT JOIN evidence_segment es ON es.id = se.evidence_segment_id
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.entities) entity WHERE lower(entity) = lower($1))
          OR lower(s.title) = lower($1)
       ORDER BY COALESCE(i.event_time, i.created_at) DESC, es.start_ms ASC NULLS LAST
       LIMIT $2`,
      [name, limit]
    );
    return res.json({ entity: name, evidence: rows });
  } catch (error) {
    console.error("Failed to load entity podcast evidence:", error);
    return res.status(500).json({ error: "Failed to load entity evidence." });
  }
});

app.get("/api/podcasts/discover", requireAdminRole, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    if (!q) return res.status(400).json({ error: "q is required." });
    const feeds = await discoverPodcastFeeds(q, Math.min(Math.max(Number(req.query.limit) || 20, 1), 50));
    return res.json({ feeds, query: q });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(podcastErrorStatus(message)).json({ error: message });
  }
});

app.post("/api/ingest/podcastindex/episodes", requireIngestionAccess, async (req, res) => {
  try {
    return res.json(await ingestPodcastIndex(parsePodcastIngestParams(req.body)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(podcastErrorStatus(message)).json({ error: message });
  }
});

app.post("/api/admin/ingestion/podcasts/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildPodcastRunPlan(req.body);
    const { runId } = await triggerPodcastRun({ actor: getRequestActor(res), plan });
    const detail = await getRunDetail(runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(error instanceof IngestionValidationError ? 400 : 500).json({ error: message });
  }
});

app.post("/api/admin/ingestion/leadership/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildLeadershipRunPlan(req.body);
    const { runId } = await triggerLeadershipRun({ actor: getRequestActor(res), plan });
    const detail = await getRunDetail(runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(error instanceof IngestionValidationError ? 400 : 500).json({ error: message });
  }
});

// Aggregate counts by country (for map bubbles)
app.get("/api/news/country-stats", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
    const params: any[] = [days];
    const [statsResult, coverageResult] = await Promise.all([
      pool.query(
        `SELECT upper(country_iso2) AS country, COUNT(*)::int AS count
         FROM item
         WHERE country_iso2 IS NOT NULL
           AND kind = 'news_article'
           AND COALESCE(event_time, created_at) >= now() - ($1 || ' days')::interval
         GROUP BY upper(country_iso2)
         ORDER BY count DESC`,
        params
      ),
      pool.query<{ total: number; mapped: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE country_iso2 IS NOT NULL)::int AS mapped
         FROM item
         WHERE kind = 'news_article'
           AND COALESCE(event_time, created_at) >= now() - ($1 || ' days')::interval`,
        params
      ),
    ]);
    const total = Number(coverageResult.rows[0]?.total ?? 0);
    const mapped = Number(coverageResult.rows[0]?.mapped ?? 0);
    res.json({
      stats: statsResult.rows,
      coverage: {
        window_days: days,
        total,
        mapped,
        unmapped: Math.max(0, total - mapped),
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Admin user/role management
app.get("/api/admin/roles", requireAdminRole, async (_req, res) => {
  try {
    const { rows } = await query<AdminRoleRow>(
      `SELECT
         r.id,
         r.key,
         r.description,
         COUNT(ur.user_id)::int AS user_count
       FROM auth_role r
       LEFT JOIN auth_user_role ur ON ur.role_id = r.id
       GROUP BY r.id
       ORDER BY r.key ASC`
    );
    return res.json({ roles: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/roles", requireAdminRole, async (req, res) => {
  try {
    const keyRaw = typeof req.body?.key === "string" ? req.body.key.trim().toLowerCase() : "";
    const descriptionRaw = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!keyRaw) return res.status(400).json({ error: "body.key is required." });
    if (!isValidRoleKey(keyRaw)) {
      return res.status(400).json({ error: "Invalid role key format. Use lowercase letters, numbers, '-' or '_'." });
    }
    const { rows } = await query<{ id: number; key: string; description: string | null }>(
      `INSERT INTO auth_role (key, description)
       VALUES ($1, $2)
       RETURNING id, key, description`,
      [keyRaw, descriptionRaw || null]
    );
    return res.status(201).json({ role: rows[0] });
  } catch (e: any) {
    if (e?.code === "23505") {
      return res.status(409).json({ error: "Role already exists." });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/users", requireAdminRole, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 250);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const role = typeof req.query.role === "string" ? req.query.role.trim().toLowerCase() : "";
    const includeInactive = String(req.query.includeInactive || "false").toLowerCase() === "true";
    if (role && !isValidRoleKey(role)) {
      return res.status(400).json({ error: "Invalid role filter." });
    }

    const params: any[] = [];
    const where: string[] = [];
    if (!includeInactive) {
      where.push("u.is_active = true");
    }
    if (q) {
      const qi = params.push(`%${q}%`);
      where.push(`(u.email ILIKE $${qi} OR u.display_name ILIKE $${qi})`);
    }
    if (role) {
      const ri = params.push(role);
      where.push(
        `EXISTS (
          SELECT 1
          FROM auth_user_role ur2
          JOIN auth_role r2 ON r2.id = ur2.role_id
          WHERE ur2.user_id = u.id
            AND r2.key = $${ri}
        )`
      );
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limitIdx = params.push(limit);
    const offsetIdx = params.push(offset);

    const { rows } = await query<AdminUserRow>(
      `${ADMIN_USER_BASE_SELECT}
       ${whereClause}
       GROUP BY
         u.id,
         bs_latest.subscription_id,
         bs_latest.subscription_status,
         bs_latest.subscription_provider,
         bs_latest.subscription_started_at,
         bs_latest.subscription_current_period_end,
         bs_latest.subscription_canceled_at,
         bs_latest.subscription_plan_code,
         bs_latest.subscription_plan_name
       ORDER BY COALESCE(MAX(s.last_seen_at), u.created_at) DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`
      ,
      params
    );

    const { rows: countRows } = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM app_user u
       ${whereClause}`,
      params.slice(0, params.length - 2)
    );
    const users = rows.map(toAdminUser);
    const total = Number(countRows[0]?.total || 0);
    return res.json({ users, total, limit, offset });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.patch("/api/admin/users/:userId/roles", requireAdminRole, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: "Invalid user id." });
    }
    const nextRoleKeys = normalizeRoleKeys(req.body?.roles);

    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query<{ id: number; is_active: boolean }>(
        `SELECT id, is_active FROM app_user WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw new AdminApiError(404, "User not found.");

      const { rows: currentRoleRows } = await client.query<{ key: string }>(
        `SELECT r.key
         FROM auth_user_role ur
         JOIN auth_role r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [userId]
      );
      const currentRoles = new Set(currentRoleRows.map((row) => row.key));
      const removingAdmin = user.is_active && currentRoles.has("admin") && !nextRoleKeys.includes("admin");
      if (removingAdmin) {
        const adminCount = await getActiveAdminCountTx(client);
        if (adminCount <= 1) {
          throw new AdminApiError(400, "Cannot remove the last active admin.");
        }
      }

      let roleIds: number[] = [];
      if (nextRoleKeys.length > 0) {
        const { rows: roleRows } = await client.query<{ id: number; key: string }>(
          `SELECT id, key
           FROM auth_role
           WHERE key = ANY($1::text[])`,
          [nextRoleKeys]
        );
        if (roleRows.length !== nextRoleKeys.length) {
          const found = new Set(roleRows.map((row) => row.key));
          const missing = nextRoleKeys.filter((key) => !found.has(key));
          throw new AdminApiError(400, `Unknown role keys: ${missing.join(", ")}`);
        }
        roleIds = roleRows.map((row) => row.id);
      }

      await client.query(`DELETE FROM auth_user_role WHERE user_id = $1`, [userId]);
      if (roleIds.length > 0) {
        const params: any[] = [userId, ...roleIds];
        const values = roleIds.map((_, idx) => `($1, $${idx + 2})`).join(", ");
        await client.query(
          `INSERT INTO auth_user_role (user_id, role_id)
           VALUES ${values}
           ON CONFLICT DO NOTHING`,
          params
        );
      }
    });

    const user = await getAdminUserById(userId);
    return res.json({ user });
  } catch (e: any) {
    if (e instanceof AdminApiError) {
      return res.status(e.status).json({ error: e.message });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.patch("/api/admin/users/:userId/status", requireAdminRole, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: "Invalid user id." });
    }
    if (typeof req.body?.is_active !== "boolean") {
      return res.status(400).json({ error: "body.is_active (boolean) is required." });
    }
    const nextIsActive = req.body.is_active as boolean;

    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query<{ id: number; is_active: boolean; is_admin: boolean }>(
        `SELECT
           u.id,
           u.is_active,
           EXISTS (
             SELECT 1
             FROM auth_user_role ur
             JOIN auth_role r ON r.id = ur.role_id
             WHERE ur.user_id = u.id
               AND r.key = 'admin'
           ) AS is_admin
         FROM app_user u
         WHERE u.id = $1
         LIMIT 1`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw new AdminApiError(404, "User not found.");
      if (user.is_active === nextIsActive) return;

      if (user.is_admin && user.is_active && !nextIsActive) {
        const adminCount = await getActiveAdminCountTx(client);
        if (adminCount <= 1) {
          throw new AdminApiError(400, "Cannot deactivate the last active admin.");
        }
      }

      await client.query(`UPDATE app_user SET is_active = $2 WHERE id = $1`, [userId, nextIsActive]);
      if (!nextIsActive) {
        await client.query(
          `UPDATE auth_session
           SET revoked_at = now()
           WHERE user_id = $1
             AND revoked_at IS NULL`,
          [userId]
        );
      }
    });

    const user = await getAdminUserById(userId);
    return res.json({ user });
  } catch (e: any) {
    if (e instanceof AdminApiError) {
      return res.status(e.status).json({ error: e.message });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/billing/plans", requireAdminRole, async (_req, res) => {
  try {
    const { rows } = await query<BillingPlanRow>(
      `SELECT
         id,
         code,
         name,
         description,
         price_cents,
         currency,
         interval_unit,
         is_active,
         metadata
       FROM billing_plan
       ORDER BY price_cents ASC, code ASC`
    );
    return res.json({ plans: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/billing/plans", requireAdminRole, async (req, res) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toLowerCase() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const intervalUnitRaw =
      typeof req.body?.interval_unit === "string" ? req.body.interval_unit.trim().toLowerCase() : "month";
    const currencyRaw = typeof req.body?.currency === "string" ? req.body.currency.trim().toUpperCase() : "USD";
    const priceCentsRaw = req.body?.price_cents;
    const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : true;
    const metadata = req.body?.metadata;

    if (!code || !/^[a-z][a-z0-9_-]{1,63}$/.test(code)) {
      return res.status(400).json({ error: "code must match ^[a-z][a-z0-9_-]{1,63}$." });
    }
    if (!name) {
      return res.status(400).json({ error: "name is required." });
    }
    if (!/^[A-Z]{3}$/.test(currencyRaw)) {
      return res.status(400).json({ error: "currency must be a 3-letter ISO code." });
    }
    if (intervalUnitRaw !== "month" && intervalUnitRaw !== "year" && intervalUnitRaw !== "one_time") {
      return res.status(400).json({ error: "interval_unit must be one of: month, year, one_time." });
    }
    const priceCents =
      typeof priceCentsRaw === "number" && Number.isFinite(priceCentsRaw)
        ? Math.trunc(priceCentsRaw)
        : typeof priceCentsRaw === "string" && priceCentsRaw.trim()
          ? Number.parseInt(priceCentsRaw, 10)
          : 0;
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      return res.status(400).json({ error: "price_cents must be a non-negative integer." });
    }
    if (typeof metadata !== "undefined" && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      return res.status(400).json({ error: "metadata must be an object when provided." });
    }

    const { rows } = await query<BillingPlanRow>(
      `INSERT INTO billing_plan (
         code,
         name,
         description,
         price_cents,
         currency,
         interval_unit,
         is_active,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         id,
         code,
         name,
         description,
         price_cents,
         currency,
         interval_unit,
         is_active,
         metadata`,
      [
        code,
        name,
        description || null,
        priceCents,
        currencyRaw,
        intervalUnitRaw,
        isActive,
        JSON.stringify((metadata as Record<string, unknown>) || {}),
      ]
    );

    return res.status(201).json({ plan: rows[0] });
  } catch (e: any) {
    if (e?.code === "23505") {
      return res.status(409).json({ error: "Billing plan code already exists." });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.put("/api/admin/users/:userId/subscription", requireAdminRole, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const planCode = typeof req.body?.plan_code === "string" ? req.body.plan_code.trim().toLowerCase() : "";
    if (!planCode) {
      return res.status(400).json({ error: "plan_code is required." });
    }
    const status = parseBillingStatus(req.body?.status);
    if (!status) {
      return res.status(400).json({
        error:
          "status is required and must be one of: trialing, active, past_due, grace_period, canceled, unpaid, incomplete.",
      });
    }

    const provider = typeof req.body?.provider === "string" ? req.body.provider.trim() : "manual";
    const startedAt = parseOptionalIsoDateTime(req.body?.started_at, "started_at");
    const currentPeriodEnd = parseOptionalIsoDateTime(req.body?.current_period_end, "current_period_end");
    const canceledAtRaw = parseOptionalIsoDateTime(req.body?.canceled_at, "canceled_at");
    const canceledAt =
      typeof canceledAtRaw !== "undefined" ? canceledAtRaw : status === "canceled" ? new Date().toISOString() : null;
    const providerCustomerId =
      typeof req.body?.provider_customer_id === "string" ? req.body.provider_customer_id.trim() || null : null;
    const providerSubscriptionId =
      typeof req.body?.provider_subscription_id === "string" ? req.body.provider_subscription_id.trim() || null : null;
    const metadata = req.body?.metadata;
    if (typeof metadata !== "undefined" && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      return res.status(400).json({ error: "metadata must be an object when provided." });
    }

    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query<{ id: number }>(
        `SELECT id FROM app_user WHERE id = $1 LIMIT 1`,
        [userId]
      );
      if (!userRows[0]) throw new AdminApiError(404, "User not found.");

      const { rows: planRows } = await client.query<{ id: number }>(
        `SELECT id FROM billing_plan WHERE code = $1 LIMIT 1`,
        [planCode]
      );
      const planId = planRows[0]?.id;
      if (!planId) {
        throw new AdminApiError(400, `Unknown billing plan code: ${planCode}`);
      }

      // Close any currently-accessible subscription before writing the new state.
      // This keeps billing access deterministic when admins change a user to non-active statuses.
      await client.query(
        `UPDATE billing_subscription
         SET status = 'canceled',
             canceled_at = COALESCE(canceled_at, now()),
             updated_at = now()
         WHERE user_id = $1
           AND status IN ('trialing', 'active', 'grace_period')
           AND canceled_at IS NULL`,
        [userId]
      );

      await client.query(
        `INSERT INTO billing_subscription (
           user_id,
           plan_id,
           status,
           provider,
           provider_customer_id,
           provider_subscription_id,
           started_at,
           current_period_end,
           canceled_at,
           metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         )`,
        [
          userId,
          planId,
          status,
          provider || "manual",
          providerCustomerId,
          providerSubscriptionId,
          startedAt || new Date().toISOString(),
          currentPeriodEnd ?? null,
          canceledAt ?? null,
          JSON.stringify((metadata as Record<string, unknown>) || {}),
        ]
      );
    });

    const user = await getAdminUserById(userId);
    return res.json({ user });
  } catch (e: any) {
    if (e instanceof AdminApiError) {
      return res.status(e.status).json({ error: e.message });
    }
    if (e?.code === "23505") {
      return res.status(409).json({ error: "Only one active or trial subscription is allowed per user." });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/ingestion/automation", requireAdminRole, async (_req, res) => {
  try {
    const overview = await getAutomationOverview();
    return res.json(overview);
  } catch (e: any) {
    if (isDatabaseUnavailableError(e)) {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ error: "Data service is reconnecting. Retry shortly." });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.patch("/api/admin/ingestion/automation/:pipeline", requireAdminRole, async (req, res) => {
  try {
    const pipeline = parsePipeline(req.params.pipeline?.trim().toLowerCase());
    if (!pipeline) {
      return res.status(400).json({
        error: "Invalid pipeline. Expected one of: news, weather, market, podcasts, leadership.",
      });
    }

    const patchInput: Record<string, unknown> = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(patchInput, "default_payload")) {
      patchInput.default_payload = sanitizeAutomationPayload(patchInput.default_payload);
    }
    const patch = parseAutomationRulePatch(patchInput);
    const rule = await updateAutomationRule(pipeline, patch);
    return res.json({ rule });
  } catch (e: any) {
    if (e instanceof AutomationValidationError || e instanceof IngestionValidationError || e instanceof AdminApiError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// Admin ingestion orchestration (run + logs + metrics)
app.post("/api/admin/ingestion/news/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildNewsRunPlan(req.body || {});
    const run = await triggerNewsRun({
      actor: getRequestActor(res),
      plan,
    });
    const detail = await getRunDetail(run.runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (e: any) {
    if (e instanceof IngestionValidationError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/ingestion/weather/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildWeatherRunPlan(req.body || {});
    const run = await triggerWeatherRun({
      actor: getRequestActor(res),
      plan,
    });
    const detail = await getRunDetail(run.runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (e: any) {
    if (e instanceof IngestionValidationError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/ingestion/market/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildMarketRunPlan(req.body || {});
    const run = await triggerMarketRun({
      actor: getRequestActor(res),
      plan,
    });
    const detail = await getRunDetail(run.runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (e: any) {
    if (e instanceof IngestionValidationError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/ingestion/runs", requireAdminRole, async (req, res) => {
  try {
    const pipelineRaw = typeof req.query.pipeline === "string" ? req.query.pipeline.trim().toLowerCase() : undefined;
    const pipeline = parsePipeline(pipelineRaw);
    if (pipelineRaw && !pipeline) {
      return res.status(400).json({
        error: "Invalid pipeline. Expected one of: news, weather, market, podcasts, leadership.",
      });
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const runs = await listRuns({ pipeline, limit, offset });
    return res.json({ runs });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/ingestion/runs/:runId", requireAdminRole, async (req, res) => {
  try {
    const runId = parseInt(req.params.runId, 10);
    if (!Number.isFinite(runId) || runId <= 0) {
      return res.status(400).json({ error: "Invalid run id." });
    }
    const logLimit = Math.min(Math.max(parseInt(String(req.query.logLimit || "200"), 10) || 200, 1), 1000);
    const detail = await getRunDetail(runId, logLimit);
    if (!detail) return res.status(404).json({ error: "Run not found." });
    return res.json(detail);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/ingestion/runs/:runId/logs", requireAdminRole, async (req, res) => {
  try {
    const runId = parseInt(req.params.runId, 10);
    if (!Number.isFinite(runId) || runId <= 0) {
      return res.status(400).json({ error: "Invalid run id." });
    }
    const afterId = Math.max(parseInt(String(req.query.afterId || "0"), 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "200"), 10) || 200, 1), 1000);
    const logs = await getRunLogs(runId, { afterId, limit });
    return res.json({ logs });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/ingestion/metrics", requireAdminRole, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 180);
    const pipelineRaw = typeof req.query.pipeline === "string" ? req.query.pipeline.trim().toLowerCase() : undefined;
    const pipeline = parsePipeline(pipelineRaw);
    if (pipelineRaw && !pipeline) {
      return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather, market, podcasts." });
    }
    const metrics = await getMetrics({ days, pipeline });
    return res.json({
      ...metrics,
      database_pool: getDatabasePoolStats(),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// Ingest NewsAPI 'everything'
app.post("/api/ingest/newsapi/everything", requireIngestionAccess, async (req, res) => {
  try {
    const { q, language, pageSize, maxPages } = req.body || {};
    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Missing body.q (string)" });
    }
    const result = await ingestNewsApiEverything({ q, language, pageSize, maxPages });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/ingest/podcastindex", requireIngestionAccess, async (req, res) => {
  try {
    return res.json(await ingestPodcastIndex(parsePodcastIngestParams(req.body)));
  } catch (e: any) {
    const message = e.message || String(e);
    return res.status(podcastErrorStatus(message)).json({ error: message });
  }
});

app.post("/api/ingest/wikidata/leadership", requireIngestionAccess, async (_req, res) => {
  try {
    return res.json(await ingestWikidataLeadership());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(502).json({ error: message });
  }
});

// Ingest NewsAPI 'top-headlines'
app.post("/api/ingest/newsapi/top-headlines", requireIngestionAccess, async (req, res) => {
  try {
    const { country, category, q, pageSize, maxPages } = req.body || {};
    const result = await ingestNewsApiTopHeadlines({ country, category, q, pageSize, maxPages });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Ingest TheNewsAPI '/news/top'
app.post("/api/ingest/thenewsapi/news", requireIngestionAccess, async (req, res) => {
  try {
    const { q, search, language, locale, pageSize, maxPages, publishedAfter } = req.body || {};
    const result = await ingestTheNewsApiNews({
      search: typeof search === "string" && search.trim() ? search : (typeof q === "string" ? q : undefined),
      language,
      locale,
      pageSize,
      maxPages,
      publishedAfter,
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GDELT DOC + latest Event/GKG archives. All three feeds are keyless.
app.post("/api/ingest/gdelt", requireIngestionAccess, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await ingestGdelt({
      query: typeof body.query === "string" ? body.query : undefined,
      maxRecords: Number.isFinite(Number(body.maxRecords)) ? Number(body.maxRecords) : undefined,
      timespan: typeof body.timespan === "string" ? body.timespan : undefined,
      includeDoc: body.includeDoc !== false,
      includeEvents: body.includeEvents !== false,
      includeGkg: body.includeGkg !== false,
    });
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Ingest OpenWeather current weather for countries (centroid-based)
app.post("/api/ingest/openweather/country-current", requireIngestionAccess, async (req, res) => {
  try {
    const { country } = req.body || {};
    const result = await ingestOpenWeatherCountryCurrent(typeof country === 'string' ? country : undefined);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Open-Meteo current conditions, hourly/daily forecasts and air quality.
app.post("/api/ingest/openmeteo/country-weather", requireIngestionAccess, async (req, res) => {
  try {
    const country = typeof req.body?.country === "string" ? req.body.country : undefined;
    return res.json(await ingestOpenMeteoCountryWeather(country));
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/ingest/sec-edgar", requireIngestionAccess, async (req, res) => {
  try {
    const symbols = Array.isArray(req.body?.symbols)
      ? req.body.symbols.filter((value: unknown): value is string => typeof value === "string")
      : typeof req.body?.symbols === "string" ? req.body.symbols.split(/[\s,]+/).filter(Boolean) : undefined;
    const forms = Array.isArray(req.body?.forms)
      ? req.body.forms.filter((value: unknown): value is string => typeof value === "string")
      : typeof req.body?.forms === "string" ? req.body.forms.split(/[\s,]+/).filter(Boolean) : undefined;
    return res.json(await ingestSecEdgar({
      symbols,
      forms,
      includeCompanyFacts: req.body?.includeCompanyFacts !== false,
      maxFilingsPerCompany: Number.isFinite(Number(req.body?.maxFilingsPerCompany))
        ? Number(req.body.maxFilingsPerCompany) : undefined,
    }));
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/ingest/ecb", requireIngestionAccess, async (req, res) => {
  try {
    const currencies = Array.isArray(req.body?.currencies)
      ? req.body.currencies.filter((value: unknown): value is string => typeof value === "string")
      : typeof req.body?.currencies === "string" ? req.body.currencies.split(/[\s,]+/).filter(Boolean) : undefined;
    return res.json(await ingestEcbData({
      currencies,
      lookbackDays: Number.isFinite(Number(req.body?.lookbackDays)) ? Number(req.body.lookbackDays) : undefined,
      includeInterestRates: req.body?.includeInterestRates !== false,
    }));
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Latest weather per country for map overlay
app.get("/api/weather/country-latest", requireAuthenticated, async (_req, res) => {
  try {
    trackDemandSignal("weather");
    const rows = await getCountryWeatherLatest();
    res.json({ stats: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/weather/forecast", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("weather");
    const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: "country must be an ISO alpha-2 code." });
    const hours = typeof req.query.hours === "string" ? Number(req.query.hours) : 48;
    const forecast = await getCountryWeatherForecast(country, Number.isFinite(hours) ? hours : 48);
    if (!forecast) return res.status(404).json({ error: "No forecast is available for this country." });
    return res.json(forecast);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/weather/history", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("weather");
    const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: "country must be an ISO alpha-2 code." });
    const defaultEnd = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const defaultStart = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
    const history = await getHistoricalWeather(
      country,
      typeof req.query.start_date === "string" ? req.query.start_date : defaultStart,
      typeof req.query.end_date === "string" ? req.query.end_date : defaultEnd,
    );
    if (!history) return res.status(404).json({ error: "Historical weather is unavailable for this country." });
    return res.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(message.includes("must") ? 400 : 502).json({ error: message });
  }
});

app.get("/api/weather/marine", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("weather");
    const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: "country must be an ISO alpha-2 code." });
    const hours = typeof req.query.hours === "string" ? Number(req.query.hours) : 48;
    const marine = await getMarineWeather(country, Number.isFinite(hours) ? hours : 48);
    if (!marine) return res.status(404).json({ error: "Marine weather is unavailable for this country." });
    return res.json(marine);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/leadership/countries", requireAuthenticated, async (_req, res) => {
  try {
    trackDemandSignal("leadership");
    const countries = await getCountryLeadershipLatest();
    res.json({ countries });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/transport/overview", requireAuthenticated, async (req, res) => {
  try {
    const detail = req.query.detail === "full" ? "full" : "aggregate";
    const modeRaw = typeof req.query.mode === "string" ? req.query.mode.trim().toLowerCase() : "";
    const mode: TransportMode | undefined =
      modeRaw === "maritime" || modeRaw === "aviation" ? modeRaw : undefined;
    if (modeRaw && !mode) {
      return res.status(400).json({ error: "mode must be maritime or aviation." });
    }
    const country =
      typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : undefined;
    if (country && !/^[A-Z]{2}$/.test(country)) {
      return res.status(400).json({ error: "country must be an ISO alpha-2 code." });
    }
    const entityLimitRaw =
      typeof req.query.entity_limit === "string"
        ? Number.parseInt(req.query.entity_limit, 10)
        : undefined;
    const refresh =
      typeof req.query.refresh === "string" &&
      ["1", "true", "yes", "on"].includes(req.query.refresh.trim().toLowerCase());
    const overview = await getTransportOverview({
      detail,
      mode,
      country,
      entityLimit: Number.isFinite(entityLimitRaw as number) ? entityLimitRaw : undefined,
      bypassCache: refresh,
    });
    res.setHeader(
      "Cache-Control",
      refresh ? "private, no-store" : "private, max-age=30, stale-while-revalidate=30",
    );
    return res.json(overview);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ error: "Transport data service is reconnecting. Retry shortly." });
    }
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/api/transport/entities/:mode/:entityId", requireAuthenticated, async (req, res) => {
  try {
    const modeRaw = req.params.mode?.trim().toLowerCase();
    if (modeRaw !== "maritime" && modeRaw !== "aviation") {
      return res.status(400).json({ error: "mode must be maritime or aviation." });
    }
    const entityId = req.params.entityId?.trim();
    if (!entityId || entityId.length > 64) {
      return res.status(400).json({ error: "A valid entity id is required." });
    }
    const result = await getTransportEntity(modeRaw, entityId);
    if (!result) return res.status(404).json({ error: "Tracked entity not found." });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Latest market quotes from sources that remain active.
app.get("/api/market/quotes", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("market");
    const symbols = typeof req.query.symbols === "string"
      ? req.query.symbols.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean)
      : [];
    if (symbols.some((symbol) => !/^[A-Z0-9.^:_-]{1,24}$/.test(symbol)) || symbols.length > 100) {
      return res.status(400).json({ error: "symbols must contain at most 100 valid market identifiers." });
    }
    const { rows } = await query(
      `SELECT ms.symbol, ms.company_name, ms.exchange, ms.country, ms.currency,
              ms.price, ms.change, ms.percent_change, ms.high_price, ms.low_price,
              ms.open_price, ms.previous_close, ms.observed_at, ms.payload,
              s.name AS source_name
       FROM market_snapshot ms
       JOIN source s ON s.id = ms.source_id
       WHERE COALESCE(s.metadata->>'retired', 'false') <> 'true'
         AND (cardinality($1::text[]) = 0 OR upper(ms.symbol) = ANY($1::text[]))
       ORDER BY abs(COALESCE(ms.percent_change, 0)) DESC, ms.observed_at DESC`,
      [symbols]
    );
    res.json({ quotes: rows, refreshed: false, count: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/market/countries", requireAuthenticated, async (_req, res) => {
  try {
    trackDemandSignal("market");
    return res.json(await getCountryMarketOverview());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/market/countries/:country", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("market");
    const detail = await getCountryMarketDetail(req.params.country);
    if (!detail) return res.status(404).json({ error: "Country market context is unavailable." });
    return res.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(message.includes("ISO2") ? 400 : 500).json({ error: message });
  }
});

// Primary-source SEC filing events and company fundamentals.
app.get("/api/market/filings", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("market");
    const forms = typeof req.query.forms === "string" ? req.query.forms.split(/[\s,]+/).filter(Boolean) : undefined;
    const filings = await getMarketFilings({
      symbol: typeof req.query.symbol === "string" ? req.query.symbol : undefined,
      forms,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    return res.json({ filings, count: filings.length, attribution: "U.S. Securities and Exchange Commission" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/market/indicators", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("market");
    const indicators = await getMarketIndicators({
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      symbol: typeof req.query.symbol === "string" ? req.query.symbol : undefined,
      series: typeof req.query.series === "string" ? req.query.series : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    return res.json({ indicators, count: indicators.length });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/market/fx", requireAuthenticated, async (_req, res) => {
  try {
    trackDemandSignal("market");
    const rates = await getLatestFxRates();
    return res.json({ rates, count: rates.length, attribution: "European Central Bank" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/market/rates", requireAuthenticated, async (_req, res) => {
  try {
    trackDemandSignal("market");
    const rates = await getLatestPolicyRates();
    return res.json({ rates, count: rates.length, attribution: "European Central Bank" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Lightweight image proxy for remote thumbnails that block hotlinking
app.get("/api/proxy-image", requireAuthenticated, async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).send("invalid url");
    }
    const r = await fetch(url, { redirect: "follow" as any });
    if (!r.ok) {
      return res.status(r.status).send("upstream error");
    }
    const ct = r.headers.get("content-type") || "image/jpeg";
    res.setHeader("content-type", ct);
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400, immutable");
    res.setHeader("access-control-allow-origin", "*");
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200).send(buf);
  } catch (e: any) {
    res.status(500).send("proxy error");
  }
});

startDatabasePoolMonitoring();
startIngestionAutomationWorker();
startDailyBriefingSchedulerWorker();
startPersonalBriefingWorker();
startTransportIngestionWorkers();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
});
