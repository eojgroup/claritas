"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PODCAST_DISCOVERY_TERMS = void 0;
exports.ingestPodcastIndex = ingestPodcastIndex;
exports.discoverPodcastFeeds = discoverPodcastFeeds;
exports.podcastParamsFromEnv = podcastParamsFromEnv;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:dns/promises"));
const node_net_1 = __importDefault(require("node:net"));
const db_1 = require("../db");
const podcast_intelligence_1 = require("../podcast-intelligence");
const BASE_URL = "https://api.podcastindex.org/api/1.0";
exports.DEFAULT_PODCAST_DISCOVERY_TERMS = [
    "geopolitics",
    "security",
    "technology",
    "markets",
];
const USER_AGENT = process.env.PODCASTINDEX_USER_AGENT?.trim() ||
    "Claritas/1.0 (+https://app.claritas.info)";
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const TRANSCRIPT_TIMEOUT_MS = 20_000;
function clampInt(value, min, max, fallback) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
}
function cleanText(value, maxLength = 20_000) {
    if (typeof value !== "string")
        return null;
    const text = value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
    return text || null;
}
function epochToIso(value) {
    const seconds = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function podcastIndexHeaders() {
    const apiKey = (process.env.PODCASTINDEX_API_KEY || "").trim();
    const apiSecret = (process.env.PODCASTINDEX_API_SECRET || "").trim();
    if (!apiKey || !apiSecret) {
        throw new Error("PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET must both be configured.");
    }
    const authDate = Math.floor(Date.now() / 1000).toString();
    const authorization = node_crypto_1.default.createHash("sha1").update(`${apiKey}${apiSecret}${authDate}`).digest("hex");
    return {
        "User-Agent": USER_AGENT,
        "X-Auth-Key": apiKey,
        "X-Auth-Date": authDate,
        Authorization: authorization,
    };
}
async function podcastIndexGet(path, params) {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "")
            url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = await fetch(url, { headers: podcastIndexHeaders(), signal: controller.signal });
        const body = await response.text();
        if (!response.ok)
            throw new Error(`PodcastIndex HTTP ${response.status}: ${body.slice(0, 1000)}`);
        const parsed = JSON.parse(body);
        if (parsed.status && parsed.status !== "true") {
            throw new Error(`PodcastIndex error: ${parsed.description || parsed.status}`);
        }
        return parsed;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function ensureSource() {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('podcastindex', $1, 'api_key_sha1', jsonb_build_object('provider', 'podcastindex'))
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url
     RETURNING id, name`, [BASE_URL]);
    return rows[0];
}
async function ensureFeed(sourceId, feed) {
    const feedId = Number(feed.id);
    const { rows } = await (0, db_1.query)(`INSERT INTO podcast_feed (
       source_id, podcast_index_id, podcast_guid, title, feed_url, site_url,
       author, description, image_url, language, itunes_id, categories, metadata, last_synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,now())
     ON CONFLICT (podcast_index_id)
     DO UPDATE SET
       podcast_guid = EXCLUDED.podcast_guid,
       title = EXCLUDED.title,
       feed_url = EXCLUDED.feed_url,
       site_url = EXCLUDED.site_url,
       author = EXCLUDED.author,
       description = EXCLUDED.description,
       image_url = EXCLUDED.image_url,
       language = EXCLUDED.language,
       itunes_id = EXCLUDED.itunes_id,
       categories = EXCLUDED.categories,
       metadata = EXCLUDED.metadata,
       last_synced_at = now(),
       updated_at = now()
     RETURNING id`, [
        sourceId,
        feedId,
        feed.podcastGuid || null,
        cleanText(feed.title, 2000) || `Podcast ${feedId}`,
        feed.url || `https://podcastindex.org/podcast/${feedId}`,
        feed.link || null,
        feed.author || feed.ownerName || null,
        cleanText(feed.description, 20_000),
        feed.image || feed.artwork || null,
        feed.language || null,
        Number(feed.itunesId) || null,
        JSON.stringify(feed.categories || {}),
        JSON.stringify({ provider: "podcastindex" }),
    ]);
    const cursorResult = await (0, db_1.query)(`INSERT INTO source_feed (source_id, feed_key, params)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (source_id, feed_key) DO UPDATE SET params = EXCLUDED.params
     RETURNING id, source_id, feed_key, params, cursor`, [sourceId, `feed/${feedId}`, JSON.stringify({ feed_id: feedId, title: feed.title, url: feed.url })]);
    return { id: Number(rows[0].id), cursorFeed: cursorResult.rows[0] };
}
function extractUrls(text) {
    if (!text)
        return [];
    const values = [];
    const hrefPattern = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
    const plainPattern = /https?:\/\/[^\s<>"']+/gi;
    let match;
    while ((match = hrefPattern.exec(text)))
        values.push(match[1]);
    while ((match = plainPattern.exec(text)))
        values.push(match[0].replace(/[),.;]+$/, ""));
    return Array.from(new Set(values));
}
function classifyPlatform(url) {
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        if (host === "podcasts.apple.com" || host.endsWith(".podcasts.apple.com"))
            return "apple";
        if (host === "open.spotify.com" || host.endsWith(".spotify.com"))
            return "spotify";
        if (["youtube.com", "youtu.be", "music.youtube.com"].some((domain) => host === domain || host.endsWith(`.${domain}`)))
            return "youtube";
    }
    catch {
        return null;
    }
    return null;
}
function validHttpUrl(value) {
    if (typeof value !== "string" || !value.trim())
        return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
    }
    catch {
        return null;
    }
}
function externalLinks(feed, episode) {
    const out = [];
    const seen = new Set();
    const add = (platform, label, rawUrl) => {
        const url = validHttpUrl(rawUrl);
        if (!url || seen.has(`${platform}:${url}`))
            return;
        seen.add(`${platform}:${url}`);
        out.push({ platform, label, url });
    };
    const episodeLink = validHttpUrl(episode.link);
    if (episodeLink) {
        const platform = classifyPlatform(episodeLink);
        if (platform)
            add(platform, platform === "apple" ? "Apple Podcasts" : platform === "spotify" ? "Spotify" : "YouTube", episodeLink);
        else
            add("publisher", "Publisher", episodeLink);
    }
    else {
        add("publisher", "Publisher", feed.link);
    }
    const metadataUrls = [...extractUrls(episode.description), ...extractUrls(feed.description)];
    for (const url of metadataUrls) {
        const platform = classifyPlatform(url);
        if (platform)
            add(platform, platform === "apple" ? "Apple Podcasts" : platform === "spotify" ? "Spotify" : "YouTube", url);
    }
    const itunesId = Number(episode.feedItunesId || feed.itunesId);
    if (!out.some((link) => link.platform === "apple") && Number.isFinite(itunesId) && itunesId > 0) {
        add("apple", "Apple Podcasts", `https://podcasts.apple.com/podcast/id${itunesId}`);
    }
    const feedId = Number(episode.feedId || feed.id);
    if (Number.isFinite(feedId) && feedId > 0) {
        add("podcastindex", "Podcast Index", `https://podcastindex.org/podcast/${feedId}`);
    }
    return out;
}
function isPrivateIp(address) {
    const normalized = address.toLowerCase().split("%")[0];
    if (node_net_1.default.isIPv4(normalized)) {
        const [a, b] = normalized.split(".").map(Number);
        return a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168)) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224;
    }
    if (node_net_1.default.isIPv6(normalized)) {
        const mappedIpv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : "";
        if (node_net_1.default.isIPv4(mappedIpv4))
            return isPrivateIp(mappedIpv4);
        return normalized === "::" ||
            normalized === "::1" ||
            normalized.startsWith("fc") ||
            normalized.startsWith("fd") ||
            normalized.startsWith("fe8") ||
            normalized.startsWith("fe9") ||
            normalized.startsWith("fea") ||
            normalized.startsWith("feb") ||
            normalized.startsWith("ff");
    }
    return true;
}
async function assertPublicUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Transcript URL must use HTTP(S).");
    if (url.username || url.password)
        throw new Error("Transcript URL may not contain credentials.");
    const directIp = node_net_1.default.isIP(url.hostname);
    if (directIp && isPrivateIp(url.hostname))
        throw new Error("Transcript URL resolves to a private address.");
    if (!directIp) {
        const addresses = await promises_1.default.lookup(url.hostname, { all: true, verbatim: true });
        if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
            throw new Error("Transcript URL resolves to a private address.");
        }
    }
    return url;
}
async function readBoundedBody(response) {
    if (!response.body)
        return "";
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (!value)
            continue;
        total += value.byteLength;
        if (total > MAX_TRANSCRIPT_BYTES) {
            await reader.cancel();
            throw new Error(`Transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes.`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
async function fetchTranscript(urlValue) {
    let url = await assertPublicUrl(urlValue);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSCRIPT_TIMEOUT_MS);
    try {
        for (let redirect = 0; redirect <= 4; redirect += 1) {
            const response = await fetch(url, {
                headers: { "User-Agent": USER_AGENT, Accept: "application/json,text/vtt,application/x-subrip,text/plain,text/html;q=0.8" },
                redirect: "manual",
                signal: controller.signal,
            });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get("location");
                if (!location)
                    throw new Error(`Transcript redirect ${response.status} omitted Location.`);
                url = await assertPublicUrl(new URL(location, url).toString());
                continue;
            }
            if (!response.ok)
                throw new Error(`Transcript HTTP ${response.status}`);
            const contentLength = Number(response.headers.get("content-length"));
            if (Number.isFinite(contentLength) && contentLength > MAX_TRANSCRIPT_BYTES) {
                throw new Error(`Transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes.`);
            }
            return {
                body: await readBoundedBody(response),
                contentType: response.headers.get("content-type"),
                finalUrl: url.toString(),
            };
        }
        throw new Error("Transcript exceeded redirect limit.");
    }
    finally {
        clearTimeout(timeout);
    }
}
function timestampMs(raw) {
    const value = raw.trim().replace(",", ".");
    const parts = value.split(":");
    if (parts.length < 2 || parts.length > 3)
        return null;
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;
    if (![seconds, minutes, hours].every(Number.isFinite))
        return null;
    return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
}
function stripMarkup(value) {
    return value
        .replace(/<v\s+([^>]+)>/gi, "$1: ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}
function splitSpeaker(text) {
    const match = text.match(/^([\p{L}\p{N}][\p{L}\p{N} ._'’-]{0,80}):\s+(.+)$/u);
    if (!match)
        return { speaker: null, text };
    return { speaker: cleanText(match[1], 100), text: match[2].trim() };
}
function parseCaptionTranscript(body) {
    const normalized = body.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const blocks = normalized.split(/\n{2,}/);
    const segments = [];
    for (const block of blocks) {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const timingIndex = lines.findIndex((line) => line.includes("-->"));
        if (timingIndex < 0)
            continue;
        const timing = lines[timingIndex].split("-->");
        const start = timestampMs(timing[0]);
        const end = timestampMs(timing[1].split(/\s+/)[0]);
        const rawText = stripMarkup(lines.slice(timingIndex + 1).join(" "));
        if (start == null || !rawText)
            continue;
        const parsed = splitSpeaker(rawText);
        segments.push({ start_ms: start, end_ms: end, speaker: parsed.speaker, text: parsed.text.slice(0, 4000) });
    }
    return segments;
}
function parseJsonTranscript(body) {
    const parsed = JSON.parse(body);
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const values = Array.isArray(root.segments) ? root.segments : Array.isArray(parsed) ? parsed : [];
    const raw = [];
    for (const value of values) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            continue;
        const segment = value;
        const text = cleanText(segment.body ?? segment.text ?? segment.content, 4000);
        const startSeconds = Number(segment.startTime ?? segment.start ?? segment.start_time);
        const endSeconds = Number(segment.endTime ?? segment.end ?? segment.end_time);
        if (!text || !Number.isFinite(startSeconds) || startSeconds < 0)
            continue;
        raw.push({
            start_ms: Math.round(startSeconds * 1000),
            end_ms: Number.isFinite(endSeconds) && endSeconds >= startSeconds ? Math.round(endSeconds * 1000) : null,
            speaker: cleanText(segment.speaker, 100),
            text,
        });
    }
    const merged = [];
    for (const segment of raw) {
        const previous = merged[merged.length - 1];
        const gap = previous?.end_ms == null ? Number.POSITIVE_INFINITY : segment.start_ms - previous.end_ms;
        if (previous && previous.speaker === segment.speaker && gap <= 1500 && previous.text.length + segment.text.length < 700) {
            previous.text = `${previous.text}${/^[,.;!?]/.test(segment.text) ? "" : " "}${segment.text}`;
            previous.end_ms = segment.end_ms;
        }
        else {
            merged.push({ ...segment });
        }
    }
    return merged;
}
function parseHtmlTranscript(body) {
    const segments = [];
    const pattern = /(?:<cite[^>]*>([\s\S]*?)<\/cite>)?[\s\S]*?(?:<time[^>]*>([\s\S]*?)<\/time>)?[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pattern.exec(body))) {
        const text = stripMarkup(match[3]);
        if (!text)
            continue;
        segments.push({
            start_ms: timestampMs(stripMarkup(match[2] || "")) ?? 0,
            end_ms: null,
            speaker: cleanText(stripMarkup(match[1] || "").replace(/:$/, ""), 100),
            text: text.slice(0, 4000),
        });
    }
    if (segments.length)
        return segments;
    const text = stripMarkup(body);
    return text ? [{ start_ms: 0, end_ms: null, speaker: null, text: text.slice(0, 20_000) }] : [];
}
function parseTranscript(body, declaredType, responseType) {
    const type = `${declaredType || ""};${responseType || ""}`.toLowerCase();
    if (type.includes("json") || /^[\s\uFEFF]*[\[{]/.test(body)) {
        try {
            return parseJsonTranscript(body);
        }
        catch { /* try the declared fallback below */ }
    }
    if (type.includes("vtt") || type.includes("srt") || type.includes("subrip") || body.includes("-->")) {
        return parseCaptionTranscript(body);
    }
    if (type.includes("html") || /<(?:html|p|cite|time)\b/i.test(body))
        return parseHtmlTranscript(body);
    const text = stripMarkup(body);
    return text ? [{ start_ms: 0, end_ms: null, speaker: null, text: text.slice(0, 20_000) }] : [];
}
function transcriptCandidates(episode) {
    const candidates = Array.isArray(episode.transcripts) ? [...episode.transcripts] : [];
    if (episode.transcriptUrl && !candidates.some((item) => item.url === episode.transcriptUrl)) {
        candidates.push({ url: episode.transcriptUrl, type: null });
    }
    const rank = (value) => {
        const type = (value || "").toLowerCase();
        if (type.includes("json"))
            return 0;
        if (type.includes("vtt"))
            return 1;
        if (type.includes("srt") || type.includes("subrip"))
            return 2;
        if (type.includes("plain"))
            return 3;
        if (type.includes("html"))
            return 4;
        return 5;
    };
    return candidates.filter((item) => validHttpUrl(item.url)).sort((a, b) => rank(a.type) - rank(b.type));
}
async function upsertEpisode(sourceId, storedFeedId, feed, episode) {
    const podcastIndexId = Number(episode.id);
    const feedId = Number(episode.feedId || feed.id);
    if (!Number.isFinite(podcastIndexId) || podcastIndexId <= 0 || !Number.isFinite(feedId) || feedId <= 0)
        return null;
    const title = cleanText(episode.title, 2000) || "Untitled podcast episode";
    const summary = cleanText(episode.description, 20_000);
    const publishedAt = epochToIso(episode.datePublished);
    const links = externalLinks(feed, episode);
    const transcript = transcriptCandidates(episode)[0] || null;
    const externalId = `episode:${podcastIndexId}`;
    const dedupeHash = node_crypto_1.default.createHash("sha256").update(`podcastindex|${podcastIndexId}`).digest("hex");
    const payload = {
        provider: "podcastindex",
        podcast: {
            feed_id: feedId,
            title: episode.feedTitle || feed.title || `Podcast ${feedId}`,
            publisher: feed.author || feed.ownerName || null,
            categories: feed.categories || {},
        },
        image: episode.image || episode.feedImage || feed.image || feed.artwork || null,
        duration_seconds: Number(episode.duration) || null,
        transcript_available: Boolean(transcript),
        external_links: links,
    };
    return await (0, db_1.withTransaction)(async (client) => {
        const existing = await client.query(`SELECT i.id, pe.id AS episode_id, pe.transcript_status, pe.transcript_source_url
       FROM item i
       LEFT JOIN podcast_episode pe ON pe.item_id = i.id
       WHERE i.source_id = $1 AND i.external_id = $2
       LIMIT 1`, [sourceId, externalId]);
        const wasInserted = !existing.rows[0];
        const itemResult = await client.query(`INSERT INTO item (source_id, external_id, kind, title, summary, url, event_time, payload, dedupe_hash)
       VALUES ($1, $2, 'podcast_episode', $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (source_id, external_id)
       DO UPDATE SET
         kind = EXCLUDED.kind,
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         url = EXCLUDED.url,
         event_time = EXCLUDED.event_time,
         payload = EXCLUDED.payload,
         dedupe_hash = EXCLUDED.dedupe_hash,
         updated_at = now()
       RETURNING id`, [sourceId, externalId, title, summary, links.find((link) => link.platform === "publisher")?.url || episode.link || feed.link || null, publishedAt, JSON.stringify(payload), dedupeHash]);
        const itemId = Number(itemResult.rows[0].id);
        const episodeResult = await client.query(`INSERT INTO podcast_episode (
         item_id, feed_id, podcast_index_id, guid, duration_seconds, enclosure_url,
         image_url, transcript_status, transcript_source_url, transcript_mime_type,
         external_links, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
       ON CONFLICT (item_id)
       DO UPDATE SET
         feed_id = EXCLUDED.feed_id,
         guid = EXCLUDED.guid,
         image_url = EXCLUDED.image_url,
         duration_seconds = EXCLUDED.duration_seconds,
         enclosure_url = EXCLUDED.enclosure_url,
         transcript_source_url = EXCLUDED.transcript_source_url,
         transcript_mime_type = EXCLUDED.transcript_mime_type,
         transcript_status = CASE
           WHEN podcast_episode.transcript_source_url IS DISTINCT FROM EXCLUDED.transcript_source_url THEN EXCLUDED.transcript_status
           ELSE podcast_episode.transcript_status
         END,
         external_links = EXCLUDED.external_links,
         metadata = EXCLUDED.metadata,
         updated_at = now()
       RETURNING id`, [
            itemId, storedFeedId, podcastIndexId, episode.guid || null, Number(episode.duration) || null,
            episode.enclosureUrl || null, episode.image || episode.feedImage || feed.image || feed.artwork || null,
            transcript ? "pending" : "missing", transcript?.url || null, transcript?.type || null,
            JSON.stringify(links), JSON.stringify({ podcast_guid: episode.podcastGuid || feed.podcastGuid || null }),
        ]);
        return {
            itemId,
            episodeId: Number(episodeResult.rows[0].id),
            inserted: wasInserted,
            title,
            summary,
            transcript,
            transcriptAlreadyReady: existing.rows[0]?.transcript_status === "available" && existing.rows[0]?.transcript_source_url === transcript?.url,
        };
    });
}
async function storeTranscript(episodeId, transcript) {
    const url = validHttpUrl(transcript.url);
    if (!url)
        return 0;
    const fetched = await fetchTranscript(url);
    const segments = parseTranscript(fetched.body, transcript.type || null, fetched.contentType)
        .filter((segment) => segment.text.trim())
        .slice(0, 10_000);
    if (segments.length === 0)
        throw new Error("Transcript contained no usable segments.");
    return await (0, db_1.withTransaction)(async (client) => {
        await client.query(`DELETE FROM evidence_segment WHERE episode_id = $1`, [episodeId]);
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            await client.query(`INSERT INTO evidence_segment (
           episode_id, segment_index, start_ms, end_ms, speaker, text,
           source_url, mime_type, timing_method, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'source','{}'::jsonb)`, [episodeId, index, segment.start_ms, segment.end_ms, segment.speaker, segment.text, fetched.finalUrl, transcript.type || fetched.contentType]);
        }
        await client.query(`UPDATE podcast_episode
       SET transcript_status = 'available', transcript_source_url = $2,
           transcript_mime_type = COALESCE($3, transcript_mime_type), updated_at = now()
       WHERE id = $1`, [episodeId, fetched.finalUrl, transcript.type || fetched.contentType]);
        return segments.length;
    });
}
async function resolveFeeds(queries, feedIds, maxFeeds) {
    const feeds = new Map();
    for (const term of queries) {
        const response = await podcastIndexGet("/search/byterm", { q: term, max: maxFeeds, clean: 1 });
        for (const feed of response.feeds || []) {
            const id = Number(feed.id);
            if (Number.isFinite(id) && id > 0)
                feeds.set(id, feed);
        }
    }
    for (const id of feedIds) {
        if (feeds.has(id))
            continue;
        const response = await podcastIndexGet("/podcasts/byfeedid", { id });
        if (response.feed)
            feeds.set(id, response.feed);
    }
    return Array.from(feeds.values());
}
function configuredQueries() {
    const configured = (process.env.PODCAST_DISCOVERY_TERMS || "")
        .split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20);
    return configured.length > 0 ? configured : [...exports.DEFAULT_PODCAST_DISCOVERY_TERMS];
}
async function ingestPodcastIndex(params = {}) {
    const queriesInput = params.queries?.length
        ? params.queries
        : params.searchTerms?.length
            ? params.searchTerms
            : configuredQueries();
    const queries = Array.from(new Set(queriesInput.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
    const feedIds = Array.from(new Set((params.feedIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))).slice(0, 100);
    if (queries.length === 0 && feedIds.length === 0) {
        throw new Error("Provide feedIds/searchTerms or configure PODCAST_FEED_IDS/PODCAST_DISCOVERY_TERMS.");
    }
    const source = await ensureSource();
    const maxFeeds = clampInt(params.maxFeedsPerQuery ?? params.maxFeeds, 1, 20, 3);
    const maxEpisodes = clampInt(params.maxEpisodesPerFeed, 1, 50, 5);
    const shouldFetchTranscripts = params.fetchTranscripts !== false;
    const shouldProcess = params.processIntelligence !== false && params.extractIntelligence !== false;
    const feeds = await resolveFeeds(queries, feedIds, maxFeeds);
    const totals = {
        feeds_discovered: feeds.length, feeds: feeds.length, episodes_fetched: 0, episodes: 0,
        inserted: 0, updated: 0, skipped: 0, transcripts_ready: 0, transcript_failures: 0,
        evidence_segments: 0, entities: 0, findings: 0, intelligence_signals: 0,
    };
    for (const feed of feeds) {
        const feedId = Number(feed.id);
        if (!Number.isFinite(feedId) || feedId <= 0)
            continue;
        const storedFeed = await ensureFeed(source.id, feed);
        const cursor = storedFeed.cursorFeed.cursor && typeof storedFeed.cursorFeed.cursor === "object"
            ? storedFeed.cursorFeed.cursor
            : {};
        const cursorSince = Number(cursor.last_published_epoch);
        const since = Number.isFinite(params.since) && Number(params.since) > 0 ? Number(params.since) : cursorSince;
        const response = await podcastIndexGet("/episodes/byfeedid", {
            id: feedId,
            max: maxEpisodes,
            since: Number.isFinite(since) && since > 0 ? since : undefined,
            fulltext: 1,
        });
        const episodes = response.items || [];
        totals.episodes_fetched += episodes.length;
        totals.episodes += episodes.length;
        let newest = Number.isFinite(since) ? since : 0;
        for (const episode of episodes) {
            newest = Math.max(newest, Number(episode.datePublished) || 0);
            try {
                const stored = await upsertEpisode(source.id, storedFeed.id, feed, episode);
                if (!stored) {
                    totals.skipped += 1;
                    continue;
                }
                stored.inserted ? totals.inserted += 1 : totals.updated += 1;
                if (stored.transcriptAlreadyReady) {
                    totals.transcripts_ready += 1;
                }
                else if (shouldFetchTranscripts && stored.transcript?.url) {
                    try {
                        const segmentCount = await storeTranscript(stored.episodeId, stored.transcript);
                        totals.transcripts_ready += 1;
                        totals.evidence_segments += segmentCount;
                    }
                    catch (error) {
                        totals.transcript_failures += 1;
                        await (0, db_1.query)(`UPDATE podcast_episode SET transcript_status = 'failed', updated_at = now() WHERE id = $1`, [stored.episodeId]);
                        console.warn("Podcast transcript ingest failed", {
                            item_id: stored.itemId,
                            url: stored.transcript.url,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                if (shouldProcess) {
                    const signalCount = await (0, podcast_intelligence_1.extractPodcastIntelligence)(stored.episodeId, episode.persons || [], feed.categories || {});
                    totals.findings += signalCount;
                    totals.intelligence_signals += signalCount;
                }
            }
            catch (error) {
                totals.skipped += 1;
                console.warn("Podcast episode ingest failed", {
                    podcast_index_id: episode.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (newest > 0) {
            await (0, db_1.query)(`UPDATE source_feed SET cursor = $1::jsonb, updated_at = now() WHERE id = $2`, [JSON.stringify({ last_published_epoch: newest }), storedFeed.cursorFeed.id]);
        }
    }
    return totals;
}
async function discoverPodcastFeeds(searchTerm, max = 20) {
    const term = searchTerm.trim();
    if (!term)
        return [];
    const response = await podcastIndexGet("/search/byterm", {
        q: term,
        max: clampInt(max, 1, 50, 20),
        clean: 1,
    });
    return response.feeds || [];
}
function podcastParamsFromEnv(overrides = {}) {
    const envFeedIds = (process.env.PODCAST_FEED_IDS || "")
        .split(",").map(Number).filter((value) => Number.isSafeInteger(value) && value > 0);
    const envTerms = configuredQueries();
    return {
        ...overrides,
        feedIds: overrides.feedIds?.length ? overrides.feedIds : envFeedIds,
        searchTerms: overrides.searchTerms?.length ? overrides.searchTerms : envTerms,
        maxFeeds: overrides.maxFeeds ?? clampInt(process.env.PODCAST_MAX_FEEDS, 1, 20, 3),
        maxEpisodesPerFeed: overrides.maxEpisodesPerFeed ?? clampInt(process.env.PODCAST_MAX_EPISODES_PER_FEED, 1, 50, 5),
    };
}
