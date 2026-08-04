"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionValidationError = void 0;
exports.buildNewsRunPlan = buildNewsRunPlan;
exports.buildWeatherRunPlan = buildWeatherRunPlan;
exports.buildMarketRunPlan = buildMarketRunPlan;
exports.buildPodcastRunPlan = buildPodcastRunPlan;
exports.buildLeadershipRunPlan = buildLeadershipRunPlan;
exports.triggerNewsRun = triggerNewsRun;
exports.triggerWeatherRun = triggerWeatherRun;
exports.triggerMarketRun = triggerMarketRun;
exports.triggerPodcastRun = triggerPodcastRun;
exports.triggerLeadershipRun = triggerLeadershipRun;
exports.listRuns = listRuns;
exports.getRunDetail = getRunDetail;
exports.getRunLogs = getRunLogs;
exports.getMetrics = getMetrics;
const openweather_1 = require("./connectors/openweather");
const nws_1 = require("./connectors/nws");
const gdelt_1 = require("./connectors/gdelt");
const institutional_rss_1 = require("./connectors/institutional-rss");
const sec_edgar_1 = require("./connectors/sec-edgar");
const ecb_1 = require("./connectors/ecb");
const oecd_1 = require("./connectors/oecd");
const podcastindex_1 = require("./connectors/podcastindex");
const wikidata_leadership_1 = require("./connectors/wikidata-leadership");
const db_1 = require("./db");
const SOURCE_CONFIG = {
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
const PIPELINE_SOURCE_DEFAULT = {
    news: "gdelt",
    weather: "openweather",
    market: "secEdgar",
    podcasts: "podcastindex",
    leadership: "wikidata",
};
const activeRunPromises = new Map();
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
];
const INGESTION_SOURCE_SQL = `('${INGESTION_SOURCE_NAMES.join("', '")}')`;
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
function asBoolean(value, fallback) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on")
            return true;
        if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off")
            return false;
    }
    return fallback;
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
    if (pipeline === "news" ||
        pipeline === "weather" ||
        pipeline === "market" ||
        pipeline === "podcasts" ||
        pipeline === "leadership") {
        return pipeline;
    }
    if (sourceName === "gdelt")
        return "news";
    if (sourceName === "institutional_rss")
        return "news";
    if (sourceName === "openweather")
        return "weather";
    if (sourceName === "nws")
        return "weather";
    if (sourceName === "sec_edgar" || sourceName === "ecb" || sourceName === "oecd")
        return "market";
    if (sourceName === "podcastindex")
        return "podcasts";
    if (sourceName === "wikidata")
        return "leadership";
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
async function ensureSource(pipeline, sourceNameOverride) {
    const sourceName = sourceNameOverride ?? PIPELINE_SOURCE_DEFAULT[pipeline];
    const cfg = SOURCE_CONFIG[sourceName];
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, $4, jsonb_build_object('provider', $3::text))
     ON CONFLICT (name)
     DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type,
       metadata = COALESCE(source.metadata, '{}'::jsonb) || jsonb_build_object('provider', $3::text)
     RETURNING id, name`, [cfg.sourceName, cfg.apiBaseUrl, cfg.provider, cfg.authType]);
    return rows[0];
}
async function createRun(input) {
    const source = await ensureSource(input.pipeline, input.sourceNameOverride);
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
    const providersRaw = asRecord(body.providers);
    const providers = {
        gdelt: asBoolean(providersRaw.gdelt, true),
        institutionalRss: asBoolean(providersRaw.institutionalRss ?? providersRaw.institutional_rss, true),
    };
    if (!providers.gdelt && !providers.institutionalRss) {
        throw new IngestionValidationError("Select at least one news provider.");
    }
    return { providers, requestPayload: { providers } };
}
function buildWeatherRunPlan(rawBody) {
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
function buildMarketRunPlan(rawBody) {
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
function buildPodcastRunPlan(rawBody) {
    if (!process.env.PODCASTINDEX_API_KEY?.trim() || !process.env.PODCASTINDEX_API_SECRET?.trim()) {
        throw new IngestionValidationError("PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET must be configured.");
    }
    const body = asRecord(rawBody);
    const toList = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
    const feedIds = toList(body.feedIds ?? body.feed_ids)
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .slice(0, 50);
    const searchTerms = toList(body.searchTerms ?? body.search_terms)
        .map(asString)
        .filter((value) => Boolean(value))
        .slice(0, 20);
    const params = (0, podcastindex_1.podcastParamsFromEnv)({
        feedIds,
        searchTerms,
        maxFeeds: clampInt(body.maxFeeds ?? body.max_feeds, 1, 50, 10),
        maxEpisodesPerFeed: clampInt(body.maxEpisodesPerFeed ?? body.max_episodes_per_feed, 1, 100, 10),
        since: toFiniteNumber(body.since) ?? undefined,
        fetchTranscripts: asBoolean(body.fetchTranscripts ?? body.fetch_transcripts, true),
        extractIntelligence: asBoolean(body.extractIntelligence ?? body.extract_intelligence, true),
    });
    if (!params.feedIds?.length && !params.searchTerms?.length) {
        throw new IngestionValidationError("Provide feedIds/searchTerms or configure PODCAST_FEED_IDS/PODCAST_DISCOVERY_TERMS.");
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
function buildLeadershipRunPlan(_rawBody) {
    return { requestPayload: {} };
}
async function executeProviderStep(runId, steps, totals, step, action) {
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
    }
    catch (error) {
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
async function executeNewsRun(runId, plan) {
    const runStartedAt = Date.now();
    const steps = [];
    const totals = emptyTotals();
    try {
        await updateRunStatus(runId, "running");
        await safeAppendRunLog(runId, "info", "News ingestion run started.", {
            request: plan.requestPayload,
        });
        if (plan.providers.gdelt) {
            await executeProviderStep(runId, steps, totals, "gdelt/doc-event-gkg", async () => (0, gdelt_1.ingestGdelt)());
        }
        if (plan.providers.institutionalRss) {
            await executeProviderStep(runId, steps, totals, "institutional-rss/primary-source-releases", institutional_rss_1.ingestInstitutionalRss);
        }
        const succeeded = steps.filter((step) => step.status === "success").length;
        if (succeeded === 0)
            throw new Error("All selected news providers failed.");
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
        if (plan.providers.openweather) {
            await executeProviderStep(runId, steps, totals, "openweather/one-call-forecast-air-alerts", async () => (0, openweather_1.ingestOpenWeatherCountryWeather)(plan.country));
        }
        if (plan.providers.nws && (!plan.country || plan.country === "US")) {
            await executeProviderStep(runId, steps, totals, "nws/active-alerts", nws_1.ingestNwsAlerts);
        }
        const succeeded = steps.filter((step) => step.status === "success").length;
        if (succeeded === 0)
            throw new Error("All selected weather providers failed.");
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
async function executeMarketRun(runId, plan) {
    const runStartedAt = Date.now();
    const steps = [];
    const totals = emptyTotals();
    try {
        await updateRunStatus(runId, "running");
        await safeAppendRunLog(runId, "info", "Market ingestion run started.", {
            request: plan.requestPayload,
        });
        if (plan.providers.secEdgar) {
            await executeProviderStep(runId, steps, totals, "sec-edgar/filings-companyfacts", async () => (0, sec_edgar_1.ingestSecEdgar)());
        }
        if (plan.providers.ecb) {
            await executeProviderStep(runId, steps, totals, "ecb/fx-rates", async () => (0, ecb_1.ingestEcbData)());
        }
        if (plan.providers.oecd) {
            await executeProviderStep(runId, steps, totals, "oecd/monthly-share-price-indices", oecd_1.ingestOecdSharePrices);
        }
        const succeeded = steps.filter((step) => step.status === "success").length;
        if (succeeded === 0)
            throw new Error("All selected market providers failed.");
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
    }
    catch (err) {
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
async function executePodcastRun(runId, plan) {
    const startedAt = Date.now();
    const totals = emptyTotals();
    try {
        await updateRunStatus(runId, "running");
        await safeAppendRunLog(runId, "info", "PodcastIndex ingestion run started.", { request: plan.requestPayload });
        const result = await (0, podcastindex_1.ingestPodcastIndex)(plan);
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
    }
    catch (err) {
        const errorMessage = toErrorMessage(err);
        await updateRunStatus(runId, "failed", {
            error: errorMessage,
            stats: { pipeline: "podcasts", duration_ms: Date.now() - startedAt, totals },
            finished: true,
        });
        await safeAppendRunLog(runId, "error", "PodcastIndex ingestion run failed.", { error: errorMessage, totals });
    }
}
async function executeLeadershipRun(runId, plan) {
    const startedAt = Date.now();
    const totals = emptyTotals();
    try {
        await updateRunStatus(runId, "running");
        await safeAppendRunLog(runId, "info", "Wikidata leadership ingestion run started.", {
            request: plan.requestPayload,
        });
        const result = await (0, wikidata_leadership_1.ingestWikidataLeadership)();
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
    }
    catch (err) {
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
async function triggerNewsRun(input) {
    const sourceNameOverride = input.plan.providers.gdelt ? "gdelt" : "institutionalRss";
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
async function triggerWeatherRun(input) {
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
async function triggerMarketRun(input) {
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
async function triggerPodcastRun(input) {
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
async function triggerLeadershipRun(input) {
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
async function listRuns(options) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const params = [];
    const where = [
        `s.name IN ${INGESTION_SOURCE_SQL}`,
    ];
    if (options.pipeline) {
        const pipelineIdx = params.push(options.pipeline);
        where.push(`(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'gdelt')
        OR ($${pipelineIdx} = 'news' AND s.name = 'institutional_rss')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'nws')
        OR ($${pipelineIdx} = 'market' AND s.name = 'sec_edgar')
        OR ($${pipelineIdx} = 'market' AND s.name = 'ecb')
        OR ($${pipelineIdx} = 'market' AND s.name = 'oecd')
        OR ($${pipelineIdx} = 'podcasts' AND s.name = 'podcastindex')
        OR ($${pipelineIdx} = 'leadership' AND s.name = 'wikidata'))`);
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
       AND s.name IN ${INGESTION_SOURCE_SQL}
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
        `s.name IN ${INGESTION_SOURCE_SQL}`,
    ];
    if (options?.pipeline) {
        const pipelineIdx = params.push(options.pipeline);
        where.push(`(r.pipeline = $${pipelineIdx}
        OR ($${pipelineIdx} = 'news' AND s.name = 'gdelt')
        OR ($${pipelineIdx} = 'news' AND s.name = 'institutional_rss')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'openweather')
        OR ($${pipelineIdx} = 'weather' AND s.name = 'nws')
        OR ($${pipelineIdx} = 'market' AND s.name = 'sec_edgar')
        OR ($${pipelineIdx} = 'market' AND s.name = 'ecb')
        OR ($${pipelineIdx} = 'market' AND s.name = 'oecd')
        OR ($${pipelineIdx} = 'podcasts' AND s.name = 'podcastindex')
        OR ($${pipelineIdx} = 'leadership' AND s.name = 'wikidata'))`);
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
