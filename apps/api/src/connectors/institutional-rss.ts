import crypto from "node:crypto";
import { query } from "../db";
import {
  inferNewsCountry,
  trustedSubjectCountryIso2,
  type CountryInferenceResult,
} from "./country-inference";

export type InstitutionalFeed = {
  id: string;
  publisher: string;
  url: string;
  homepage: string;
  sourceCountryIso2: string | null;
  languageCode: string;
  topics: string[];
  attribution: string;
  license: string;
  licenseUrl: string;
};

export const INSTITUTIONAL_RSS_FEEDS: InstitutionalFeed[] = [
  {
    id: "european_commission_press_corner", publisher: "European Commission",
    url: "https://ec.europa.eu/commission/presscorner/api/rss?language=en&documenttype=&policyarea=&commissioner=&pagesize=20",
    homepage: "https://ec.europa.eu/commission/presscorner/home/en", sourceCountryIso2: null,
    languageCode: "en", topics: ["eu_policy", "institutional_release"],
    attribution: "European Union, European Commission Press Corner", license: "CC BY 4.0 unless otherwise indicated",
    licenseUrl: "https://commission.europa.eu/legal-notice_en",
  },
  {
    id: "federal_reserve_press_releases", publisher: "Federal Reserve Board",
    url: "https://www.federalreserve.gov/feeds/press_all.xml", homepage: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
    sourceCountryIso2: "US", attribution: "Board of Governors of the Federal Reserve System",
    languageCode: "en", topics: ["monetary_policy", "banking", "macro_news"],
    license: "U.S. government public-domain information unless otherwise indicated",
    licenseUrl: "https://www.federalreserve.gov/disclaimer.htm",
  },
  {
    id: "sec_press_releases", publisher: "U.S. Securities and Exchange Commission",
    url: "https://www.sec.gov/news/pressreleases.rss", homepage: "https://www.sec.gov/newsroom/press-releases",
    sourceCountryIso2: "US", attribution: "U.S. Securities and Exchange Commission",
    languageCode: "en", topics: ["securities_regulation", "enforcement", "market_structure"],
    license: "U.S. government public-domain information unless otherwise indicated",
    licenseUrl: "https://www.sec.gov/about/privacy-information",
  },
  {
    id: "bls_employment_situation", publisher: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/empsit.rss", homepage: "https://www.bls.gov/feed/",
    sourceCountryIso2: "US", languageCode: "en",
    topics: ["employment", "labor_market", "macro_news"],
    attribution: "U.S. Bureau of Labor Statistics",
    license: "U.S. government public domain; cite BLS as the source",
    licenseUrl: "https://www.bls.gov/opub/copyright-information.htm",
  },
  {
    id: "bls_consumer_price_index", publisher: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/cpi.rss", homepage: "https://www.bls.gov/feed/",
    sourceCountryIso2: "US", languageCode: "en",
    topics: ["inflation", "consumer_prices", "macro_news"],
    attribution: "U.S. Bureau of Labor Statistics",
    license: "U.S. government public domain; cite BLS as the source",
    licenseUrl: "https://www.bls.gov/opub/copyright-information.htm",
  },
  {
    id: "bls_producer_price_index", publisher: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/ppi.rss", homepage: "https://www.bls.gov/feed/",
    sourceCountryIso2: "US", languageCode: "en",
    topics: ["inflation", "producer_prices", "macro_news"],
    attribution: "U.S. Bureau of Labor Statistics",
    license: "U.S. government public domain; cite BLS as the source",
    licenseUrl: "https://www.bls.gov/opub/copyright-information.htm",
  },
  {
    id: "bls_job_openings", publisher: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/jolts.rss", homepage: "https://www.bls.gov/feed/",
    sourceCountryIso2: "US", languageCode: "en",
    topics: ["job_openings", "labor_market", "macro_news"],
    attribution: "U.S. Bureau of Labor Statistics",
    license: "U.S. government public domain; cite BLS as the source",
    licenseUrl: "https://www.bls.gov/opub/copyright-information.htm",
  },
  {
    id: "ecb_press_releases", publisher: "European Central Bank",
    url: "https://www.ecb.europa.eu/rss/press.html", homepage: "https://www.ecb.europa.eu/home/html/rss.en.html",
    sourceCountryIso2: null, languageCode: "en",
    topics: ["monetary_policy", "financial_stability", "euro_area"],
    attribution: "European Central Bank",
    license: "Free use with accurate reproduction, ECB attribution, and free-source notice for paid access",
    licenseUrl: "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html",
  },
  {
    id: "ecb_statistical_press_releases", publisher: "European Central Bank",
    url: "https://www.ecb.europa.eu/rss/statpress.html", homepage: "https://www.ecb.europa.eu/home/html/rss.en.html",
    sourceCountryIso2: null, languageCode: "en",
    topics: ["economic_statistics", "financial_stability", "euro_area"],
    attribution: "European Central Bank",
    license: "Free use with accurate reproduction, ECB attribution, and free-source notice for paid access",
    licenseUrl: "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html",
  },
];

export function parseInstitutionalPublicationTime(
  value: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60_000) return null;
  return new Date(parsed).toISOString();
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
      if (code.startsWith("#")) {
        const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
        // Malformed provider copy must not throw and discard the rest of a
        // healthy feed, nor introduce NUL/surrogates into PostgreSQL text.
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point) : "\ufffd";
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[code.toLowerCase()] ?? entity;
    })
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u0000/g, "\ufffd")
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  return match ? decodeXml(match[1]) : null;
}

function articleUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    return url.toString();
  } catch { return null; }
}

function link(block: string, baseUrl: string): string | null {
  const value = tag(block, "link");
  if (value) return articleUrl(value, baseUrl);
  // Atom often lists a self link or audio enclosure before the article.
  // Only the alternate HTML representation is a reader destination.
  for (const atom of block.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(Array.from(atom[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g))
      .map((match) => [match[1].toLowerCase(), match[2]]));
    if (attributes.rel && attributes.rel.toLowerCase() !== "alternate") continue;
    if (attributes.type && !["text/html", "application/xhtml+xml"].includes(attributes.type.toLowerCase())) continue;
    const url = articleUrl(attributes.href ? decodeXml(attributes.href) : null, baseUrl);
    if (url) return url;
  }
  return null;
}

export function feedItems(xml: string): string[] {
  const pattern = /<item\b/i.test(xml) ? /<item\b[^>]*>([\s\S]*?)<\/item>/gi : /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  const items: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    items.push(match[1]);
    if (items.length >= 200) break;
  }
  return items;
}

export function parseInstitutionalFeedItem(block: string, baseUrl: string): {
  title: string; url: string; summary: string | null; publishedRaw: string | null; externalId: string;
} | null {
  const title = tag(block, "title")?.slice(0, 2_000);
  const url = link(block, baseUrl);
  if (!title || !url) return null;
  const externalId = tag(block, "guid") || tag(block, "id") || url;
  return {
    title, url,
    summary: (tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content"))?.slice(0, 10_000) ?? null,
    publishedRaw: tag(block, "pubDate") ?? tag(block, "published"),
    externalId: Buffer.byteLength(externalId) <= 2_000
      ? externalId : `sha256:${crypto.createHash("sha256").update(externalId).digest("hex")}`,
  };
}

export async function readInstitutionalFeed(response: Response): Promise<string> {
  const maxBytes = 5_000_000;
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Institutional feed exceeds size limit.");
  }
  if (!response.body) throw new Error("Institutional feed response has no body.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Institutional feed exceeds size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size).toString("utf8");
}

export function institutionalSubjectGeography(
  inference: CountryInferenceResult,
  jurisdictionIso2: string | null,
): { primary: string | null; countries: string[]; attribution: string } {
  const inferredSubject = trustedSubjectCountryIso2(inference);
  const jurisdiction = /^[A-Z]{2}$/.test(jurisdictionIso2?.trim().toUpperCase() ?? "")
    ? jurisdictionIso2!.trim().toUpperCase()
    : null;
  const countries = Array.from(new Set([
    ...(inferredSubject ? [inferredSubject] : []),
    ...(jurisdiction ? [jurisdiction] : []),
  ]));
  return {
    primary: inferredSubject ?? jurisdiction,
    countries,
    attribution: inferredSubject
      ? inference.source
      : jurisdiction
        ? "institutional_jurisdiction"
        : inference.source,
  };
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `WITH upsert AS (
       INSERT INTO source (name, api_base_url, auth_type, metadata)
       VALUES ('institutional_rss', 'https://claritas.info/sources/institutional-rss', 'none', $1::jsonb)
       ON CONFLICT (name) DO UPDATE SET
         api_base_url = EXCLUDED.api_base_url,
         auth_type = EXCLUDED.auth_type,
         metadata = EXCLUDED.metadata
       WHERE source.api_base_url IS DISTINCT FROM EXCLUDED.api_base_url
          OR source.auth_type IS DISTINCT FROM EXCLUDED.auth_type
          OR source.metadata IS DISTINCT FROM EXCLUDED.metadata
       RETURNING id
     )
     SELECT id FROM upsert
     UNION ALL
     SELECT id FROM source WHERE name = 'institutional_rss'
     LIMIT 1`,
    [JSON.stringify({
      provider: "institutional_rss", source_kind: "primary_source_news",
      attribution: "Publisher shown on every item",
      feeds: INSTITUTIONAL_RSS_FEEDS.map(({ id, publisher, homepage, license, licenseUrl, topics }) => ({
        id, publisher, homepage, license, license_url: licenseUrl, topics,
      })),
    })]
  );
  return rows[0].id;
}

export async function ingestInstitutionalRss(): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let latestEventTime: string | null = null;
  const failures: Array<{ feed: string; error: string }> = [];
  for (const feed of INSTITUTIONAL_RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "user-agent": process.env.SEC_EDGAR_USER_AGENT?.trim() || process.env.APP_USER_AGENT?.trim() || "Claritas contact@claritas.info",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      for (const block of feedItems(await readInstitutionalFeed(response))) {
        const item = parseInstitutionalFeedItem(block, feed.url);
        if (!item) { skipped += 1; continue; }
        const { title, url, summary, publishedRaw, externalId } = item;
        const eventTime = parseInstitutionalPublicationTime(publishedRaw);
        if (eventTime && (!latestEventTime || eventTime > latestEventTime)) latestEventTime = eventTime;
        const inference = inferNewsCountry({ title, summary, url, feedCountryHint: feed.sourceCountryIso2 });
        const subjectGeography = institutionalSubjectGeography(inference, feed.sourceCountryIso2);
        for (const subjectCountry of subjectGeography.countries) {
          await query(`INSERT INTO country (iso2, name) VALUES ($1::char(2), $1) ON CONFLICT (iso2) DO NOTHING`, [subjectCountry]);
        }
        const result = await query<{ inserted: boolean }>(
          `INSERT INTO item (
             source_id, external_id, kind, title, summary, url, country_iso2, event_time,
             payload, dedupe_hash, language_code, source_country_iso2
           ) VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title, summary = EXCLUDED.summary, url = EXCLUDED.url,
             country_iso2 = EXCLUDED.country_iso2,
             event_time = COALESCE(EXCLUDED.event_time, item.event_time),
             payload = EXCLUDED.payload, dedupe_hash = EXCLUDED.dedupe_hash,
             language_code = EXCLUDED.language_code, source_country_iso2 = EXCLUDED.source_country_iso2,
             updated_at = now()
           WHERE item.title IS DISTINCT FROM EXCLUDED.title
              OR item.summary IS DISTINCT FROM EXCLUDED.summary
              OR item.url IS DISTINCT FROM EXCLUDED.url
              OR item.country_iso2 IS DISTINCT FROM EXCLUDED.country_iso2
              OR item.event_time IS DISTINCT FROM COALESCE(EXCLUDED.event_time, item.event_time)
              OR item.payload IS DISTINCT FROM EXCLUDED.payload
              OR item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
              OR item.language_code IS DISTINCT FROM EXCLUDED.language_code
              OR item.source_country_iso2 IS DISTINCT FROM EXCLUDED.source_country_iso2
           RETURNING (xmax = 0) AS inserted`,
          [sourceId, externalId, title, summary, url, subjectGeography.primary, eventTime,
           JSON.stringify({
             provider: "institutional_rss", source: feed.publisher, publisher: feed.publisher,
             feed: feed.id, feed_url: feed.url, publisher_url: feed.homepage,
             attribution: feed.attribution, license: feed.license, license_url: feed.licenseUrl,
             topics: feed.topics, country_inference: inference,
             subject_country_iso2s: subjectGeography.countries,
             country_attribution: subjectGeography.attribution,
             time_basis: eventTime ? "publisher_published" : "unavailable",
             time_precision: eventTime ? "source_provided" : "unavailable",
             publisher_published_at: eventTime,
           }), crypto.createHash("sha256").update(`${url}|${eventTime}|${feed.id}`).digest("hex"),
           feed.languageCode, feed.sourceCountryIso2]
        );
        if (!result.rows[0]) unchanged += 1;
        else if (result.rows[0].inserted) inserted += 1;
        else updated += 1;
      }
    } catch (error) {
      failures.push({ feed: feed.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failures.length === INSTITUTIONAL_RSS_FEEDS.length) throw new Error(`All institutional RSS feeds failed: ${failures.map((failure) => `${failure.feed}: ${failure.error}`).join("; ")}`);
  return {
    provider: "institutional_rss",
    health: failures.length > 0 ? "degraded" : "healthy",
    inserted,
    updated,
    unchanged,
    skipped,
    latest_event_time: latestEventTime,
    feeds: INSTITUTIONAL_RSS_FEEDS.length,
    failures,
  };
}
