import crypto from "node:crypto";
import { unzipSync } from "fflate";
import worldCountries from "world-countries";
import { query } from "../db";
import { inferNewsCountry } from "./country-inference";

const DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_DATA_BASE_URL = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv2";
const GAL_RSS_URL = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv3/gal/feed.rss";
export const DEFAULT_GDELT_DOC_QUERY = "(geopolitics OR security OR technology OR markets OR climate OR energy OR disaster OR emergency OR shipping OR transport OR logistics OR agriculture OR food OR \"public health\")";
const ATTRIBUTION = "GDELT Project";

type GdeltDocArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

type GdeltDocResponse = { articles?: GdeltDocArticle[] };

export type GdeltGalArticle = {
  title: string;
  url: string;
  eventTime: string;
  domain: string;
  relevanceScore: number;
};

export type GdeltIngestParams = {
  query?: string;
  timespan?: string;
  maxRecords?: number;
  maxRawRows?: number;
  includeDoc?: boolean;
  includeEvents?: boolean;
  includeGkg?: boolean;
};

export type GdeltGlobalEvent = {
  id: number;
  external_id: string;
  event_code: string | null;
  event_root_code: string | null;
  quad_class: number | null;
  goldstein_scale: number | null;
  avg_tone: number | null;
  actor1_name: string | null;
  actor2_name: string | null;
  country: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  mention_count: number | null;
  source_count: number | null;
  article_count: number | null;
  event_time: string;
  url: string | null;
  payload?: unknown;
};

export type GdeltNewsSignal = {
  id: number;
  external_id: string;
  url: string | null;
  domain: string | null;
  language_code: string | null;
  country: string | null;
  tone: number | null;
  positive_score: number | null;
  negative_score: number | null;
  polarity: number | null;
  themes: string[];
  persons: string[];
  organizations: string[];
  locations: Array<Record<string, unknown>>;
  event_time: string;
};

const LANGUAGE_CODES: Record<string, string> = {
  afrikaans: "af", albanian: "sq", arabic: "ar", armenian: "hy", azerbaijani: "az",
  bengali: "bn", bosnian: "bs", bulgarian: "bg", catalan: "ca", chinese: "zh",
  croatian: "hr", czech: "cs", danish: "da", dutch: "nl", english: "en",
  estonian: "et", finnish: "fi", french: "fr", georgian: "ka", german: "de",
  greek: "el", gujarati: "gu", hebrew: "he", hindi: "hi", hungarian: "hu",
  icelandic: "is", indonesian: "id", italian: "it", japanese: "ja", kannada: "kn",
  kazakh: "kk", korean: "ko", latvian: "lv", lithuanian: "lt", macedonian: "mk",
  malay: "ms", malayalam: "ml", marathi: "mr", norwegian: "no", persian: "fa",
  polish: "pl", portuguese: "pt", punjabi: "pa", romanian: "ro", russian: "ru",
  serbian: "sr", slovak: "sk", slovenian: "sl", spanish: "es", swahili: "sw",
  swedish: "sv", tamil: "ta", telugu: "te", thai: "th", turkish: "tr",
  ukrainian: "uk", urdu: "ur", uzbek: "uz", vietnamese: "vi", welsh: "cy",
};

// GDELT geography uses FIPS 10-4 country codes. Most codes overlap ISO-2,
// while these common differences must be translated before linking countries.
const FIPS_TO_ISO2: Record<string, string> = {
  AG: "DZ", AJ: "AZ", AM: "AM", AQ: "AS", AS: "AU", AU: "AT", BA: "BH",
  BF: "BS", BG: "BD", BO: "BY", BP: "SB", BU: "BG", BX: "BN", CB: "KH",
  CD: "TD", CE: "LK", CH: "CN", CI: "CL", CO: "CO", CS: "CR", CT: "CF",
  DA: "DK", DR: "DO", EC: "EC", EI: "IE", EK: "GQ", EN: "EE", ER: "ER",
  ES: "SV", ET: "ET", EZ: "CZ", FG: "GF", FI: "FI", FP: "PF", FR: "FR",
  GB: "GA", GG: "GE", GH: "GH", GM: "DE", GR: "GR", GV: "GN", GY: "GY",
  HO: "HN", HR: "HR", HU: "HU", IC: "IS", ID: "ID", IN: "IN", IR: "IR",
  IS: "IL", IT: "IT", IV: "CI", IZ: "IQ", JA: "JP", JM: "JM", JO: "JO",
  KE: "KE", KG: "KG", KN: "KP", KS: "KR", KU: "KW", KZ: "KZ", LE: "LB",
  LG: "LV", LH: "LT", LI: "LR", LO: "SK", LT: "LS", LU: "LU", LY: "LY",
  MA: "MG", MG: "MN", MI: "MW", MJ: "ME", MK: "MK", MO: "MA", MP: "MU",
  MR: "MR", MU: "OM", MY: "MY", MZ: "MZ", NG: "NE", NH: "VU", NI: "NG",
  NL: "NL", NO: "NO", NP: "NP", NS: "SR", NU: "NI", NZ: "NZ", PA: "PY",
  PE: "PE", PK: "PK", PL: "PL", PO: "PT", PP: "PG", QA: "QA", RI: "RS",
  RM: "MH", RO: "RO", RP: "PH", RS: "RU", RW: "RW", SA: "SA", SE: "SC",
  SF: "ZA", SG: "SN", SI: "SI", SL: "SL", SN: "SG", SO: "SO", SP: "ES",
  SU: "SD", SW: "SE", SY: "SY", SZ: "CH", TH: "TH", TI: "TJ", TN: "TO",
  TS: "TN", TU: "TR", TX: "TM", TZ: "TZ", UG: "UG", UK: "GB", UP: "UA",
  US: "US", UV: "BF", UY: "UY", UZ: "UZ", VE: "VE", VM: "VN", WA: "NA",
  WI: "EH", WZ: "SZ", YM: "YE", ZA: "ZM", ZI: "ZW",
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), min), max) : fallback;
}

function asNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmpty(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function parseGdeltTimestamp(value: string | undefined): string | null {
  const raw = value?.replace(/[^0-9]/g, "") ?? "";
  if (raw.length >= 14) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  // Do not manufacture a current timestamp for malformed provider data. A
  // fabricated `now` value makes a stale feed look healthy and can move old
  // articles to the top of the news stream.
  return null;
}

function normalizeLanguage(value?: string | null): string | null {
  const language = value?.trim().toLowerCase();
  if (!language) return null;
  return LANGUAGE_CODES[language] ?? (language.length === 2 ? language : null);
}

function countryNameToIso2(value?: string | null): string | null {
  const name = value?.trim().toLowerCase();
  if (!name) return null;
  const match = worldCountries.find(
    (country) =>
      country.cca2.toLowerCase() === name ||
      country.cca3.toLowerCase() === name ||
      country.name.common.toLowerCase() === name ||
      country.name.official.toLowerCase() === name ||
      country.altSpellings?.some((spelling) => spelling.toLowerCase() === name)
  );
  return match?.cca2 ?? null;
}

function gdeltCountryToIso2(value?: string | null): string | null {
  const code = value?.trim().toUpperCase();
  if (!code) return null;
  if (FIPS_TO_ISO2[code]) return FIPS_TO_ISO2[code];
  if (code.length === 3) return worldCountries.find((country) => country.cca3 === code)?.cca2 ?? null;
  return worldCountries.some((country) => country.cca2 === code) ? code : null;
}

function hostnameFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function rssTag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  return match ? nonEmpty(decodeXml(match[1])) : null;
}

const GAL_RELEVANCE_PATTERNS: RegExp[] = [
  /\b(?:wars?|warfare|wartime|conflicts?|attacks?|attacked|attacking|strikes?|struck|striking|military|defen[cs]e|weapons?|missiles?|drones?|security|terror(?:ism|ist|ists)?|coups?|protests?|unrest|ceasefires?|sanctions?)\b/i,
  /\b(?:government|minister|president|parliament|election|diplomat|ambassador|treaty|policy|regulat|court|rights?)\w*\b/i,
  /\b(?:markets?|marketplace|economy|economic|economics|inflation|interest rates?|central banks?|currenc(?:y|ies)|trade|trades|traded|trading|tariffs?|commodit(?:y|ies)|oil|gas|gasoline|energy|supply chains?)\b/i,
  /\b(?:technology|artificial intelligence|\bAI\b|cyber|semiconductor|telecom|satellite|space|data breach)\w*\b/i,
  /\b(?:climate|wildfire|fire|flood|storm|hurricane|typhoon|cyclone|earthquake|drought|heatwave|disaster|emergency)\w*\b/i,
  /\b(?:shipping|vessel|ship|port|aviation|airline|airport|rail|pipeline|transport|logistics|strait|canal)\w*\b/i,
  /\b(?:outbreak|epidemic|pandemic|public health|vaccine|disease|hospital)\w*\b/i,
];

const GAL_NON_ARTICLE_PATH = /\/(?:author|authors|tag|tags|category|categories|search|profile|profiles|topic|topics|archive|archives)(?:\/|$)/i;
const GAL_LOW_VALUE_TITLE = /^(?:home|homepage|latest news|news|world|sports|weather|login|sign in|subscribe|contact us|about us|privacy policy)$/i;
const GAL_ENGLISH_HINT = /\b(?:a|an|the|and|or|of|to|in|on|for|from|with|after|before|amid|over|against|as|at|by|is|are|was|were|has|have|had|will|would|could|should|new|says?|warns?|reports?|launches?|hits?|closes?|opens?|near|government|security|update)\b/i;
const GAL_CLEAR_NON_ENGLISH_HINT = /\b(?:esto|esta|estos|estas|gasta|porque|porqué|cómo|cuando|donde|warum|wieso|während|über|gegenüber|pourquoi|comment|aujourd'hui|perché|dove|quando)\b/i;
const GAL_COMMON_NON_ENGLISH_WORD = /\b(?:el|la|los|las|del|que|por|para|con|una|der|die|das|den|dem|des|ein|eine|einer|und|oder|von|zum|zur|mit|nach|le|les|des|du|une|et|pour|avec|dans|sur|après|il|gli|della|delle|che|per|con|em|dos|das|uma|que)\b/gi;

export function isLikelyEnglishGalTitle(title: string): boolean {
  if (GAL_CLEAR_NON_ENGLISH_HINT.test(title)) return false;
  const nonEnglishHints = title.match(GAL_COMMON_NON_ENGLISH_WORD)?.length ?? 0;
  return nonEnglishHints < 2 && GAL_ENGLISH_HINT.test(title);
}

function galRelevanceScore(title: string): number {
  return GAL_RELEVANCE_PATTERNS.reduce((score, pattern) => {
    // Count matching signal terms, not only matching topic buckets. Otherwise
    // a generic two-bucket title such as "Port security update" can outrank a
    // materially denser title containing strike, attack, military and port.
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return score + (title.match(new RegExp(pattern.source, flags))?.length ?? 0);
  }, 0);
}

function usableGalUrl(value: string): { url: string; domain: string } | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || GAL_NON_ARTICLE_PATH.test(url.pathname)) return null;
    if (url.pathname === "/" || url.pathname.length < 5) return null;
    return { url: url.toString(), domain: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

export function parseGdeltGalRss(xml: string, options: {
  limit?: number;
  now?: Date;
  maxAgeHours?: number;
} = {}): { articles: GdeltGalArticle[]; feed_items: number; skipped: number } {
  const limit = clampInt(options.limit, 1, 250, 25);
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = clampInt(options.maxAgeHours, 1, 168, 48) * 3_600_000;
  const candidates = new Map<string, GdeltGalArticle>();
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, 20_000);
  let skipped = 0;
  for (const match of blocks) {
    const title = rssTag(match[1], "title");
    const rawUrl = rssTag(match[1], "link");
    const rawTime = rssTag(match[1], "pubDate");
    const parsedTime = rawTime ? Date.parse(rawTime) : Number.NaN;
    const usableUrl = rawUrl ? usableGalUrl(rawUrl) : null;
    const relevanceScore = title ? galRelevanceScore(title) : 0;
    if (
      !title || title.length < 12 || title.length > 500 || GAL_LOW_VALUE_TITLE.test(title) ||
      !usableUrl || !Number.isFinite(parsedTime) || parsedTime > nowMs + 5 * 60_000 ||
      nowMs - parsedTime > maxAgeMs || relevanceScore < 1 || !isLikelyEnglishGalTitle(title)
    ) {
      skipped += 1;
      continue;
    }
    const article: GdeltGalArticle = {
      title,
      url: usableUrl.url,
      eventTime: new Date(parsedTime).toISOString(),
      domain: usableUrl.domain,
      relevanceScore,
    };
    const existing = candidates.get(article.url);
    if (
      !existing || article.relevanceScore > existing.relevanceScore ||
      (article.relevanceScore === existing.relevanceScore && article.eventTime > existing.eventTime)
    ) {
      candidates.set(article.url, article);
    }
  }
  const articles = Array.from(candidates.values())
    // Relevance is a strict admission gate. Among admitted articles freshness
    // leads, so a keyword-dense item near the 48-hour boundary cannot crowd a
    // current development out of the bounded 25-row sample.
    .sort((left, right) => right.eventTime.localeCompare(left.eventTime) || right.relevanceScore - left.relevanceScore)
    .slice(0, limit);
  return { articles, feed_items: blocks.length, skipped: skipped + Math.max(candidates.size - articles.length, 0) };
}

async function ensureCountry(iso2: string | null): Promise<void> {
  if (!iso2) return;
  const country = worldCountries.find((entry) => entry.cca2 === iso2);
  await query(
    `INSERT INTO country (iso2, iso3, name, region, ext)
     VALUES ($1::char(2), $2::char(3), $3, $4, jsonb_build_object('source','world-countries'))
     ON CONFLICT (iso2) DO UPDATE SET
       iso3 = COALESCE(country.iso3, EXCLUDED.iso3),
       name = CASE WHEN country.name = country.iso2::text THEN EXCLUDED.name ELSE country.name END`,
    [iso2, country?.cca3 ?? null, country?.name.common ?? iso2, country?.region ?? null]
  );
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('gdelt', $1, 'none', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url, metadata = EXCLUDED.metadata
     RETURNING id`,
    [DOC_API_URL, JSON.stringify({
      provider: "gdelt",
      attribution: ATTRIBUTION,
      attribution_url: "https://www.gdeltproject.org/",
      commercial_use: true,
      products: ["DOC 2.0", "Event 2.0", "GKG 2.1"],
    })]
  );
  return rows[0].id;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRetry(url: string, attempts = 2): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "user-agent": process.env.GDELT_USER_AGENT || "Claritas/1.0 (https://claritas.info; engineering@claritas.info)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return response;
    lastResponse = response;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) break;
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const fallbackDelay = response.status === 429 ? 5_500 : 1_500 * (attempt + 1);
    await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 10_000) : fallbackDelay);
  }
  const body = lastResponse ? (await lastResponse.text()).slice(0, 300) : "No response";
  throw new Error(`GDELT HTTP ${lastResponse?.status ?? "unknown"} for ${url}: ${body}`);
}

function firstZipText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const first = Object.values(files)[0];
  if (!first) throw new Error("GDELT archive was empty.");
  return new TextDecoder("utf-8").decode(first);
}

async function getLatestArchiveUrls(): Promise<{ event: string; gkg: string }> {
  const base = (process.env.GDELT_DATA_BASE_URL || DEFAULT_DATA_BASE_URL).replace(/\/$/, "");
  const response = await fetchRetry(`${base}/lastupdate.txt`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  // lastupdate.txt still advertises plaintext data.gdeltproject.org links.
  // Resolve only each advertised basename against the configured TLS-backed
  // storage root so archive bytes cannot be modified in transit.
  const urls = lines.map((line) => {
    const advertised = line.trim().split(/\s+/).at(-1) ?? "";
    const basename = advertised.split("/").at(-1) ?? "";
    return basename ? `${base}/${basename}` : "";
  });
  const event = urls.find((url) => url.includes(".export.CSV.zip"));
  const gkg = urls.find((url) => url.includes(".gkg.csv.zip"));
  if (!event || !gkg) throw new Error("GDELT lastupdate.txt did not contain Event and GKG archives.");

  // lastupdate.txt occasionally advances before both products are available.
  // Resolve the newest synchronized 15-minute pair so one transient 404 does
  // not fail the entire ingestion run.
  const stampMatch = event.match(/(\d{14})\.export\.CSV\.zip$/);
  if (!stampMatch) return { event, gkg };
  const stamp = stampMatch[1];
  const stampDate = new Date(Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14))
  ));
  const archiveExists = async (url: string): Promise<boolean> => {
    try {
      const archiveResponse = await fetch(url, {
        method: "HEAD",
        headers: { "user-agent": process.env.GDELT_USER_AGENT || "Claritas/1.0 (https://claritas.info; engineering@claritas.info)" },
        signal: AbortSignal.timeout(10_000),
      });
      return archiveResponse.ok;
    } catch {
      return false;
    }
  };
  const formatStamp = (date: Date): string =>
    date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  for (let offset = 0; offset <= 12; offset += 1) {
    const candidateStamp = formatStamp(new Date(stampDate.getTime() - offset * 15 * 60_000));
    const candidateEvent = event.replace(stamp, candidateStamp);
    const candidateGkg = gkg.replace(/\d{14}(?=\.gkg\.csv\.zip$)/, candidateStamp);
    const [eventReady, gkgReady] = await Promise.all([
      archiveExists(candidateEvent),
      archiveExists(candidateGkg),
    ]);
    if (eventReady && gkgReady) return { event: candidateEvent, gkg: candidateGkg };
  }
  throw new Error("GDELT did not expose a synchronized Event/GKG archive pair within the last three hours.");
}

function parseEnhancedList(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(value.split(";").map((part) => part.split(",")[0]?.trim()).filter(Boolean))).slice(0, 100);
}

function parseLocations(value: string | undefined): Array<Record<string, unknown>> {
  if (!value) return [];
  return value.split(";").slice(0, 30).map((part) => {
    const fields = part.split("#");
    return {
      type: asNumber(fields[0]),
      name: nonEmpty(fields[1]),
      country_iso2: gdeltCountryToIso2(fields[2]),
      adm1: nonEmpty(fields[3]),
      latitude: asNumber(fields[4]),
      longitude: asNumber(fields[5]),
      feature_id: nonEmpty(fields[6]),
    };
  });
}

async function ingestEventArchive(sourceId: number, archiveUrl: string, maxRows: number): Promise<number> {
  const response = await fetchRetry(archiveUrl);
  const text = firstZipText(new Uint8Array(await response.arrayBuffer()));
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || count >= maxRows) break;
    const fields = line.split("\t");
    if (fields.length < 61) continue;
    const actionCountry = gdeltCountryToIso2(fields[53]);
    await ensureCountry(actionCountry);
    const eventTime = parseGdeltTimestamp(fields[59] || fields[1]);
    if (!eventTime) continue;
    const externalId = fields[0];
    const payload = {
      provider: "gdelt",
      product: "event-2.0",
      attribution: ATTRIBUTION,
      sql_date: fields[1] || null,
      actor1_code: fields[5] || null,
      actor2_code: fields[15] || null,
      actor1_geo: { name: fields[36] || null, country_code: fields[37] || null, latitude: asNumber(fields[40]), longitude: asNumber(fields[41]) },
      actor2_geo: { name: fields[44] || null, country_code: fields[45] || null, latitude: asNumber(fields[48]), longitude: asNumber(fields[49]) },
      action_geo: { type: asNumber(fields[51]), name: fields[52] || null, country_code: fields[53] || null, country_iso2: actionCountry, latitude: asNumber(fields[56]), longitude: asNumber(fields[57]) },
    };
    await query(
      `INSERT INTO global_event (
         source_id, external_id, event_code, event_root_code, quad_class, goldstein_scale, avg_tone,
         actor1_name, actor1_country_code, actor2_name, actor2_country_code,
         action_country_iso2, action_geo_name, action_lat, action_lon,
         mention_count, source_count, article_count, event_time, url, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         mention_count = EXCLUDED.mention_count, source_count = EXCLUDED.source_count,
         article_count = EXCLUDED.article_count, avg_tone = EXCLUDED.avg_tone,
         event_time = EXCLUDED.event_time, url = EXCLUDED.url, payload = EXCLUDED.payload,
         updated_at = now()`,
      [sourceId, externalId, fields[26] || null, fields[28] || null, asNumber(fields[29]),
       asNumber(fields[30]), asNumber(fields[34]), fields[6] || null, fields[7] || null,
       fields[16] || null, fields[17] || null, actionCountry, fields[52] || null,
       asNumber(fields[56]), asNumber(fields[57]), asNumber(fields[31]), asNumber(fields[32]),
       asNumber(fields[33]), eventTime, fields[60] || null, JSON.stringify(payload)]
    );
    count += 1;
  }
  return count;
}

async function ingestGkgArchive(sourceId: number, archiveUrl: string, maxRows: number): Promise<number> {
  const response = await fetchRetry(archiveUrl);
  const text = firstZipText(new Uint8Array(await response.arrayBuffer()));
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || count >= maxRows) break;
    const fields = line.split("\t");
    if (fields.length < 27) continue;
    const locations = parseLocations(fields[10] || fields[9]);
    const primaryCountry = locations.map((location) => location.country_iso2).find((value) => typeof value === "string") as string | undefined;
    await ensureCountry(primaryCountry ?? null);
    const toneParts = (fields[15] || "").split(",").map((value) => asNumber(value));
    const url = fields[4] || null;
    const domain = fields[3] || hostnameFromUrl(url);
    const themes = parseEnhancedList(fields[8] || fields[7]);
    const persons = parseEnhancedList(fields[12] || fields[11]);
    const organizations = parseEnhancedList(fields[14] || fields[13]);
    const eventTime = parseGdeltTimestamp(fields[1]);
    if (!eventTime) continue;
    const payload = {
      provider: "gdelt", product: "gkg-2.1", attribution: ATTRIBUTION,
      source_collection: fields[2] || null,
      counts: fields[6] || fields[5] || null,
      image_url: fields[18] || null,
      related_images: (fields[19] || "").split(";").filter(Boolean).slice(0, 20),
      quotations: fields[22] || null,
      names: fields[23] || null,
      amounts: fields[24] || null,
      translation: fields[25] || null,
    };
    await query(
      `INSERT INTO news_signal (
         source_id, external_id, url, domain, language_code, source_country_iso2,
         tone, positive_score, negative_score, polarity, themes, persons, organizations,
         locations, event_time, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         url = EXCLUDED.url, domain = EXCLUDED.domain, tone = EXCLUDED.tone,
         positive_score = EXCLUDED.positive_score, negative_score = EXCLUDED.negative_score,
         polarity = EXCLUDED.polarity, themes = EXCLUDED.themes, persons = EXCLUDED.persons,
         organizations = EXCLUDED.organizations, locations = EXCLUDED.locations,
         event_time = EXCLUDED.event_time, payload = EXCLUDED.payload, updated_at = now()`,
      [sourceId, fields[0], url, domain, null, primaryCountry ?? null, toneParts[0], toneParts[1],
       toneParts[2], toneParts[3], JSON.stringify(themes), JSON.stringify(persons),
       JSON.stringify(organizations), JSON.stringify(locations), eventTime, JSON.stringify(payload)]
    );
    count += 1;
  }
  return count;
}

async function ingestDocArticles(sourceId: number, params: GdeltIngestParams): Promise<{
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  latest_event_time: string | null;
}> {
  const apiUrl = new URL(process.env.GDELT_DOC_API_URL || DOC_API_URL);
  apiUrl.searchParams.set("query", params.query?.trim() || process.env.GDELT_DOC_QUERY || DEFAULT_GDELT_DOC_QUERY);
  apiUrl.searchParams.set("mode", "artlist");
  // Keep the scheduled headline volume within the single bounded translation
  // request so a fresh hourly run does not create a permanent presentation
  // backlog. Explicit admin requests may still choose another supported size.
  apiUrl.searchParams.set("maxrecords", String(clampInt(params.maxRecords, 1, 250, 25)));
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("timespan", params.timespan?.trim() || "1h");
  apiUrl.searchParams.set("sort", "datedesc");
  const response = await fetchRetry(apiUrl.toString());
  const data = (await response.json()) as GdeltDocResponse;
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const urls = articles.map((article) => article.url).filter((value): value is string => Boolean(value));
  const signals = urls.length > 0
    ? await query<{ url: string; tone: number | null; themes: unknown; persons: unknown; organizations: unknown; locations: unknown; payload: unknown }>(
        `SELECT DISTINCT ON (url) url, tone, themes, persons, organizations, locations, payload
         FROM news_signal WHERE url = ANY($1::text[]) ORDER BY url, event_time DESC`, [urls]
      )
    : { rows: [] };
  const signalsByUrl = new Map(signals.rows.map((row) => [row.url, row]));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let latestEventTime: string | null = null;
  for (const article of articles) {
    const url = nonEmpty(article.url);
    const eventTime = parseGdeltTimestamp(article.seendate);
    if (!url || !eventTime) {
      skipped += 1;
      continue;
    }
    if (!latestEventTime || eventTime > latestEventTime) latestEventTime = eventTime;
    const publisherDomain = nonEmpty(article.domain) ?? hostnameFromUrl(url);
    const languageCode = normalizeLanguage(article.language);
    const sourceCountry = countryNameToIso2(article.sourcecountry);
    const signal = signalsByUrl.get(url);
    const locations = Array.isArray(signal?.locations) ? signal.locations as Array<Record<string, unknown>> : [];
    const gkgCountry = locations.map((location) => location.country_iso2).find((value) => typeof value === "string") as string | undefined;
    // DOC exposes the publisher's country, while GKG exposes locations found in
    // the article. Prefer a matched GKG location, then use the publisher country
    // only as a low-confidence fallback when the headline and URL do not resolve
    // a subject geography. The inference metadata keeps that distinction visible.
    const inference = inferNewsCountry({
      title: article.title,
      url,
      feedCountryHint: gkgCountry ?? sourceCountry,
    });
    const countryIso2 = inference.iso2 ?? gkgCountry ?? null;
    await ensureCountry(countryIso2);
    await ensureCountry(sourceCountry);
    const externalId = url;
    const payload = {
      provider: "gdelt", product: "doc-2.0", attribution: ATTRIBUTION,
      source: publisherDomain, publisher: publisherDomain,
      domain: publisherDomain, source_country: article.sourcecountry || null,
      source_country_iso2: sourceCountry, language: article.language || null,
      language_code: languageCode, image_url: article.socialimage || null,
      mobile_url: article.url_mobile || null, country_inference: inference,
      // GDELT DOC's `seendate` is a provider first-seen value emitted on the
      // 15-minute GDELT heartbeat. It is not an exact publisher publication
      // timestamp, even when many records share the same value.
      time_basis: "provider_first_seen",
      time_precision: "15_minutes",
      provider_seen_at: eventTime,
      publisher_published_at: null,
      country_attribution:
        inference.source === "feed_hint" && !gkgCountry && sourceCountry
          ? "publisher_country_fallback"
          : gkgCountry && inference.iso2 === gkgCountry
            ? "gkg_location"
            : inference.source,
      gkg: signal ? {
        tone: signal.tone, themes: signal.themes, persons: signal.persons,
        organizations: signal.organizations, locations: signal.locations,
      } : null,
      license: { data: "GDELT unrestricted use with attribution", article: "Third-party publisher content" },
      raw: article,
    };
    const dedupeHash = crypto.createHash("sha256").update(`${url}|gdelt-article`).digest("hex");
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO item (
         source_id, external_id, kind, title, summary, url, country_iso2, event_time,
         payload, dedupe_hash, language_code, source_country_iso2, tone
       ) VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, item.title), summary = COALESCE(EXCLUDED.summary, item.summary),
         country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2), event_time = EXCLUDED.event_time,
         payload = item.payload || EXCLUDED.payload, dedupe_hash = EXCLUDED.dedupe_hash,
         language_code = COALESCE(EXCLUDED.language_code, item.language_code),
         source_country_iso2 = COALESCE(EXCLUDED.source_country_iso2, item.source_country_iso2),
         tone = COALESCE(EXCLUDED.tone, item.tone), updated_at = now()
       WHERE item.title IS DISTINCT FROM COALESCE(EXCLUDED.title, item.title)
          OR item.summary IS DISTINCT FROM COALESCE(EXCLUDED.summary, item.summary)
          OR item.country_iso2 IS DISTINCT FROM COALESCE(EXCLUDED.country_iso2, item.country_iso2)
          OR item.event_time IS DISTINCT FROM EXCLUDED.event_time
          OR item.payload IS DISTINCT FROM item.payload || EXCLUDED.payload
          OR item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
          OR item.language_code IS DISTINCT FROM COALESCE(EXCLUDED.language_code, item.language_code)
          OR item.source_country_iso2 IS DISTINCT FROM COALESCE(EXCLUDED.source_country_iso2, item.source_country_iso2)
          OR item.tone IS DISTINCT FROM COALESCE(EXCLUDED.tone, item.tone)
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, externalId, article.title || null,
       signal ? `GDELT themes: ${(signal.themes as string[]).slice(0, 4).join(", ")}` : null,
       url, countryIso2, eventTime, JSON.stringify(payload), dedupeHash,
       languageCode, sourceCountry, signal?.tone ?? null]
    );
    if (!result.rows[0]) unchanged += 1;
    else if (result.rows[0].inserted) inserted += 1;
    else updated += 1;
  }
  return {
    fetched: articles.length,
    inserted,
    updated,
    unchanged,
    skipped,
    latest_event_time: latestEventTime,
  };
}

export function hasUsableGdeltDocCoverage(result: {
  latest_event_time: string | null;
}): boolean {
  return typeof result.latest_event_time === "string" && !Number.isNaN(Date.parse(result.latest_event_time));
}

export function hasUsableGdeltFallbackCoverage(result: {
  selected?: unknown;
  latest_event_time?: unknown;
}): boolean {
  const selected = Number(result.selected);
  return Number.isFinite(selected)
    && selected > 0
    && typeof result.latest_event_time === "string"
    && !Number.isNaN(Date.parse(result.latest_event_time));
}

async function ingestGalFallback(sourceId: number, params: GdeltIngestParams): Promise<Record<string, unknown>> {
  const response = await fetchRetry(process.env.GDELT_GAL_RSS_URL?.trim() || GAL_RSS_URL);
  const xml = await response.text();
  const parsed = parseGdeltGalRss(xml, {
    // Scheduled runs use 25 DOC rows every 15 minutes. Keep the degraded
    // fallback within that same headline budget rather than expanding storage
    // or translation load merely because DOC is unavailable.
    limit: clampInt(params.maxRecords ?? process.env.GDELT_GAL_MAX_ARTICLES, 1, 250, 25),
    maxAgeHours: clampInt(process.env.GDELT_GAL_MAX_AGE_HOURS, 1, 168, 48),
  });
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let latestEventTime: string | null = null;

  for (const article of parsed.articles) {
    if (!latestEventTime || article.eventTime > latestEventTime) latestEventTime = article.eventTime;
    const inference = inferNewsCountry({ title: article.title, url: article.url });
    await ensureCountry(inference.iso2);
    const payload = {
      provider: "gdelt",
      product: "gal-rss",
      attribution: ATTRIBUTION,
      source: article.domain,
      publisher: article.domain,
      domain: article.domain,
      source_country_iso2: null,
      language_code: "en",
      country_inference: inference,
      country_attribution: inference.source,
      relevance_filter_score: article.relevanceScore,
      // GAL documents an exact publisher timestamp for only a minority of
      // records; otherwise pubDate is when GDELT discovered the URL. Never
      // present it as an exact publisher publication time.
      time_basis: "publisher_published_or_provider_discovered",
      time_precision: "source_ambiguous",
      provider_time_at: article.eventTime,
      publisher_published_at: null,
      fallback_reason: "gdelt_doc_unavailable",
      license: { data: "GDELT unrestricted use with attribution", article: "Third-party publisher content" },
    };
    const dedupeHash = crypto.createHash("sha256").update(`${article.url}|gdelt-article`).digest("hex");
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO item (
         source_id, external_id, kind, title, summary, url, country_iso2, event_time,
         payload, dedupe_hash, language_code, source_country_iso2, tone
       ) VALUES ($1,$2,'news_article',$3,NULL,$4,$5,$6,$7,$8,'en',NULL,NULL)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         title = COALESCE(item.title, EXCLUDED.title),
         country_iso2 = COALESCE(item.country_iso2, EXCLUDED.country_iso2),
         payload = CASE
           WHEN item.payload->>'product' = 'doc-2.0'
             THEN item.payload || jsonb_build_object(
               'gal_fallback_seen_at', EXCLUDED.payload->>'provider_time_at',
               'gal_fallback_relevance_score', EXCLUDED.payload->'relevance_filter_score'
             )
           ELSE EXCLUDED.payload
         END,
         dedupe_hash = EXCLUDED.dedupe_hash,
         updated_at = now()
       WHERE item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
          OR (item.title IS NULL AND EXCLUDED.title IS NOT NULL)
          OR (item.country_iso2 IS NULL AND EXCLUDED.country_iso2 IS NOT NULL)
          OR (
            item.payload->>'product' = 'doc-2.0'
            AND item.payload->>'gal_fallback_seen_at' IS DISTINCT FROM EXCLUDED.payload->>'provider_time_at'
          )
          OR (
            item.payload->>'product' IS DISTINCT FROM 'doc-2.0'
            AND item.payload IS DISTINCT FROM EXCLUDED.payload
          )
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, article.url, article.title, article.url, inference.iso2, article.eventTime, JSON.stringify(payload), dedupeHash],
    );
    if (!result.rows[0]) unchanged += 1;
    else if (result.rows[0].inserted) inserted += 1;
    else updated += 1;
  }

  return {
    provider: "gdelt",
    product: "gal-rss",
    health: "degraded_fallback",
    fetched: parsed.feed_items,
    selected: parsed.articles.length,
    inserted,
    updated,
    unchanged,
    skipped: parsed.skipped,
    latest_event_time: latestEventTime,
    coverage: "bounded relevance-filtered sample from GDELT's rolling 15-minute global feed",
  };
}

export async function ingestGdelt(params: GdeltIngestParams = {}): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  const includeDoc = params.includeDoc !== false;
  const includeEvents = params.includeEvents !== false;
  const includeGkg = params.includeGkg !== false;
  const maxRawRows = clampInt(params.maxRawRows ?? process.env.GDELT_MAX_RAW_ROWS, 25, 5000, 750);
  const result: Record<string, unknown> = {
    provider: "gdelt",
    health: includeDoc ? "pending" : "healthy",
    retrieved_at: new Date().toISOString(),
    inserted: 0,
    updated: 0,
    skipped: 0,
    http_failures: 0,
    doc_status: includeDoc ? "pending" : "not_requested",
  };
  let archiveUrls: { event: string; gkg: string } | null = null;
  if (includeEvents || includeGkg) archiveUrls = await getLatestArchiveUrls();
  if (includeEvents && archiveUrls) {
    const events = await ingestEventArchive(sourceId, archiveUrls.event, maxRawRows);
    result.events = events;
    result.inserted = Number(result.inserted) + events;
  }
  if (includeGkg && archiveUrls) {
    const signals = await ingestGkgArchive(sourceId, archiveUrls.gkg, maxRawRows);
    result.signals = signals;
    result.inserted = Number(result.inserted) + signals;
  }
  if (includeDoc) {
    try {
      const doc = await ingestDocArticles(sourceId, params);
      if (!hasUsableGdeltDocCoverage(doc)) {
        throw new Error("GDELT DOC returned no usable article with a valid provider first-seen time.");
      }
      result.articles = doc;
      result.doc_status = "healthy";
      result.health = "healthy";
      result.latest_event_time = doc.latest_event_time;
      result.inserted = Number(result.inserted) + doc.inserted;
      result.updated = Number(result.updated) + doc.updated;
      result.skipped = Number(result.skipped) + doc.skipped;
    } catch (error) {
      const docError = error instanceof Error ? error.message : String(error);
      result.doc_error = docError;
      result.doc_status = "degraded";
      result.health = "failed";
      result.http_failures = Number(result.http_failures) + (/\bHTTP\b/i.test(docError) ? 1 : 0);
      result.partial = true;
      try {
        const fallback = await ingestGalFallback(sourceId, params);
        result.gal_fallback = fallback;
        if (!hasUsableGdeltFallbackCoverage(fallback)) {
          throw new Error("GDELT GAL fallback returned no usable publisher headline with a valid source time.");
        }
        result.doc_status = "degraded_fallback";
        result.health = "degraded";
        result.latest_event_time = fallback.latest_event_time;
        result.inserted = Number(result.inserted) + Number(fallback.inserted ?? 0);
        result.updated = Number(result.updated) + Number(fallback.updated ?? 0);
        result.skipped = Number(result.skipped) + Number(fallback.skipped ?? 0);
      } catch (fallbackError) {
        const galError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        result.gal_error = galError;
        result.http_failures = Number(result.http_failures) + (/\bHTTP\b/i.test(galError) ? 1 : 0);
      }
    }
  }
  return result;
}

export async function getGdeltEvents(params: { country?: string; limit?: number } = {}): Promise<GdeltGlobalEvent[]> {
  const country = params.country?.trim().toUpperCase() || "";
  const limit = clampInt(params.limit, 1, 500, 100);
  const { rows } = await query<GdeltGlobalEvent>(
    `SELECT id, external_id, event_code, event_root_code, quad_class, goldstein_scale,
            avg_tone, actor1_name, actor2_name, action_country_iso2 AS country,
            action_geo_name AS location, action_lat AS latitude, action_lon AS longitude,
            mention_count, source_count, article_count, event_time, url, payload
     FROM global_event
     WHERE ($1::text = '' OR action_country_iso2 = $1::char(2))
     ORDER BY event_time DESC, mention_count DESC NULLS LAST
     LIMIT $2`, [country, limit]
  );
  return rows;
}

export async function getGdeltSignals(params: { country?: string; theme?: string; limit?: number } = {}): Promise<GdeltNewsSignal[]> {
  const country = params.country?.trim().toUpperCase() || "";
  const theme = params.theme?.trim() || "";
  const limit = clampInt(params.limit, 1, 500, 100);
  const { rows } = await query<GdeltNewsSignal>(
    `SELECT id, external_id, url, domain, language_code, source_country_iso2 AS country,
            tone, positive_score, negative_score, polarity, themes, persons, organizations,
            locations, event_time
     FROM news_signal
     WHERE (($1::text = '' OR source_country_iso2 = $1::char(2)
            OR locations @> jsonb_build_array(jsonb_build_object('country_iso2', $1::text))))
       AND ($2::text = '' OR themes ? $2::text)
     ORDER BY event_time DESC
     LIMIT $3`, [country, theme, limit]
  );
  return rows;
}
