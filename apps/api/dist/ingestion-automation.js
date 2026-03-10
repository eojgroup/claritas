"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationValidationError = void 0;
exports.listAutomationRules = listAutomationRules;
exports.parseAutomationRulePatch = parseAutomationRulePatch;
exports.updateAutomationRule = updateAutomationRule;
exports.trackDemandSignal = trackDemandSignal;
exports.getAutomationOverview = getAutomationOverview;
exports.startIngestionAutomationWorker = startIngestionAutomationWorker;
const ingestion_admin_1 = require("./ingestion-admin");
const db_1 = require("./db");
class AutomationValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "AutomationValidationError";
    }
}
exports.AutomationValidationError = AutomationValidationError;
const AUTOMATION_LOCK_NAMESPACE = 9432;
const AUTOMATION_LOCK_KEY = 1;
const AUTOMATION_POLL_SECONDS = clampInt(process.env.INGEST_AUTOMATION_POLL_SECONDS, 10, 3600, 30);
const RULE_DEFAULTS = {
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
                newsapi: true,
                thenewsapi: true,
            },
            everything: {
                q: "OpenAI",
                language: "en",
                pageSize: 50,
                maxPages: 2,
            },
            topHeadlines: {
                country: "us",
                category: "technology",
                q: "OpenAI",
                pageSize: 50,
                maxPages: 2,
            },
            theNewsApi: {
                search: "OpenAI",
                language: "en",
                locale: "us",
                pageSize: 50,
                maxPages: 2,
            },
        },
    },
    weather: {
        pipeline: "weather",
        enabled: true,
        schedule_enabled: true,
        schedule_interval_minutes: 120,
        intelligent_enabled: true,
        min_spacing_minutes: 30,
        freshness_sla_minutes: 180,
        demand_window_minutes: 20,
        demand_threshold: 10,
        failure_backoff_minutes: 30,
        default_payload: {},
    },
    market: {
        pipeline: "market",
        enabled: true,
        schedule_enabled: true,
        schedule_interval_minutes: 15,
        intelligent_enabled: true,
        min_spacing_minutes: 5,
        freshness_sla_minutes: 20,
        demand_window_minutes: 10,
        demand_threshold: 15,
        failure_backoff_minutes: 10,
        default_payload: {
            symbols: ["SPY", "QQQ", "EWQ", "EWG", "EWU", "EWJ", "MCHI", "INDA", "EWA", "EWC", "EWZ", "EZA", "EWW"],
            includeNews: true,
            newsCategory: "general",
            newsMaxItems: 50,
        },
    },
};
let automationWorkerTimer = null;
let automationWorkerRunning = false;
let lastDemandSignalPruneAt = 0;
function clampInt(raw, min, max, fallback) {
    const parsed = typeof raw === "number" && Number.isFinite(raw)
        ? Math.trunc(raw)
        : typeof raw === "string" && raw.trim()
            ? Number.parseInt(raw, 10)
            : Number.NaN;
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(parsed, min), max);
}
function timestampToString(value) {
    if (!value)
        return null;
    if (value instanceof Date) {
        const ts = value.getTime();
        return Number.isNaN(ts) ? null : value.toISOString();
    }
    const trimmed = value.trim();
    return trimmed || null;
}
function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function parsePipeline(value) {
    if (value === "news" || value === "weather" || value === "market")
        return value;
    throw new AutomationValidationError(`Unsupported ingestion pipeline: ${value}`);
}
function toAutomationRule(row) {
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
async function ensureAutomationRulesExist() {
    for (const pipeline of ["news", "weather", "market"]) {
        const defaults = RULE_DEFAULTS[pipeline];
        await (0, db_1.query)(`INSERT INTO ingestion_automation_rule (
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
       ON CONFLICT (pipeline) DO NOTHING`, [
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
        ]);
    }
}
async function getRule(pipeline) {
    await ensureAutomationRulesExist();
    const { rows } = await (0, db_1.query)(`SELECT
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
     LIMIT 1`, [pipeline]);
    if (!rows[0])
        return null;
    return toAutomationRule(rows[0]);
}
async function listAutomationRules() {
    await ensureAutomationRulesExist();
    const { rows } = await (0, db_1.query)(`SELECT
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
     ORDER BY pipeline ASC`);
    return rows.map(toAutomationRule);
}
function parseBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on")
            return true;
        if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off")
            return false;
    }
    return undefined;
}
function parseOptionalInt(value, name, min, max) {
    if (value == null || value === "")
        return undefined;
    const parsed = typeof value === "number" && Number.isFinite(value)
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
function parseAutomationRulePatch(raw) {
    const body = asRecord(raw);
    const enabled = parseBoolean(body.enabled);
    const scheduleEnabled = parseBoolean(body.schedule_enabled);
    const intelligentEnabled = parseBoolean(body.intelligent_enabled);
    let nextScheduledAt;
    if (Object.prototype.hasOwnProperty.call(body, "next_scheduled_at")) {
        if (body.next_scheduled_at == null || body.next_scheduled_at === "") {
            nextScheduledAt = null;
        }
        else if (typeof body.next_scheduled_at === "string") {
            const parsed = Date.parse(body.next_scheduled_at);
            if (Number.isNaN(parsed)) {
                throw new AutomationValidationError("next_scheduled_at must be a valid date/time.");
            }
            nextScheduledAt = new Date(parsed).toISOString();
        }
        else {
            throw new AutomationValidationError("next_scheduled_at must be a string or null.");
        }
    }
    let defaultPayload;
    if (Object.prototype.hasOwnProperty.call(body, "default_payload")) {
        if (body.default_payload == null) {
            defaultPayload = {};
        }
        else if (typeof body.default_payload === "object" && !Array.isArray(body.default_payload)) {
            defaultPayload = body.default_payload;
        }
        else {
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
async function updateAutomationRule(pipeline, patch) {
    const current = await getRule(pipeline);
    if (!current) {
        throw new AutomationValidationError(`Automation rule not found for pipeline: ${pipeline}`);
    }
    const nextScheduleEnabled = patch.schedule_enabled ?? current.schedule_enabled;
    let nextScheduledAt = patch.next_scheduled_at;
    if (typeof nextScheduledAt === "undefined") {
        if (!nextScheduleEnabled) {
            nextScheduledAt = null;
        }
        else if (!current.schedule_enabled && nextScheduleEnabled) {
            nextScheduledAt = new Date().toISOString();
        }
        else {
            nextScheduledAt = current.next_scheduled_at;
        }
    }
    const { rows } = await (0, db_1.query)(`UPDATE ingestion_automation_rule
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
       updated_at`, [
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
    ]);
    if (!rows[0]) {
        throw new AutomationValidationError(`Failed to update automation rule for ${pipeline}`);
    }
    return toAutomationRule(rows[0]);
}
function trackDemandSignal(pipeline) {
    const bucketMinuteIso = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    void (0, db_1.query)(`INSERT INTO ingestion_demand_signal_minute (pipeline, bucket_minute, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (pipeline, bucket_minute)
     DO UPDATE SET
       request_count = ingestion_demand_signal_minute.request_count + 1,
       updated_at = now()`, [pipeline, bucketMinuteIso]).catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Failed to record ingestion demand signal:", error);
    });
}
async function getRunStatus(pipeline) {
    const { rows } = await (0, db_1.query)(`SELECT
       MAX(started_at) AS last_run_at,
       MAX(started_at) FILTER (WHERE status = 'success') AS last_success_at,
       MAX(started_at) FILTER (WHERE status = 'failed') AS last_failure_at,
       COUNT(*) FILTER (WHERE status IN ('queued', 'running'))::int AS active_runs
     FROM ingestion_run
     WHERE pipeline = $1`, [pipeline]);
    return {
        last_run_at: rows[0]?.last_run_at ?? null,
        last_success_at: rows[0]?.last_success_at ?? null,
        last_failure_at: rows[0]?.last_failure_at ?? null,
        active_runs: Number(rows[0]?.active_runs || 0),
    };
}
async function getLatestDataTimestamp(pipeline) {
    if (pipeline === "news") {
        const { rows } = await (0, db_1.query)(`SELECT MAX(i.created_at) AS latest_data_at
       FROM item i
       JOIN source s ON s.id = i.source_id
       WHERE s.name IN ('newsapi', 'thenewsapi')`);
        return timestampToString(rows[0]?.latest_data_at ?? null);
    }
    if (pipeline === "weather") {
        const { rows } = await (0, db_1.query)(`SELECT MAX(observed_at) AS latest_data_at FROM weather_snapshot`);
        return timestampToString(rows[0]?.latest_data_at ?? null);
    }
    const { rows } = await (0, db_1.query)(`SELECT MAX(observed_at) AS latest_data_at FROM market_snapshot`);
    return timestampToString(rows[0]?.latest_data_at ?? null);
}
async function getDemandRequests(pipeline, minutes) {
    const { rows } = await (0, db_1.query)(`SELECT COALESCE(SUM(request_count), 0)::int AS demand_requests
     FROM ingestion_demand_signal_minute
     WHERE pipeline = $1
       AND bucket_minute >= now() - make_interval(mins => $2::int)`, [pipeline, Math.max(minutes, 1)]);
    return Number(rows[0]?.demand_requests || 0);
}
function computeDataAgeMinutes(latestDataAt) {
    if (!latestDataAt)
        return null;
    const parsed = Date.parse(latestDataAt);
    if (Number.isNaN(parsed))
        return null;
    return Math.max(Math.round((Date.now() - parsed) / 60_000), 0);
}
async function getPipelineEvaluationState(rule) {
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
async function getAutomationOverview() {
    const rules = await listAutomationRules();
    const status = await Promise.all(rules.map((rule) => getPipelineEvaluationState(rule)));
    return {
        poll_seconds: AUTOMATION_POLL_SECONDS,
        rules,
        status,
    };
}
async function tryAcquireAutomationLock() {
    const { rows } = await (0, db_1.query)(`SELECT pg_try_advisory_lock($1::int, $2::int) AS locked`, [AUTOMATION_LOCK_NAMESPACE, AUTOMATION_LOCK_KEY]);
    return !!rows[0]?.locked;
}
async function releaseAutomationLock() {
    await (0, db_1.query)(`SELECT pg_advisory_unlock($1::int, $2::int)`, [AUTOMATION_LOCK_NAMESPACE, AUTOMATION_LOCK_KEY]);
}
function isWithinMinutes(iso, minutes) {
    if (!iso)
        return false;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed))
        return false;
    return Date.now() - parsed < minutes * 60_000;
}
function parseDateMs(value) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        return null;
    return parsed;
}
function pickTriggerReason(rule, state) {
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
function nextScheduleIso(intervalMinutes) {
    return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
}
async function persistRuleEvaluation(rule, params) {
    const nextScheduledAt = params.triggered && rule.schedule_enabled
        ? nextScheduleIso(rule.schedule_interval_minutes)
        : rule.schedule_enabled
            ? rule.next_scheduled_at
            : null;
    await (0, db_1.query)(`UPDATE ingestion_automation_rule
     SET last_evaluated_at = now(),
         last_triggered_at = CASE WHEN $2 THEN now() ELSE last_triggered_at END,
         last_trigger_reason = CASE WHEN $2 THEN $3 ELSE last_trigger_reason END,
         last_error = $4,
         next_scheduled_at = $5,
         updated_at = now()
     WHERE pipeline = $1`, [rule.pipeline, !!params.triggered, params.reason ?? null, params.error ?? null, nextScheduledAt]);
}
async function triggerAutomationRun(rule, reason) {
    const actor = {
        userId: null,
        email: null,
        triggerMode: reason,
    };
    const payload = asRecord(rule.default_payload);
    if (rule.pipeline === "news") {
        const plan = (0, ingestion_admin_1.buildNewsRunPlan)(payload);
        await (0, ingestion_admin_1.triggerNewsRun)({ actor, plan });
        return;
    }
    if (rule.pipeline === "weather") {
        const plan = (0, ingestion_admin_1.buildWeatherRunPlan)(payload);
        await (0, ingestion_admin_1.triggerWeatherRun)({ actor, plan });
        return;
    }
    const plan = (0, ingestion_admin_1.buildMarketRunPlan)(payload);
    await (0, ingestion_admin_1.triggerMarketRun)({ actor, plan });
}
async function evaluateRule(rule) {
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
    if (isWithinMinutes(state.last_failure_at, rule.failure_backoff_minutes) &&
        (!state.last_success_at || Date.parse(state.last_success_at) < Date.parse(state.last_failure_at || ""))) {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await persistRuleEvaluation(rule, {
            reason,
            error: message.slice(0, 500),
            triggered: false,
        });
        if (error instanceof ingestion_admin_1.IngestionValidationError || error instanceof AutomationValidationError) {
            return;
        }
        throw error;
    }
}
async function pruneDemandSignals() {
    await (0, db_1.query)(`DELETE FROM ingestion_demand_signal_minute WHERE bucket_minute < now() - interval '14 days'`);
}
async function runAutomationCycle() {
    if (automationWorkerRunning)
        return;
    automationWorkerRunning = true;
    try {
        const hasLock = await tryAcquireAutomationLock();
        if (!hasLock)
            return;
        try {
            await ensureAutomationRulesExist();
            const rules = await listAutomationRules();
            for (const rule of rules) {
                await evaluateRule(rule);
            }
            if (Date.now() - lastDemandSignalPruneAt >= 6 * 3_600_000) {
                await pruneDemandSignals();
                lastDemandSignalPruneAt = Date.now();
            }
        }
        finally {
            await releaseAutomationLock();
        }
    }
    finally {
        automationWorkerRunning = false;
    }
}
function parseWorkerEnabled() {
    const raw = (process.env.INGEST_AUTOMATION_ENABLED || "true").trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(raw))
        return false;
    return true;
}
function startIngestionAutomationWorker() {
    if (!parseWorkerEnabled()) {
        // eslint-disable-next-line no-console
        console.log("Ingestion automation worker disabled via INGEST_AUTOMATION_ENABLED.");
        return;
    }
    if (automationWorkerTimer)
        return;
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
