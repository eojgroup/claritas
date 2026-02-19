"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionValidationError = void 0;
exports.buildNewsRunPlan = buildNewsRunPlan;
exports.buildWeatherRunPlan = buildWeatherRunPlan;
exports.triggerNewsRun = triggerNewsRun;
exports.triggerWeatherRun = triggerWeatherRun;
exports.listRuns = listRuns;
exports.getRunDetail = getRunDetail;
exports.getRunLogs = getRunLogs;
exports.getMetrics = getMetrics;
const newsapi_1 = require("./connectors/newsapi");
const openweather_1 = require("./connectors/openweather");
const db_1 = require("./db");
const SOURCE_CONFIG = {
    news: {
        sourceName: "newsapi",
        apiBaseUrl: "https://newsapi.org/v2",
        provider: "newsapi",
    },
    weather: {
        sourceName: "openweather",
        apiBaseUrl: "https://api.openweathermap.org",
        provider: "openweather",
    },
};
const DEFAULT_NEWS_EVERYTHING = {
    q: "OpenAI",
    pageSize: 50,
    maxPages: 2,
};
const DEFAULT_NEWS_TOP_HEADLINES = {
    country: "us",
    category: "technology",
    pageSize: 50,
    maxPages: 2,
};
const activeRunPromises = new Map();
class IngestionValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "IngestionValidationError";
    }
}
exports.IngestionValidationError = IngestionValidationError;
function toIsoNow() {
    return new Date().toISOString();
}
function timestampToString(value) {
    if (value instanceof Date) {
        const ts = value.getTime();
        if (!Number.isNaN(ts))
            return value.toISOString();
        return toIsoNow();
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed)
            return trimmed;
    }
    return toIsoNow();
}
function timestampToDateKey(value) {
    if (value instanceof Date) {
        const ts = value.getTime();
        if (!Number.isNaN(ts))
            return value.toISOString().slice(0, 10);
        return null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed))
            return trimmed.slice(0, 10);
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed))
            return null;
        return new Date(parsed).toISOString().slice(0, 10);
    }
    return null;
}
function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function asString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function clampInt(value, min, max, fallback) {
    const parsed = typeof value === "number" && Number.isFinite(value)
        ? Math.trunc(value)
        : typeof value === "string" && value.trim()
            ? Number.parseInt(value, 10)
            : Number.NaN;
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(parsed, min), max);
}
function normalizeIso2(value, allowEmpty = false) {
    const text = asString(value);
    if (!text)
        return allowEmpty ? undefined : undefined;
    if (!/^[a-zA-Z]{2}$/.test(text)) {
        throw new IngestionValidationError(`Invalid ISO2 country code: "${text}"`);
    }
    return text.toLowerCase();
}
function toErrorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
function toFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return null;
}
function getPath(obj, path) {
    if (!obj || typeof obj !== "object")
        return undefined;
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (!current || typeof current !== "object")
            return undefined;
        current = current[part];
    }
    return current;
}
function emptyTotals() {
    return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        http_failures: 0,
        db_errors: 0,
    };
}
function readTotal(stats, paths) {
    for (const path of paths) {
        const value = getPath(stats, path);
        const numeric = toFiniteNumber(value);
        if (numeric != null)
            return numeric;
    }
    return 0;
}
function extractTotals(stats) {
    return {
        inserted: readTotal(stats, ["totals.inserted", "inserted"]),
        updated: readTotal(stats, ["totals.updated", "updated"]),
        skipped: readTotal(stats, ["totals.skipped", "skipped"]),
        http_failures: readTotal(stats, ["totals.http_failures", "http_failures"]),
        db_errors: readTotal(stats, ["totals.db_errors", "db_errors"]),
    };
}
function mergeTotals(target, delta) {
    target.inserted += delta.inserted;
    target.updated += delta.updated;
    target.skipped += delta.skipped;
    target.http_failures += delta.http_failures;
    target.db_errors += delta.db_errors;
}
function resolvePipeline(pipeline, sourceName) {
    if (pipeline === "news" || pipeline === "weather")
        return pipeline;
    if (sourceName === "newsapi")
        return "news";
    if (sourceName === "openweather")
        return "weather";
    return "news";
}
function normalizeStatus(status) {
    if (status === "queued" || status === "running" || status === "success" || status === "failed") {
        return status;
    }
    return "unknown";
}
function normalizeLogLevel(level) {
    if (level === "warn" || level === "error")
        return level;
    return "info";
}
function toAdminRun(row) {
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
function toAdminLog(row) {
    return {
        id: row.id,
        run_id: row.run_id,
        logged_at: timestampToString(row.logged_at),
        level: normalizeLogLevel(row.level),
        message: row.message,
        context: row.context ?? null,
    };
}
async function ensureSource(pipeline) {
    const cfg = SOURCE_CONFIG[pipeline];
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider', $3::text))
     ON CONFLICT (name)
     DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url,
       metadata = COALESCE(source.metadata, '{}'::jsonb) || jsonb_build_object('provider', $3::text)
     RETURNING id, name`, [cfg.sourceName, cfg.apiBaseUrl, cfg.provider]);
    return rows[0];
}
async function createRun(input) {
    const source = await ensureSource(input.pipeline);
    const stats = {
        pipeline: input.pipeline,
        steps: [],
        totals: emptyTotals(),
    };
    const { rows } = await (0, db_1.query)(`INSERT INTO ingestion_run (
      source_id, feed_id, started_at, finished_at, status, error, stats,
      pipeline, trigger_mode, requested_by_user_id, requested_by_email, request_payload
     )
     VALUES ($1, NULL, now(), NULL, 'queued', NULL, $2, $3, $4, $5, $6, $7)
     RETURNING id`, [
        source.id,
        JSON.stringify(stats),
        input.pipeline,
        input.actor.triggerMode,
        input.actor.userId,
        input.actor.email,
        JSON.stringify(input.requestPayload),
    ]);
    return rows[0];
}
async function updateRunStatus(runId, status, details) {
    const finishedAt = details?.finished ? "now()" : "NULL";
    await (0, db_1.query)(`UPDATE ingestion_run
     SET status = $2,
         error = $3,
         stats = COALESCE($4::jsonb, stats),
         finished_at = ${finishedAt}
     WHERE id = $1`, [runId, status, details?.error ?? null, details?.stats ? JSON.stringify(details.stats) : null]);
}
async function appendRunLog(runId, level, message, context) {
    await (0, db_1.query)(`INSERT INTO ingestion_run_log (run_id, logged_at, level, message, context)
     VALUES ($1, now(), $2, $3, $4)`, [runId, level, message, context ? JSON.stringify(context) : null]);
}
async function safeAppendRunLog(runId, level, message, context) {
    try {
        await appendRunLog(runId, level, message, context);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to append ingestion log:", err);
    }
}
function startRunTask(runId, task) {
    const promise = (async () => {
        try {
            await task();
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error(`Unhandled error in ingestion run ${runId}:`, err);
        }
        finally {
            activeRunPromises.delete(runId);
        }
    })();
    activeRunPromises.set(runId, promise);
}
function buildNewsRunPlan(rawBody) {
    const body = asRecord(rawBody);
    const everythingRaw = body.everything;
    const topRaw = body.topHeadlines;
    let everything = null;
    if (everythingRaw !== false) {
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
    let topHeadlines = null;
    if (topRaw !== false) {
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
    if (!everything && !topHeadlines) {
        throw new IngestionValidationError("At least one news ingest step must be enabled.");
    }
    return {
        everything,
        topHeadlines,
        requestPayload: {
            everything: everything ?? false,
            topHeadlines: topHeadlines ?? false,
        },
    };
}
function buildWeatherRunPlan(rawBody) {
    const body = asRecord(rawBody);
    const country = normalizeIso2(body.country, true);
    return {
        country: country ? country.toUpperCase() : undefined,
        requestPayload: country ? { country: country.toUpperCase() } : {},
    };
}
async function executeNewsRun(runId, plan) {
    const runStartedAt = Date.now();
    const steps = [];
    const totals = emptyTotals();
    try {
        await updateRunStatus(runId, "running");
        await safeAppendRunLog(runId, "info", "News ingestion run started.", {
            request: plan.requestPayload,
        });
        if (plan.everything) {
            const stepStartedAt = Date.now();
            await safeAppendRunLog(runId, "info", "Running NewsAPI everything ingest.", {
                params: plan.everything,
            });
            try {
                const result = (await (0, newsapi_1.ingestNewsApiEverything)(plan.everything));
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
            }
            catch (err) {
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
        if (plan.topHeadlines) {
            const stepStartedAt = Date.now();
            await safeAppendRunLog(runId, "info", "Running NewsAPI top-headlines ingest.", {
                params: plan.topHeadlines,
            });
            try {
                const result = (await (0, newsapi_1.ingestNewsApiTopHeadlines)(plan.topHeadlines));
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
            }
            catch (err) {
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
    }
    catch (err) {
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
async function executeWeatherRun(runId, plan) {
    const runStartedAt = Date.now();
    const steps = [];
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
            const result = (await (0, openweather_1.ingestOpenWeatherCountryCurrent)(plan.country));
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
        }
        catch (err) {
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
    }
    catch (err) {
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
async function triggerNewsRun(input) {
    const run = await createRun({
        pipeline: "news",
        actor: input.actor,
        requestPayload: input.plan.requestPayload,
    });
    await safeAppendRunLog(run.id, "info", "News ingestion run queued.", {
        requested_by: input.actor.email || input.actor.userId,
    });
    startRunTask(run.id, () => executeNewsRun(run.id, input.plan));
    return { runId: run.id };
}
async function triggerWeatherRun(input) {
    const run = await createRun({
        pipeline: "weather",
        actor: input.actor,
        requestPayload: input.plan.requestPayload,
    });
    await safeAppendRunLog(run.id, "info", "Weather ingestion run queued.", {
        requested_by: input.actor.email || input.actor.userId,
    });
    startRunTask(run.id, () => executeWeatherRun(run.id, input.plan));
    return { runId: run.id };
}
async function listRuns(options) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const params = [];
    const where = ["s.name IN ('newsapi', 'openweather')"];
    if (options.pipeline) {
        const pipelineIdx = params.push(options.pipeline);
        where.push(`(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'newsapi')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather'))`);
    }
    const limitIdx = params.push(limit);
    const offsetIdx = params.push(offset);
    const { rows } = await (0, db_1.query)(`SELECT
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
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows.map(toAdminRun);
}
async function getRunDetail(runId, logLimit = 200) {
    const { rows } = await (0, db_1.query)(`SELECT
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
       AND s.name IN ('newsapi', 'openweather')
     LIMIT 1`, [runId]);
    if (!rows[0])
        return null;
    const logs = await getRunLogs(runId, { limit: logLimit });
    return { run: toAdminRun(rows[0]), logs };
}
async function getRunLogs(runId, options) {
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
    const afterId = Math.max(options?.afterId ?? 0, 0);
    const { rows } = await (0, db_1.query)(`SELECT id, run_id, logged_at, level, message, context
     FROM ingestion_run_log
     WHERE run_id = $1
       AND id > $2
     ORDER BY id ASC
     LIMIT $3`, [runId, afterId, limit]);
    return rows.map(toAdminLog);
}
async function getMetrics(options) {
    const days = Math.min(Math.max(options?.days ?? 30, 1), 180);
    const params = [days];
    const where = [
        "r.started_at >= now() - make_interval(days => $1::int)",
        "s.name IN ('newsapi', 'openweather')",
    ];
    if (options?.pipeline) {
        const pipelineIdx = params.push(options.pipeline);
        where.push(`(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'newsapi')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather'))`);
    }
    const { rows } = await (0, db_1.query)(`SELECT
       r.pipeline,
       s.name AS source_name,
       r.status,
       r.started_at,
       r.stats
     FROM ingestion_run r
     JOIN source s ON s.id = r.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.started_at ASC, r.id ASC`, params);
    const pointsByKey = new Map();
    for (const row of rows) {
        const resolvedPipeline = resolvePipeline(row.pipeline, row.source_name);
        const dateKey = timestampToDateKey(row.started_at);
        if (!dateKey)
            continue;
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
        const point = pointsByKey.get(key);
        point.run_count += 1;
        const status = normalizeStatus(row.status);
        if (status === "success")
            point.success_count += 1;
        if (status === "failed")
            point.failed_count += 1;
        if (status === "queued")
            point.queued_count += 1;
        if (status === "running")
            point.running_count += 1;
        const totals = extractTotals(row.stats);
        mergeTotals(point, totals);
    }
    const points = Array.from(pointsByKey.values()).sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0)
            return dateCompare;
        return a.pipeline.localeCompare(b.pipeline);
    });
    const totalsByPipeline = new Map();
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
        const total = totalsByPipeline.get(point.pipeline);
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
