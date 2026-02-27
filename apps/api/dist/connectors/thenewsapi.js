"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestTheNewsApiNews = ingestTheNewsApiNews;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const BASE_URL = "https://api.thenewsapi.com/v1";
function stableFeedKey(kind, params) {
    const entries = Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const qp = entries.map(([k, v]) => `${k}=${v}`).join("&");
    return `${kind}?${qp}`;
}
async function ensureSource(name, apiBaseUrl) {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider','thenewsapi'))
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url
     RETURNING id, name`, [name, apiBaseUrl]);
    return rows[0];
}
async function ensureFeed(sourceId, feedKey, params) {
    const { rows } = await (0, db_1.query)(`INSERT INTO source_feed (source_id, feed_key, params)
     VALUES ($1, $2, $3)
     ON CONFLICT (source_id, feed_key) DO UPDATE SET params = EXCLUDED.params
     RETURNING id, source_id, feed_key, params, cursor`, [sourceId, feedKey, JSON.stringify(params)]);
    return rows[0];
}
async function getCursor(feedId) {
    const { rows } = await (0, db_1.query)(`SELECT cursor FROM source_feed WHERE id = $1`, [feedId]);
    return rows[0]?.cursor ?? null;
}
async function setCursor(feedId, cursor) {
    await (0, db_1.query)(`UPDATE source_feed SET cursor = $1, updated_at = now() WHERE id = $2`, [cursor, feedId]);
}
function inferIso2FromUrl(url) {
    if (!url)
        return null;
    try {
        const parsed = new URL(url);
        const host = (parsed.hostname || "").toLowerCase();
        if (!host)
            return null;
        const parts = host.split(".");
        if (parts.length < 2)
            return null;
        const tld = parts[parts.length - 1];
        const generic = new Set([
            "com", "net", "org", "info", "biz", "edu", "gov", "mil",
            "int", "io", "me", "tv", "news", "xyz", "online", "shop",
            "site", "app", "tech", "cloud", "ai", "dev", "pro", "press",
        ]);
        if (generic.has(tld))
            return null;
        if (tld === "uk")
            return "GB";
        const iso2 = tld.toUpperCase();
        return /^[A-Z]{2}$/.test(iso2) ? iso2 : null;
    }
    catch {
        return null;
    }
}
function normalizeLocaleToIso2(locale) {
    if (!locale)
        return null;
    const cleaned = locale.trim().toUpperCase();
    if (!cleaned)
        return null;
    if (/^[A-Z]{2}$/.test(cleaned)) {
        return cleaned === "UK" ? "GB" : cleaned;
    }
    return null;
}
function normalize(article, localeHint) {
    const external_id = article.uuid || article.url || null;
    const event_time = article.published_at || null;
    const payload = {
        provider: "thenewsapi",
        source: article.source || null,
        image_url: article.image_url || null,
        categories: article.categories || [],
        keywords: article.keywords || [],
        locale: article.locale || localeHint || null,
        raw: article,
    };
    const dedupeBase = `${external_id || ""}|${event_time || ""}|${article.title || ""}|thenewsapi`;
    const dedupe_hash = node_crypto_1.default.createHash("sha256").update(dedupeBase).digest("hex");
    const iso2 = normalizeLocaleToIso2(localeHint) ||
        normalizeLocaleToIso2(article.locale) ||
        inferIso2FromUrl(article.url);
    return {
        kind: "news_article",
        title: article.title || null,
        summary: article.description || article.snippet || null,
        url: article.url || null,
        country_iso2: iso2,
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
async function ingestTheNewsApiNews(params) {
    const apiToken = process.env.THENEWSAPI_API_TOKEN || "";
    if (!apiToken)
        throw new Error("THENEWSAPI_API_TOKEN not set");
    const source = await ensureSource("thenewsapi", BASE_URL);
    const feedKey = stableFeedKey("news", {
        search: params.search,
        language: params.language,
        locale: params.locale,
    });
    const feed = await ensureFeed(source.id, feedKey, {
        kind: "news",
        search: params.search,
        language: params.language,
        locale: params.locale,
    });
    const cursor = (await getCursor(feed.id)) || {};
    const fromISO = params.publishedAfter || cursor.lastPublishedAt || undefined;
    let page = 1;
    const pageSize = Math.min(Math.max(params.pageSize || 50, 1), 100);
    const maxPages = Math.min(Math.max(params.maxPages || 2, 1), 10);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let newestPublishedAt = fromISO;
    while (page <= maxPages) {
        const url = new URL(`${BASE_URL}/news/top`);
        const sp = url.searchParams;
        sp.set("api_token", apiToken);
        sp.set("limit", String(pageSize));
        sp.set("page", String(page));
        if (params.search)
            sp.set("search", params.search);
        if (params.language)
            sp.set("language", params.language);
        if (params.locale)
            sp.set("locale", params.locale.toLowerCase());
        if (fromISO)
            sp.set("published_after", fromISO);
        const resp = await fetch(url.toString());
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`TheNewsAPI error HTTP ${resp.status}: ${text}`);
        }
        const data = (await resp.json());
        if (data.error) {
            if (typeof data.error === "string") {
                throw new Error(`TheNewsAPI error: ${data.error}`);
            }
            const code = data.error.code || "unknown_error";
            const message = data.error.message || "Unknown TheNewsAPI error";
            throw new Error(`TheNewsAPI error ${code}: ${message}`);
        }
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            throw new Error(`TheNewsAPI errors: ${data.errors.join("; ")}`);
        }
        const articles = data.articles || data.data || [];
        if (articles.length === 0)
            break;
        for (const article of articles) {
            const norm = normalize(article, params.locale || null);
            try {
                await upsertItem(source.id, norm);
                inserted++;
            }
            catch {
                skipped++;
            }
            const ts = article.published_at || undefined;
            if (ts && (!newestPublishedAt || ts > newestPublishedAt)) {
                newestPublishedAt = ts;
            }
        }
        if (articles.length < pageSize)
            break;
        page++;
    }
    if (newestPublishedAt && newestPublishedAt !== fromISO) {
        await setCursor(feed.id, { lastPublishedAt: newestPublishedAt });
    }
    return { inserted, updated, skipped, lastPublishedAt: newestPublishedAt };
}
