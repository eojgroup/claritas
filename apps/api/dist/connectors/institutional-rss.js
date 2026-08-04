"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestInstitutionalRss = ingestInstitutionalRss;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const country_inference_1 = require("./country-inference");
const FEEDS = [
    {
        id: "european_commission_press_corner", publisher: "European Commission",
        url: "https://ec.europa.eu/commission/presscorner/api/rss?language=en&documenttype=&policyarea=&commissioner=&pagesize=20",
        homepage: "https://ec.europa.eu/commission/presscorner/home/en", sourceCountryIso2: null,
        attribution: "European Union, European Commission Press Corner", license: "CC BY 4.0 unless otherwise indicated",
    },
    {
        id: "federal_reserve_press_releases", publisher: "Federal Reserve Board",
        url: "https://www.federalreserve.gov/feeds/press_all.xml", homepage: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
        sourceCountryIso2: "US", attribution: "Board of Governors of the Federal Reserve System",
        license: "U.S. government public-domain information unless otherwise indicated",
    },
    {
        id: "sec_press_releases", publisher: "U.S. Securities and Exchange Commission",
        url: "https://www.sec.gov/news/pressreleases.rss", homepage: "https://www.sec.gov/newsroom/press-releases",
        sourceCountryIso2: "US", attribution: "U.S. Securities and Exchange Commission",
        license: "U.S. government public-domain information unless otherwise indicated",
    },
];
function decodeXml(value) {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/\s+/g, " ").trim();
}
function tag(block, name) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
    return match ? decodeXml(match[1]) : null;
}
function link(block) {
    const value = tag(block, "link");
    if (value)
        return value;
    const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i.exec(block);
    return atom?.[1] ? decodeXml(atom[1]) : null;
}
function feedItems(xml) {
    const rss = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
    return rss.length ? rss : [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
}
async function ensureSource() {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('institutional_rss', 'https://claritas.info/sources/institutional-rss', 'none', $1::jsonb)
     ON CONFLICT (name) DO UPDATE SET metadata = EXCLUDED.metadata
     RETURNING id`, [JSON.stringify({
            provider: "institutional_rss", source_kind: "primary_source_news",
            attribution: "Publisher shown on every item", feeds: FEEDS.map(({ id, publisher, homepage, license }) => ({ id, publisher, homepage, license })),
        })]);
    return rows[0].id;
}
async function ingestInstitutionalRss() {
    const sourceId = await ensureSource();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const failures = [];
    for (const feed of FEEDS) {
        try {
            const response = await fetch(feed.url, {
                headers: {
                    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
                    "user-agent": process.env.SEC_EDGAR_USER_AGENT?.trim() || process.env.APP_USER_AGENT?.trim() || "Claritas contact@claritas.info",
                },
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            for (const block of feedItems(await response.text())) {
                const title = tag(block, "title");
                const url = link(block);
                if (!title || !url) {
                    skipped += 1;
                    continue;
                }
                const summary = tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content");
                const publishedRaw = tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated");
                const parsed = publishedRaw ? Date.parse(publishedRaw) : Number.NaN;
                const eventTime = Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
                const inference = (0, country_inference_1.inferNewsCountry)({ title, summary, url, feedCountryHint: feed.sourceCountryIso2 });
                if (inference.iso2) {
                    await (0, db_1.query)(`INSERT INTO country (iso2, name) VALUES ($1::char(2), $1) ON CONFLICT (iso2) DO NOTHING`, [inference.iso2]);
                }
                const externalId = tag(block, "guid") ?? tag(block, "id") ?? url;
                const result = await (0, db_1.query)(`INSERT INTO item (
             source_id, external_id, kind, title, summary, url, country_iso2, event_time,
             payload, dedupe_hash, language_code, source_country_iso2
           ) VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9,'en',$10)
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title, summary = EXCLUDED.summary, url = EXCLUDED.url,
             country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2), event_time = EXCLUDED.event_time,
             payload = EXCLUDED.payload, dedupe_hash = EXCLUDED.dedupe_hash,
             language_code = EXCLUDED.language_code, source_country_iso2 = EXCLUDED.source_country_iso2,
             updated_at = now()
           RETURNING (xmax = 0) AS inserted`, [sourceId, externalId, title, summary, url, inference.iso2, eventTime,
                    JSON.stringify({
                        provider: "institutional_rss", source: feed.publisher, publisher: feed.publisher,
                        feed: feed.id, feed_url: feed.url, publisher_url: feed.homepage,
                        attribution: feed.attribution, license: feed.license, country_inference: inference,
                    }), node_crypto_1.default.createHash("sha256").update(`${url}|${eventTime}|${feed.id}`).digest("hex"), feed.sourceCountryIso2]);
                if (result.rows[0]?.inserted)
                    inserted += 1;
                else
                    updated += 1;
            }
        }
        catch (error) {
            failures.push({ feed: feed.id, error: error instanceof Error ? error.message : String(error) });
        }
    }
    if (failures.length === FEEDS.length)
        throw new Error(`All institutional RSS feeds failed: ${failures.map((failure) => `${failure.feed}: ${failure.error}`).join("; ")}`);
    return { provider: "institutional_rss", inserted, updated, skipped, feeds: FEEDS.length, failures };
}
