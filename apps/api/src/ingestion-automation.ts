import {
  IngestionValidationError,
  buildMarketRunPlan,
  buildNewsRunPlan,
  buildLeadershipRunPlan,
  buildPodcastRunPlan,
  buildWeatherRunPlan,
  triggerMarketRun,
  triggerNewsRun,
  triggerLeadershipRun,
  triggerPodcastRun,
  triggerWeatherRun,
  type IngestionPipeline,
} from "./ingestion-admin";
import { query, withTransaction } from "./db";

type DbTimestamp = string | Date;

type AutomationRuleRow = {
  pipeline: string;
  enabled: boolean;
  schedule_enabled: boolean;
  schedule_interval_minutes: number;
  intelligent_enabled: boolean;
  min_spacing_minutes: number;
  freshness_sla_minutes: number;
  demand_window_minutes: number;
  demand_threshold: number;
  failure_backoff_minutes: number;
  next_scheduled_at: DbTimestamp | null;
  last_evaluated_at: DbTimestamp | null;
  last_triggered_at: DbTimestamp | null;
  last_trigger_reason: string | null;
  last_error: string | null;
  default_payload: unknown;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
};

type RunStatusRow = {
  last_run_at: DbTimestamp | null;
  last_success_at: DbTimestamp | null;
  last_failure_at: DbTimestamp | null;
  active_runs: number;
};

type DemandRow = {
  demand_requests: number;
};

type LatestDataRow = {
  latest_data_at: DbTimestamp | null;
};

type AdvisoryLockRow = {
  locked: boolean;
};

export type IngestionAutomationRule = {
  pipeline: IngestionPipeline;
  enabled: boolean;
  schedule_enabled: boolean;
  schedule_interval_minutes: number;
  intelligent_enabled: boolean;
  min_spacing_minutes: number;
  freshness_sla_minutes: number;
  demand_window_minutes: number;
  demand_threshold: number;
  failure_backoff_minutes: number;
  next_scheduled_at: string | null;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  last_trigger_reason: string | null;
  last_error: string | null;
  default_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type IngestionAutomationPipelineStatus = {
  pipeline: IngestionPipeline;
  last_run_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  latest_data_at: string | null;
  data_age_minutes: number | null;
  demand_requests: number;
  active_runs: number;
};

export type IngestionAutomationRulePatch = {
  enabled?: boolean;
  schedule_enabled?: boolean;
  schedule_interval_minutes?: number;
  intelligent_enabled?: boolean;
  min_spacing_minutes?: number;
  freshness_sla_minutes?: number;
  demand_window_minutes?: number;
  demand_threshold?: number;
  failure_backoff_minutes?: number;
  next_scheduled_at?: string | null;
  default_payload?: Record<string, unknown>;
};

export class AutomationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationValidationError";
  }
}

type AutoTriggerReason = "scheduler" | "intelligent_freshness" | "intelligent_demand";

type PipelineEvaluationState = IngestionAutomationPipelineStatus;

type RuleDefaults = Omit<
  IngestionAutomationRule,
  | "next_scheduled_at"
  | "last_evaluated_at"
  | "last_triggered_at"
  | "last_trigger_reason"
  | "last_error"
  | "created_at"
  | "updated_at"
>;

const AUTOMATION_LOCK_NAMESPACE = 9432;
const AUTOMATION_LOCK_KEY = 1;
const AUTOMATION_POLL_SECONDS = clampInt(
  process.env.INGEST_AUTOMATION_POLL_SECONDS,
  10,
  3600,
  30
);
const STALE_ACTIVE_RUN_MINUTES = clampInt(
  process.env.INGEST_STALE_ACTIVE_RUN_MINUTES,
  30,
  1440,
  180
);

const RULE_DEFAULTS: Record<IngestionPipeline, RuleDefaults> = {
  news: {
    pipeline: "news",
    enabled: true,
    schedule_enabled: true,
    schedule_interval_minutes: 60,
    intelligent_enabled: true,
    min_spacing_minutes: 15,
    freshness_sla_minutes: 90,
    demand_window_minutes: 15,
    demand_threshold: 20,
    failure_backoff_minutes: 20,
    default_payload: {
      providers: {
        gdelt: true,
        institutionalRss: true,
      },
    },
  },
  weather: {
    pipeline: "weather",
    enabled: true,
    schedule_enabled: true,
    schedule_interval_minutes: 240,
    intelligent_enabled: true,
    min_spacing_minutes: 30,
    freshness_sla_minutes: 300,
    demand_window_minutes: 20,
    demand_threshold: 10,
    failure_backoff_minutes: 30,
    default_payload: { providers: { openweather: true, nws: true } },
  },
  market: {
    pipeline: "market",
    enabled: true,
    schedule_enabled: true,
    schedule_interval_minutes: 240,
    intelligent_enabled: true,
    min_spacing_minutes: 5,
    freshness_sla_minutes: 180,
    demand_window_minutes: 10,
    demand_threshold: 15,
    failure_backoff_minutes: 10,
    default_payload: {
      providers: { secEdgar: true, ecb: true, oecd: true },
    },
  },
  podcasts: {
    pipeline: "podcasts",
    enabled: false,
    schedule_enabled: false,
    schedule_interval_minutes: 360,
    intelligent_enabled: true,
    min_spacing_minutes: 60,
    freshness_sla_minutes: 720,
    demand_window_minutes: 60,
    demand_threshold: 5,
    failure_backoff_minutes: 60,
    default_payload: {
      maxFeeds: 10,
      maxEpisodesPerFeed: 10,
      fetchTranscripts: true,
      extractIntelligence: true,
    },
  },
  leadership: {
    pipeline: "leadership",
    enabled: true,
    schedule_enabled: true,
    schedule_interval_minutes: 1440,
    intelligent_enabled: true,
    min_spacing_minutes: 360,
    freshness_sla_minutes: 2880,
    demand_window_minutes: 120,
    demand_threshold: 10,
    failure_backoff_minutes: 180,
    default_payload: {},
  },
};

let automationWorkerTimer: NodeJS.Timeout | null = null;
let automationWorkerRunning = false;
let lastOperationalPruneAt = 0;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.trunc(raw)
      : typeof raw === "string" && raw.trim()
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function timestampToString(value: DbTimestamp | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? null : value.toISOString();
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parsePipeline(value: string): IngestionPipeline {
  if (
    value === "news" ||
    value === "weather" ||
    value === "market" ||
    value === "podcasts" ||
    value === "leadership"
  ) {
    return value;
  }
  throw new AutomationValidationError(`Unsupported ingestion pipeline: ${value}`);
}

function toAutomationRule(row: AutomationRuleRow): IngestionAutomationRule {
  return {
    pipeline: parsePipeline(row.pipeline),
    enabled: !!row.enabled,
    schedule_enabled: !!row.schedule_enabled,
    schedule_interval_minutes: Number(row.schedule_interval_minutes),
    intelligent_enabled: !!row.intelligent_enabled,
    min_spacing_minutes: Number(row.min_spacing_minutes),
    freshness_sla_minutes: Number(row.freshness_sla_minutes),
    demand_window_minutes: Number(row.demand_window_minutes),
    demand_threshold: Number(row.demand_threshold),
    failure_backoff_minutes: Number(row.failure_backoff_minutes),
    next_scheduled_at: timestampToString(row.next_scheduled_at),
    last_evaluated_at: timestampToString(row.last_evaluated_at),
    last_triggered_at: timestampToString(row.last_triggered_at),
    last_trigger_reason: row.last_trigger_reason,
    last_error: row.last_error,
    default_payload: asRecord(row.default_payload),
    created_at: timestampToString(row.created_at) || new Date().toISOString(),
    updated_at: timestampToString(row.updated_at) || new Date().toISOString(),
  };
}

async function ensureAutomationRulesExist(): Promise<void> {
  for (const pipeline of ["news", "weather", "market", "podcasts", "leadership"] as IngestionPipeline[]) {
    const defaults = RULE_DEFAULTS[pipeline];
    await query(
      `INSERT INTO ingestion_automation_rule (
         pipeline,
         enabled,
         schedule_enabled,
         schedule_interval_minutes,
         intelligent_enabled,
         min_spacing_minutes,
         freshness_sla_minutes,
         demand_window_minutes,
         demand_threshold,
         failure_backoff_minutes,
         next_scheduled_at,
         default_payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
       ON CONFLICT (pipeline) DO NOTHING`,
      [
        defaults.pipeline,
        defaults.enabled,
        defaults.schedule_enabled,
        defaults.schedule_interval_minutes,
        defaults.intelligent_enabled,
        defaults.min_spacing_minutes,
        defaults.freshness_sla_minutes,
        defaults.demand_window_minutes,
        defaults.demand_threshold,
        defaults.failure_backoff_minutes,
        JSON.stringify(defaults.default_payload),
      ]
    );
  }
}

async function getRule(pipeline: IngestionPipeline): Promise<IngestionAutomationRule | null> {
  await ensureAutomationRulesExist();
  const { rows } = await query<AutomationRuleRow>(
    `SELECT
       pipeline,
       enabled,
       schedule_enabled,
       schedule_interval_minutes,
       intelligent_enabled,
       min_spacing_minutes,
       freshness_sla_minutes,
       demand_window_minutes,
       demand_threshold,
       failure_backoff_minutes,
       next_scheduled_at,
       last_evaluated_at,
       last_triggered_at,
       last_trigger_reason,
       last_error,
       default_payload,
       created_at,
       updated_at
     FROM ingestion_automation_rule
     WHERE pipeline = $1
     LIMIT 1`,
    [pipeline]
  );
  if (!rows[0]) return null;
  return toAutomationRule(rows[0]);
}

export async function listAutomationRules(): Promise<IngestionAutomationRule[]> {
  await ensureAutomationRulesExist();
  const { rows } = await query<AutomationRuleRow>(
    `SELECT
       pipeline,
       enabled,
       schedule_enabled,
       schedule_interval_minutes,
       intelligent_enabled,
       min_spacing_minutes,
       freshness_sla_minutes,
       demand_window_minutes,
       demand_threshold,
       failure_backoff_minutes,
       next_scheduled_at,
       last_evaluated_at,
       last_triggered_at,
       last_trigger_reason,
       last_error,
       default_payload,
       created_at,
       updated_at
     FROM ingestion_automation_rule
     ORDER BY pipeline ASC`
  );

  return rows.map(toAutomationRule);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  }
  return undefined;
}

function parseOptionalInt(
  value: unknown,
  name: string,
  min: number,
  max: number
): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new AutomationValidationError(`${name} must be an integer.`);
  }
  if (parsed < min || parsed > max) {
    throw new AutomationValidationError(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

export function parseAutomationRulePatch(raw: unknown): IngestionAutomationRulePatch {
  const body = asRecord(raw);

  const enabled = parseBoolean(body.enabled);
  const scheduleEnabled = parseBoolean(body.schedule_enabled);
  const intelligentEnabled = parseBoolean(body.intelligent_enabled);

  let nextScheduledAt: string | null | undefined;
  if (Object.prototype.hasOwnProperty.call(body, "next_scheduled_at")) {
    if (body.next_scheduled_at == null || body.next_scheduled_at === "") {
      nextScheduledAt = null;
    } else if (typeof body.next_scheduled_at === "string") {
      const parsed = Date.parse(body.next_scheduled_at);
      if (Number.isNaN(parsed)) {
        throw new AutomationValidationError("next_scheduled_at must be a valid date/time.");
      }
      nextScheduledAt = new Date(parsed).toISOString();
    } else {
      throw new AutomationValidationError("next_scheduled_at must be a string or null.");
    }
  }

  let defaultPayload: Record<string, unknown> | undefined;
  if (Object.prototype.hasOwnProperty.call(body, "default_payload")) {
    if (body.default_payload == null) {
      defaultPayload = {};
    } else if (typeof body.default_payload === "object" && !Array.isArray(body.default_payload)) {
      defaultPayload = body.default_payload as Record<string, unknown>;
    } else {
      throw new AutomationValidationError("default_payload must be an object.");
    }
  }

  return {
    enabled,
    schedule_enabled: scheduleEnabled,
    schedule_interval_minutes: parseOptionalInt(body.schedule_interval_minutes, "schedule_interval_minutes", 1, 10080),
    intelligent_enabled: intelligentEnabled,
    min_spacing_minutes: parseOptionalInt(body.min_spacing_minutes, "min_spacing_minutes", 1, 10080),
    freshness_sla_minutes: parseOptionalInt(body.freshness_sla_minutes, "freshness_sla_minutes", 1, 43200),
    demand_window_minutes: parseOptionalInt(body.demand_window_minutes, "demand_window_minutes", 1, 1440),
    demand_threshold: parseOptionalInt(body.demand_threshold, "demand_threshold", 1, 100000),
    failure_backoff_minutes: parseOptionalInt(body.failure_backoff_minutes, "failure_backoff_minutes", 1, 10080),
    next_scheduled_at: nextScheduledAt,
    default_payload: defaultPayload,
  };
}

export async function updateAutomationRule(
  pipeline: IngestionPipeline,
  patch: IngestionAutomationRulePatch
): Promise<IngestionAutomationRule> {
  const current = await getRule(pipeline);
  if (!current) {
    throw new AutomationValidationError(`Automation rule not found for pipeline: ${pipeline}`);
  }

  const nextScheduleEnabled = patch.schedule_enabled ?? current.schedule_enabled;
  let nextScheduledAt = patch.next_scheduled_at;
  if (typeof nextScheduledAt === "undefined") {
    if (!nextScheduleEnabled) {
      nextScheduledAt = null;
    } else if (!current.schedule_enabled && nextScheduleEnabled) {
      nextScheduledAt = new Date().toISOString();
    } else {
      nextScheduledAt = current.next_scheduled_at;
    }
  }

  const { rows } = await query<AutomationRuleRow>(
    `UPDATE ingestion_automation_rule
     SET enabled = $2,
         schedule_enabled = $3,
         schedule_interval_minutes = $4,
         intelligent_enabled = $5,
         min_spacing_minutes = $6,
         freshness_sla_minutes = $7,
         demand_window_minutes = $8,
         demand_threshold = $9,
         failure_backoff_minutes = $10,
         next_scheduled_at = $11,
         default_payload = $12,
         last_error = CASE WHEN $13 THEN NULL ELSE last_error END,
         updated_at = now()
     WHERE pipeline = $1
     RETURNING
       pipeline,
       enabled,
       schedule_enabled,
       schedule_interval_minutes,
       intelligent_enabled,
       min_spacing_minutes,
       freshness_sla_minutes,
       demand_window_minutes,
       demand_threshold,
       failure_backoff_minutes,
       next_scheduled_at,
       last_evaluated_at,
       last_triggered_at,
       last_trigger_reason,
       last_error,
       default_payload,
       created_at,
       updated_at`,
    [
      pipeline,
      patch.enabled ?? current.enabled,
      nextScheduleEnabled,
      patch.schedule_interval_minutes ?? current.schedule_interval_minutes,
      patch.intelligent_enabled ?? current.intelligent_enabled,
      patch.min_spacing_minutes ?? current.min_spacing_minutes,
      patch.freshness_sla_minutes ?? current.freshness_sla_minutes,
      patch.demand_window_minutes ?? current.demand_window_minutes,
      patch.demand_threshold ?? current.demand_threshold,
      patch.failure_backoff_minutes ?? current.failure_backoff_minutes,
      nextScheduledAt,
      JSON.stringify(patch.default_payload ?? current.default_payload),
      true,
    ]
  );

  if (!rows[0]) {
    throw new AutomationValidationError(`Failed to update automation rule for ${pipeline}`);
  }
  return toAutomationRule(rows[0]);
}

const demandSignalBuffer = new Map<string, { pipeline: IngestionPipeline; bucketMinuteIso: string; count: number }>();
let demandSignalFlushTimer: NodeJS.Timeout | null = null;

async function flushDemandSignalBuffer(): Promise<void> {
  const pending = Array.from(demandSignalBuffer.values());
  demandSignalBuffer.clear();
  await Promise.all(
    pending.map(({ pipeline, bucketMinuteIso, count }) =>
      query(
        `INSERT INTO ingestion_demand_signal_minute (pipeline, bucket_minute, request_count)
         VALUES ($1, $2, $3)
         ON CONFLICT (pipeline, bucket_minute)
         DO UPDATE SET
           request_count = ingestion_demand_signal_minute.request_count + EXCLUDED.request_count,
           updated_at = now()`,
        [pipeline, bucketMinuteIso, count]
      )
    )
  );
}

function ensureDemandSignalFlushTimer(): void {
  if (demandSignalFlushTimer) return;
  demandSignalFlushTimer = setInterval(() => {
    void flushDemandSignalBuffer().catch((error) => {
      console.error("Failed to flush ingestion demand signals:", error);
    });
  }, 60_000);
  demandSignalFlushTimer.unref();
}

export function trackDemandSignal(pipeline: IngestionPipeline): void {
  const bucketMinuteIso = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const key = `${pipeline}:${bucketMinuteIso}`;
  const buffered = demandSignalBuffer.get(key);
  demandSignalBuffer.set(key, {
    pipeline,
    bucketMinuteIso,
    count: (buffered?.count ?? 0) + 1,
  });
  ensureDemandSignalFlushTimer();
}

async function getRunStatus(pipeline: IngestionPipeline): Promise<RunStatusRow> {
  const { rows } = await query<RunStatusRow>(
    `SELECT
       MAX(started_at) AS last_run_at,
       MAX(started_at) FILTER (WHERE status = 'success') AS last_success_at,
       MAX(started_at) FILTER (WHERE status = 'failed') AS last_failure_at,
       COUNT(*) FILTER (WHERE status IN ('queued', 'running'))::int AS active_runs
     FROM ingestion_run
     WHERE pipeline = $1`,
    [pipeline]
  );

  return {
    last_run_at: rows[0]?.last_run_at ?? null,
    last_success_at: rows[0]?.last_success_at ?? null,
    last_failure_at: rows[0]?.last_failure_at ?? null,
    active_runs: Number(rows[0]?.active_runs || 0),
  };
}

async function getLatestDataTimestamp(pipeline: IngestionPipeline): Promise<string | null> {
  if (pipeline === "news") {
    const { rows } = await query<LatestDataRow>(
      `SELECT MAX(i.created_at) AS latest_data_at
       FROM item i
       JOIN source s ON s.id = i.source_id
       WHERE s.name IN ('gdelt', 'institutional_rss')
         AND COALESCE(s.metadata->>'retired','false') <> 'true'`
    );
    return timestampToString(rows[0]?.latest_data_at ?? null);
  }

  if (pipeline === "weather") {
    const { rows } = await query<LatestDataRow>(
      `SELECT MAX(latest_data_at) AS latest_data_at FROM (
         SELECT MAX(observed_at) AS latest_data_at FROM weather_snapshot
         UNION ALL SELECT MAX(updated_at) FROM weather_forecast
         UNION ALL SELECT MAX(observed_at) FROM air_quality_snapshot
         UNION ALL SELECT MAX(updated_at) FROM weather_alert
       ) weather_sources`
    );
    return timestampToString(rows[0]?.latest_data_at ?? null);
  }

  if (pipeline === "podcasts") {
    const { rows } = await query<LatestDataRow>(`SELECT MAX(last_synced_at) AS latest_data_at FROM podcast_feed`);
    return timestampToString(rows[0]?.latest_data_at ?? null);
  }

  if (pipeline === "leadership") {
    const { rows } = await query<LatestDataRow>(
      `SELECT MAX(retrieved_at) AS latest_data_at FROM country_leadership`
    );
    return timestampToString(rows[0]?.latest_data_at ?? null);
  }

  const { rows } = await query<LatestDataRow>(
    `SELECT MAX(latest_data_at) AS latest_data_at FROM (
       SELECT MAX(ms.observed_at) AS latest_data_at
       FROM market_snapshot ms
       JOIN source s ON s.id = ms.source_id
       WHERE COALESCE(s.metadata->>'retired', 'false') <> 'true'
       UNION ALL SELECT MAX(updated_at) FROM market_event
       UNION ALL SELECT MAX(observed_at) FROM market_indicator
     ) market_sources`
  );
  return timestampToString(rows[0]?.latest_data_at ?? null);
}

async function getDemandRequests(pipeline: IngestionPipeline, minutes: number): Promise<number> {
  const { rows } = await query<DemandRow>(
    `SELECT COALESCE(SUM(request_count), 0)::int AS demand_requests
     FROM ingestion_demand_signal_minute
     WHERE pipeline = $1
       AND bucket_minute >= now() - make_interval(mins => $2::int)`,
    [pipeline, Math.max(minutes, 1)]
  );
  return Number(rows[0]?.demand_requests || 0);
}

function computeDataAgeMinutes(latestDataAt: string | null): number | null {
  if (!latestDataAt) return null;
  const parsed = Date.parse(latestDataAt);
  if (Number.isNaN(parsed)) return null;
  return Math.max(Math.round((Date.now() - parsed) / 60_000), 0);
}

async function getPipelineEvaluationState(
  rule: IngestionAutomationRule
): Promise<PipelineEvaluationState> {
  const runStatus = await getRunStatus(rule.pipeline);
  const latestDataAt = await getLatestDataTimestamp(rule.pipeline);
  const demandRequests = await getDemandRequests(rule.pipeline, rule.demand_window_minutes);

  return {
    pipeline: rule.pipeline,
    last_run_at: timestampToString(runStatus.last_run_at),
    last_success_at: timestampToString(runStatus.last_success_at),
    last_failure_at: timestampToString(runStatus.last_failure_at),
    latest_data_at: latestDataAt,
    data_age_minutes: computeDataAgeMinutes(latestDataAt),
    demand_requests: demandRequests,
    active_runs: runStatus.active_runs,
  };
}

export async function getAutomationOverview(): Promise<{
  poll_seconds: number;
  rules: IngestionAutomationRule[];
  status: IngestionAutomationPipelineStatus[];
}> {
  const rules = await listAutomationRules();
  const status = await Promise.all(rules.map((rule) => getPipelineEvaluationState(rule)));
  return {
    poll_seconds: AUTOMATION_POLL_SECONDS,
    rules,
    status,
  };
}

async function withAutomationLock(task: () => Promise<void>): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<AdvisoryLockRow>(
      `SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS locked`,
      [AUTOMATION_LOCK_NAMESPACE, AUTOMATION_LOCK_KEY]
    );
    if (!rows[0]?.locked) return;
    await task();
  });
}

function isWithinMinutes(iso: string | null, minutes: number): boolean {
  if (!iso) return false;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed < minutes * 60_000;
}

function parseDateMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function pickTriggerReason(
  rule: IngestionAutomationRule,
  state: PipelineEvaluationState
): AutoTriggerReason | null {
  const nowMs = Date.now();
  const nextScheduledMs = parseDateMs(rule.next_scheduled_at);

  if (rule.schedule_enabled) {
    if (nextScheduledMs == null || nextScheduledMs <= nowMs) {
      return "scheduler";
    }
  }

  if (rule.intelligent_enabled) {
    if (state.latest_data_at == null) {
      return "intelligent_freshness";
    }
    if ((state.data_age_minutes ?? 0) >= rule.freshness_sla_minutes) {
      return "intelligent_freshness";
    }
    if (state.demand_requests >= rule.demand_threshold) {
      return "intelligent_demand";
    }
  }

  return null;
}

function nextScheduleIso(intervalMinutes: number): string {
  return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
}

async function persistRuleEvaluation(
  rule: IngestionAutomationRule,
  params: {
    reason?: string | null;
    error?: string | null;
    triggered?: boolean;
  }
): Promise<void> {
  const nextScheduledAt =
    params.triggered && rule.schedule_enabled
      ? nextScheduleIso(rule.schedule_interval_minutes)
      : rule.schedule_enabled
        ? rule.next_scheduled_at
        : null;

  await query(
    `UPDATE ingestion_automation_rule
     SET last_evaluated_at = now(),
         last_triggered_at = CASE WHEN $2 THEN now() ELSE last_triggered_at END,
         last_trigger_reason = CASE WHEN $2 THEN $3 ELSE last_trigger_reason END,
         last_error = $4,
         next_scheduled_at = $5,
         updated_at = now()
     WHERE pipeline = $1`,
    [rule.pipeline, !!params.triggered, params.reason ?? null, params.error ?? null, nextScheduledAt]
  );
}

async function triggerAutomationRun(rule: IngestionAutomationRule, reason: AutoTriggerReason): Promise<void> {
  const actor = {
    userId: null,
    email: null,
    triggerMode: reason,
  };

  const payload = asRecord(rule.default_payload);

  if (rule.pipeline === "news") {
    const plan = buildNewsRunPlan(payload);
    await triggerNewsRun({ actor, plan });
    return;
  }

  if (rule.pipeline === "weather") {
    const plan = buildWeatherRunPlan(payload);
    await triggerWeatherRun({ actor, plan });
    return;
  }

  if (rule.pipeline === "podcasts") {
    const plan = buildPodcastRunPlan(payload);
    await triggerPodcastRun({ actor, plan });
    return;
  }

  if (rule.pipeline === "leadership") {
    const plan = buildLeadershipRunPlan(payload);
    await triggerLeadershipRun({ actor, plan });
    return;
  }

  const plan = buildMarketRunPlan(payload);
  await triggerMarketRun({ actor, plan });
}

async function failStaleActiveRuns(rule: IngestionAutomationRule): Promise<void> {
  const { rows } = await query<{ id: number }>(
    `UPDATE ingestion_run
     SET status = 'failed',
         finished_at = now(),
         error = COALESCE(
           error,
           'Marked failed by automation worker after exceeding stale active-run timeout.'
         )
     WHERE pipeline = $1
       AND status IN ('queued', 'running')
       AND started_at < now() - make_interval(mins => $2::int)
     RETURNING id`,
    [rule.pipeline, STALE_ACTIVE_RUN_MINUTES]
  );

  await Promise.all(
    rows.map((row) =>
      query(
        `INSERT INTO ingestion_run_log (run_id, logged_at, level, message, context)
         VALUES ($1, now(), 'error', $2, $3)`,
        [
          row.id,
          "Automation worker marked stale active ingestion run as failed.",
          JSON.stringify({
            pipeline: rule.pipeline,
            stale_timeout_minutes: STALE_ACTIVE_RUN_MINUTES,
          }),
        ]
      )
    )
  );
}

async function evaluateRule(rule: IngestionAutomationRule): Promise<void> {
  await failStaleActiveRuns(rule);
  const state = await getPipelineEvaluationState(rule);

  if (!rule.enabled) {
    await persistRuleEvaluation(rule, { error: null, triggered: false });
    return;
  }

  if (state.active_runs > 0) {
    await persistRuleEvaluation(rule, {
      error: null,
      triggered: false,
    });
    return;
  }

  if (isWithinMinutes(state.last_run_at, rule.min_spacing_minutes)) {
    await persistRuleEvaluation(rule, { error: null, triggered: false });
    return;
  }

  if (
    isWithinMinutes(state.last_failure_at, rule.failure_backoff_minutes) &&
    (!state.last_success_at || Date.parse(state.last_success_at) < Date.parse(state.last_failure_at || ""))
  ) {
    await persistRuleEvaluation(rule, {
      error: null,
      triggered: false,
    });
    return;
  }

  const reason = pickTriggerReason(rule, state);
  if (!reason) {
    await persistRuleEvaluation(rule, { error: null, triggered: false });
    return;
  }

  try {
    await triggerAutomationRun(rule, reason);
    await persistRuleEvaluation(rule, {
      reason,
      error: null,
      triggered: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistRuleEvaluation(rule, {
      reason,
      error: message.slice(0, 500),
      triggered: false,
    });

    if (error instanceof IngestionValidationError || error instanceof AutomationValidationError) {
      return;
    }
    throw error;
  }
}

async function pruneOperationalHistory(): Promise<void> {
  await query(`DELETE FROM ingestion_demand_signal_minute WHERE bucket_minute < now() - interval '7 days'`);
  await query(
    `DELETE FROM ingestion_run
     WHERE finished_at < now() - interval '30 days'
       AND status = 'success'`
  );
  await query(
    `DELETE FROM ingestion_run
     WHERE finished_at < now() - interval '90 days'
       AND status = 'failed'`
  );
}

async function runAutomationCycle(): Promise<void> {
  if (automationWorkerRunning) return;
  automationWorkerRunning = true;

  try {
    await withAutomationLock(async () => {
      await ensureAutomationRulesExist();
      const rules = await listAutomationRules();
      for (const rule of rules) {
        await evaluateRule(rule);
      }
      if (Date.now() - lastOperationalPruneAt >= 6 * 3_600_000) {
        await pruneOperationalHistory();
        lastOperationalPruneAt = Date.now();
      }
    });
  } finally {
    automationWorkerRunning = false;
  }
}

function parseWorkerEnabled(): boolean {
  const raw = (process.env.INGEST_AUTOMATION_ENABLED || "true").trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(raw)) return false;
  return true;
}

export function startIngestionAutomationWorker(): void {
  if (!parseWorkerEnabled()) {
    // eslint-disable-next-line no-console
    console.log("Ingestion automation worker disabled via INGEST_AUTOMATION_ENABLED.");
    return;
  }
  if (automationWorkerTimer) return;

  // eslint-disable-next-line no-console
  console.log(`Ingestion automation worker started (interval=${AUTOMATION_POLL_SECONDS}s).`);
  automationWorkerTimer = setInterval(() => {
    void runAutomationCycle().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Ingestion automation worker cycle failed:", error);
    });
  }, AUTOMATION_POLL_SECONDS * 1000);

  setTimeout(() => {
    void runAutomationCycle().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Ingestion automation initial cycle failed:", error);
    });
  }, 3_000);
}
