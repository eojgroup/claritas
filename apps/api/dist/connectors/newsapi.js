"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestNewsApiEverything = ingestNewsApiEverything;
exports.ingestNewsApiTopHeadlines = ingestNewsApiTopHeadlines;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const country_inference_1 = require("./country-inference");
const BASE_URL = "https://newsapi.org/v2";
const DEFAULT_EVERYTHING_LOOKBACK_DAYS = 30;
function stableFeedKey(kind, params) {
    const entries = Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const qp = entries.map(([k, v]) => `${k}=${v}`).join("&");
    return `${kind}?${qp}`;
}
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
function newsApiEverythingLookbackDays() {
    return clampInt(process.env.NEWSAPI_EVERYTHING_LOOKBACK_DAYS, 1, 3650, DEFAULT_EVERYTHING_LOOKBACK_DAYS);
}
function getUsableEverythingFrom(value) {
    if (typeof value !== "string" || !value.trim())
        return undefined;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        return undefined;
    const oldestAllowedMs = Date.now() - newsApiEverythingLookbackDays() * 24 * 60 * 60 * 1000;
    if (parsed < oldestAllowedMs)
        return undefined;
    return new Date(parsed).toISOString();
}
function isNewsApiFromTooFarBackError(status, body) {
    if (status !== 426 && status !== 400)
        return false;
    const normalized = body.toLowerCase();
    return normalized.includes("too far in the past") || normalized.includes("far back");
}
async function ensureSource(name, apiBaseUrl) {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider','newsapi'))
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url
     RETURNING id, name`, [name, apiBaseUrl]);
    return rows[0];
}
async function ensureFeed(sourceId, feedKey, params) {
    const { rows } = await (0, db_1.query)(`INSERT INTO source_feed (source_id, feed_key, params)
     VALUES ($1, $2, $3)
     ON CONFLICT (source_id, feed_key) DO UPDATE SET params = EXCLUDED.params
     RETURNING id, source_id, feed_key, params, cursor`, [sourceId, feedKey, params]);
    return rows[0];
}
async function getCursor(feedId) {
    const { rows } = await (0, db_1.query)(`SELECT cursor FROM source_feed WHERE id = $1`, [feedId]);
    return rows[0]?.cursor ?? null;
}
async function setCursor(feedId, cursor) {
    await (0, db_1.query)(`UPDATE source_feed SET cursor = $1, updated_at = now() WHERE id = $2`, [cursor, feedId]);
}
function normalize(article, country) {
    const inference = (0, country_inference_1.inferNewsCountry)({
        title: article.title,
        summary: article.description,
        content: article.content,
        url: article.url,
        feedCountryHint: country,
    });
    const external_id = article.url || null; // canonical URL
    const event_time = article.publishedAt || null;
    const payload = {
        provider: "newsapi",
        author: article.author || null,
        urlToImage: article.urlToImage || null,
        source: article.source?.name || null,
        content: article.content || null,
        country_inference: inference,
        raw: article,
    };
    const base = `${external_id || ""}|${event_time || ""}|${article.title || ""}`;
    const dedupe_hash = node_crypto_1.default.createHash("sha256").update(base).digest("hex");
    return {
        kind: "news_article",
        title: article.title || null,
        summary: article.description || null,
        url: article.url || null,
        country_iso2: inference.iso2 || null,
        event_time,
        payload,
        external_id,
        dedupe_hash,
    };
}
async function upsertItem(sourceId, item) {
    await (0, db_1.query)(`INSERT INTO item (source_id, external_id, kind, title, summary, url, country_iso2, event_time, payload, dedupe_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (source_id, external_id)
     DO UPDATE SET
       kind = EXCLUDED.kind,
       title = COALESCE(EXCLUDED.title, item.title),
       summary = COALESCE(EXCLUDED.summary, item.summary),
       url = COALESCE(EXCLUDED.url, item.url),
       country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2),
       event_time = COALESCE(EXCLUDED.event_time, item.event_time),
       payload = EXCLUDED.payload,
       dedupe_hash = EXCLUDED.dedupe_hash,
       updated_at = now()
    `, [
        sourceId,
        item.external_id,
        item.kind,
        item.title,
        item.summary,
        item.url,
        item.country_iso2,
        item.event_time,
        JSON.stringify(item.payload),
        item.dedupe_hash,
    ]);
}
async function ingestNewsApiEverything(params) {
    const apiKey = process.env.NEWSAPI_API_KEY || ""; // will be injected at runtime in cluster
    if (!apiKey)
        throw new Error("NEWSAPI_API_KEY not set");
    const source = await ensureSource("newsapi", BASE_URL);
    const feedKey = stableFeedKey("everything", { q: params.q, language: params.language });
    const feed = await ensureFeed(source.id, feedKey, { kind: "everything", q: params.q, language: params.language });
    const cursor = (await getCursor(feed.id)) || {};
    let fromISO = getUsableEverythingFrom(cursor.lastPublishedAt);
    const originalFromISO = fromISO;
    let retriedWithoutFrom = false;
    let page = 1;
    const pageSize = Math.min(Math.max(params.pageSize || 50, 1), 100);
    const maxPages = Math.min(Math.max(params.maxPages || 3, 1), 10);
    let inserted = 0, updated = 0, skipped = 0;
    let newestPublishedAt = fromISO;
    while (page <= maxPages) {
        const url = new URL(`${BASE_URL}/everything`);
        const sp = new URLSearchParams();
        sp.set("q", params.q);
        if (params.language)
            sp.set("language", params.language);
        sp.set("sortBy", "publishedAt");
        sp.set("pageSize", String(pageSize));
        sp.set("page", String(page));
        if (fromISO)
            sp.set("from", fromISO);
        url.search = sp.toString();
        const resp = await fetch(url.toString(), { headers: { "X-Api-Key": apiKey } });
        if (!resp.ok) {
            const text = await resp.text();
            if (fromISO && !retriedWithoutFrom && isNewsApiFromTooFarBackError(resp.status, text)) {
                retriedWithoutFrom = true;
                fromISO = undefined;
                newestPublishedAt = undefined;
                page = 1;
                continue;
            }
            throw new Error(`NewsAPI error HTTP ${resp.status}: ${text}`);
        }
        const data = (await resp.json());
        if (data.status !== "ok") {
            throw new Error(`NewsAPI error ${data.code}: ${data.message}`);
        }
        const articles = data.articles || [];
        if (articles.length === 0)
            break;
        // Insert items
        for (const a of articles) {
            const norm = normalize(a);
            try {
                await upsertItem(source.id, norm);
                inserted++;
            }
            catch (e) {
                skipped++;
            }
            const ts = a.publishedAt || undefined;
            if (ts && (!newestPublishedAt || ts > newestPublishedAt)) {
                newestPublishedAt = ts;
            }
        }
        // Stop if fewer than pageSize received
        if ((articles?.length || 0) < pageSize)
            break;
        page++;
    }
    if (newestPublishedAt && newestPublishedAt !== originalFromISO) {
        await setCursor(feed.id, { lastPublishedAt: newestPublishedAt });
    }
    return { inserted, updated, skipped, lastPublishedAt: newestPublishedAt };
}
async function ingestNewsApiTopHeadlines(params) {
    const apiKey = process.env.NEWSAPI_API_KEY || "";
    if (!apiKey)
        throw new Error("NEWSAPI_API_KEY not set");
    const source = await ensureSource("newsapi", BASE_URL);
    const feedKey = stableFeedKey("top-headlines", { country: params.country, category: params.category, q: params.q });
    await ensureFeed(source.id, feedKey, { kind: "top-headlines", ...params });
    let page = 1;
    const pageSize = Math.min(Math.max(params.pageSize || 50, 1), 100);
    const maxPages = Math.min(Math.max(params.maxPages || 2, 1), 10);
    let inserted = 0, updated = 0, skipped = 0;
    while (page <= maxPages) {
        const url = new URL(`${BASE_URL}/top-headlines`);
        const sp = new URLSearchParams();
        if (params.country)
            sp.set("country", params.country);
        if (params.category)
            sp.set("category", params.category);
        if (params.q)
            sp.set("q", params.q);
        sp.set("pageSize", String(pageSize));
        sp.set("page", String(page));
        url.search = sp.toString();
        const resp = await fetch(url.toString(), { headers: { "X-Api-Key": apiKey } });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`NewsAPI error HTTP ${resp.status}: ${text}`);
        }
        const data = (await resp.json());
        if (data.status !== "ok") {
            throw new Error(`NewsAPI error ${data.code}: ${data.message}`);
        }
        const articles = data.articles || [];
        if (articles.length === 0)
            break;
        for (const a of articles) {
            const norm = normalize(a, params.country);
            try {
                await upsertItem(source.id, norm);
                inserted++;
            }
            catch (e) {
                skipped++;
            }
        }
        if (articles.length < pageSize)
            break;
        page++;
    }
    return { inserted, updated, skipped };
}
