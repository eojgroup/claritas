import crypto from "node:crypto";
import { query } from "../db";
import { inferNewsCountry } from "./country-inference";

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

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  return match ? decodeXml(match[1]) : null;
}

function link(block: string): string | null {
  const value = tag(block, "link");
  if (value) return value;
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i.exec(block);
  return atom?.[1] ? decodeXml(atom[1]) : null;
}

export function feedItems(xml: string): string[] {
  const rss = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return rss.length ? rss : [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
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
      for (const block of feedItems(await response.text())) {
        const title = tag(block, "title");
        const url = link(block);
        if (!title || !url) { skipped += 1; continue; }
        const summary = tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content");
        const publishedRaw = tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated");
        const parsed = publishedRaw ? Date.parse(publishedRaw) : Number.NaN;
        const eventTime = Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
        const inference = inferNewsCountry({ title, summary, url, feedCountryHint: feed.sourceCountryIso2 });
        if (inference.iso2) {
          await query(`INSERT INTO country (iso2, name) VALUES ($1::char(2), $1) ON CONFLICT (iso2) DO NOTHING`, [inference.iso2]);
        }
        const externalId = tag(block, "guid") ?? tag(block, "id") ?? url;
        const result = await query<{ inserted: boolean }>(
          `INSERT INTO item (
             source_id, external_id, kind, title, summary, url, country_iso2, event_time,
             payload, dedupe_hash, language_code, source_country_iso2
           ) VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title, summary = EXCLUDED.summary, url = EXCLUDED.url,
             country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2),
             event_time = COALESCE(EXCLUDED.event_time, item.event_time),
             payload = EXCLUDED.payload, dedupe_hash = EXCLUDED.dedupe_hash,
             language_code = EXCLUDED.language_code, source_country_iso2 = EXCLUDED.source_country_iso2,
             updated_at = now()
           WHERE item.title IS DISTINCT FROM EXCLUDED.title
              OR item.summary IS DISTINCT FROM EXCLUDED.summary
              OR item.url IS DISTINCT FROM EXCLUDED.url
              OR item.country_iso2 IS DISTINCT FROM COALESCE(EXCLUDED.country_iso2, item.country_iso2)
              OR item.event_time IS DISTINCT FROM COALESCE(EXCLUDED.event_time, item.event_time)
              OR item.payload IS DISTINCT FROM EXCLUDED.payload
              OR item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
              OR item.language_code IS DISTINCT FROM EXCLUDED.language_code
              OR item.source_country_iso2 IS DISTINCT FROM EXCLUDED.source_country_iso2
           RETURNING (xmax = 0) AS inserted`,
          [sourceId, externalId, title, summary, url, inference.iso2, eventTime,
           JSON.stringify({
             provider: "institutional_rss", source: feed.publisher, publisher: feed.publisher,
             feed: feed.id, feed_url: feed.url, publisher_url: feed.homepage,
             attribution: feed.attribution, license: feed.license, license_url: feed.licenseUrl,
             topics: feed.topics, country_inference: inference,
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
  return { provider: "institutional_rss", inserted, updated, unchanged, skipped, feeds: INSTITUTIONAL_RSS_FEEDS.length, failures };
}
