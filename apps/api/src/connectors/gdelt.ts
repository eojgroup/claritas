import crypto from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { unzipSync } from "fflate";
import worldCountries from "world-countries";
import { query } from "../db";
import { hasEarthquakeHeadlineSignal } from "../earthquake-language";
import { inferNewsCountry } from "./country-inference";

const DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_DATA_BASE_URL = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv2";
const GAL_RSS_URL = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv3/gal/feed.rss";
export const DEFAULT_GDELT_DOC_QUERY = "(geopolitics OR security OR technology OR markets OR climate OR energy OR disaster OR emergency OR earthquake OR aftershock OR tsunami OR volcano OR eruption OR landslide OR wildfire OR flood OR hurricane OR typhoon OR cyclone OR shipping OR transport OR logistics OR agriculture OR food OR \"public health\")";
const ATTRIBUTION = "GDELT Project";
const GDELT_DOC_DEFAULT_MAX_PUBLISH_AGE_HOURS = 72;
const GDELT_DOC_DEFAULT_MAX_PROVIDER_SEEN_AGE_HOURS = 3;
const GDELT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
const GDELT_ARTICLE_HTML_MAX_BYTES = 350_000;
const GDELT_ARTICLE_VERIFICATION_CONCURRENCY = 4;
const GDELT_DOC_MIN_REQUEST_SPACING_MS = 5_500;
let gdeltDocRequestTail: Promise<void> = Promise.resolve();
let gdeltDocNextRequestAt = 0;

export type GdeltDocArticle = {
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

export type GdeltPublicationTime = {
  /**
   * A date published by the source itself, never GDELT's discovery time.
   * `url_date` is intentionally marked as day precision because it is a
   * conservative fallback when a publisher does not expose structured data.
   */
  publishedAt: string;
  source: "article_metadata" | "json_ld" | "html_time" | "url_date";
  precision: "second" | "day";
};

export type GdeltDocQualityResult = {
  accepted: boolean;
  reason:
    | "accepted"
    | "missing_title"
    | "missing_or_unsafe_url"
    | "non_article_url"
    | "invalid_provider_seen_at"
    | "provider_seen_at_in_future"
    | "provider_seen_at_outside_window"
    | "publisher_publication_unverified"
    | "publisher_published_at_invalid"
    | "publisher_published_at_in_future"
    | "publisher_published_at_stale"
    | "publisher_date_after_provider_seen";
  publication: GdeltPublicationTime | null;
};

export type GdeltGalArticle = {
  title: string;
  url: string;
  eventTime: string;
  domain: string;
  relevanceScore: number;
  materialityScore: number;
};

export type GdeltIngestParams = {
  query?: string;
  timespan?: string;
  maxRecords?: number;
  maxRawRows?: number;
  includeDoc?: boolean;
  includeEvents?: boolean;
  includeGkg?: boolean;
  targetedDiscovery?: GdeltTargetedDiscoveryContext;
};

export type GdeltTargetedDiscoveryContext = {
  earthquakeObservationId: string;
  usgsEventId: string;
  place: string;
  countryIso2: string | null;
  magnitude: number | null;
  latitude: number;
  longitude: number;
  observedAt: string;
  query: string;
  anchorTerms: string[];
};

export type GdeltTargetedMatch = {
  confidence: number;
  scope: "local_place" | "event_signature" | "country" | "full_text_query";
  link_eligible: boolean;
  factors: string[];
  rationale: string;
  assessment_boundary: string;
};

export type GdeltHeadlineBudgets = {
  total: number;
  doc: number;
  galReserve: number;
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

export function planGdeltHeadlineBudgets(value: unknown): GdeltHeadlineBudgets {
  const total = clampInt(value, 1, 250, 25);
  // Keep the configured headline ceiling intact while reserving a small lane
  // for GAL's independently assembled global feed. Without this lane, even a
  // single routine DOC result suppresses every GAL headline in that run.
  const galReserve = total >= 5 ? Math.max(1, Math.floor(total / 5)) : 0;
  return { total, doc: total - galReserve, galReserve };
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

function clampHours(value: unknown, fallback: number): number {
  return clampInt(value, 1, 168, fallback);
}

function parseGdeltTimespanHours(value: string | undefined): number {
  const match = /^(\d+)\s*(min|m|h|d|w)$/i.exec(value?.trim() ?? "");
  if (!match) return 1;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return 1;
  const hoursByUnit: Record<string, number> = { min: 1 / 60, m: 1 / 60, h: 1, d: 24, w: 168 };
  return Math.min(amount * (hoursByUnit[match[2].toLowerCase()] ?? 1), 168);
}

function gdeltProviderSeenMaxAgeHours(params: GdeltIngestParams): number {
  const derived = Math.max(
    GDELT_DOC_DEFAULT_MAX_PROVIDER_SEEN_AGE_HOURS,
    Math.ceil(parseGdeltTimespanHours(params.timespan) + 1),
  );
  return clampHours(process.env.GDELT_DOC_MAX_PROVIDER_SEEN_AGE_HOURS, derived);
}

function gdeltPublisherMaxAgeHours(): number {
  return clampHours(process.env.GDELT_DOC_MAX_PUBLISH_AGE_HOURS, GDELT_DOC_DEFAULT_MAX_PUBLISH_AGE_HOURS);
}

function unbracketHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function isUnsafeArticleHost(hostname: string): boolean {
  const host = unbracketHostname(hostname).trim().toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^0\./.test(host) || /^169\.254\./.test(host) || /^10\./.test(host)) return true;
  if (/^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

function usableGdeltArticleUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      isUnsafeArticleHost(url.hostname)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

const GDELT_NON_ARTICLE_PATH = /\/(?:author|authors|tag|tags|category|categories|search|profile|profiles|topic|topics|archive|archives)(?:\/|$)/i;
const GDELT_LOW_VALUE_TITLE = /^(?:home|homepage|latest news|news|world|sports|weather|login|sign in|subscribe|contact us|about us|privacy policy)$/i;

function isLikelyArticleUrl(url: URL): boolean {
  return url.pathname.length >= 5 && url.pathname !== "/" && !GDELT_NON_ARTICLE_PATH.test(url.pathname);
}

const RFC_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function isValidCalendarDate(year: number, monthIndex: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === monthIndex
    && candidate.getUTCDate() === day;
}

function hasValidPublisherCalendarDate(value: string): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) {
    return isValidCalendarDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const rfc = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s/.exec(value);
  if (!rfc) return false;
  const monthIndex = RFC_MONTHS[rfc[2].toLowerCase()];
  return monthIndex != null && isValidCalendarDate(Number(rfc[3]), monthIndex, Number(rfc[1]));
}

function normalizePublisherDate(value: unknown): { iso: string; precision: "second" | "day" } | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 200) return null;
  // Do not allow JavaScript's permissive date parser to turn arbitrary prose
  // into a current-looking timestamp. These cover ISO metadata and RFC 822
  // dates used by publisher markup while retaining an explicit source trail.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  // A wall-clock time without an offset is ambiguous across publishers and
  // must not become an apparently precise UTC timestamp in the briefing.
  const isIso = /^\d{4}-\d{2}-\d{2}[Tt ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:[Zz]|[+-][0-2]\d:?[0-5]\d)$/.test(raw);
  const isRfcLike = /^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC|[+-]\d{4})$/.test(raw);
  if (!isDateOnly && !isIso && !isRfcLike) return null;
  // Date.parse intentionally normalizes overflow (for example, 2026-02-31
  // becomes March 3). Publisher metadata must be a real calendar date before
  // it can pass a freshness policy.
  if (!hasValidPublisherCalendarDate(raw)) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return { iso: new Date(parsed).toISOString(), precision: isDateOnly ? "day" : "second" };
}

function publicationTimeFromUrl(value: string): GdeltPublicationTime | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const separated = /(?:^|[\/_\-.])((?:19|20)\d{2})[\/_\-.](0[1-9]|1[0-2])[\/_\-.](0[1-9]|[12]\d|3[01])(?:$|[\/_\-.])/u.exec(path);
  const compact = /(?:^|[\/_\-.])((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:$|[\/_\-.])/u.exec(path);
  const match = separated ?? compact;
  if (!match) return null;
  const parsed = normalizePublisherDate(`${match[1]}-${match[2]}-${match[3]}`);
  return parsed
    ? { publishedAt: parsed.iso, source: "url_date", precision: "day" }
    : null;
}

function htmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const matcher = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of tag.matchAll(matcher)) {
    const name = match[1]?.toLowerCase();
    if (!name || name === "meta" || name === "script" || name === "time") continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function publicationCandidate(
  value: unknown,
  source: GdeltPublicationTime["source"],
): GdeltPublicationTime | null {
  const normalized = normalizePublisherDate(value);
  return normalized ? { publishedAt: normalized.iso, source, precision: normalized.precision } : null;
}

function jsonLdPublicationCandidates(value: unknown, candidates: GdeltPublicationTime[], depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) jsonLdPublicationCandidates(child, candidates, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "datepublished" || normalizedKey === "datecreated") {
      const candidate = publicationCandidate(child, "json_ld");
      if (candidate) candidates.push(candidate);
    }
    jsonLdPublicationCandidates(child, candidates, depth + 1);
  }
}

function selectConservativePublicationTime(candidates: GdeltPublicationTime[]): GdeltPublicationTime | null {
  if (!candidates.length) return null;
  const byDay = [...candidates].sort((left, right) => {
    const dayOrder = left.publishedAt.slice(0, 10).localeCompare(right.publishedAt.slice(0, 10));
    if (dayOrder !== 0) return dayOrder;
    // When a URL and publisher metadata agree on the day, retain the most
    // precise first-party timestamp rather than manufacturing midnight.
    const precisionOrder = (right.precision === "second" ? 1 : 0) - (left.precision === "second" ? 1 : 0);
    if (precisionOrder !== 0) return precisionOrder;
    const sourceOrder: Record<GdeltPublicationTime["source"], number> = {
      article_metadata: 4,
      json_ld: 3,
      html_time: 2,
      url_date: 1,
    };
    return sourceOrder[right.source] - sourceOrder[left.source] || left.publishedAt.localeCompare(right.publishedAt);
  });
  return byDay[0] ?? null;
}

/**
 * Extracts only publisher-originating publication dates. GDELT's `seendate`
 * is deliberately not considered here: it tells us when GDELT discovered a
 * URL, not when the publisher released the article.
 */
export function extractGdeltPublisherPublicationTime(html: string, url: string): GdeltPublicationTime | null {
  const candidates: GdeltPublicationTime[] = [];
  const urlCandidate = publicationTimeFromUrl(url);
  if (urlCandidate) candidates.push(urlCandidate);

  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = htmlAttributes(match[0]);
    const keys = [attributes.property, attributes.name, attributes.itemprop]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());
    if (!keys.some((key) => [
      "article:published_time",
      "article:published",
      "og:published_time",
      "datepublished",
      "datecreated",
      "publishdate",
      "publication_date",
    ].includes(key))) continue;
    const candidate = publicationCandidate(attributes.content, "article_metadata");
    if (candidate) candidates.push(candidate);
  }

  for (const match of html.matchAll(/<time\b[^>]*>/giu)) {
    const attributes = htmlAttributes(match[0]);
    const marker = `${attributes.itemprop ?? ""} ${attributes.class ?? ""}`.toLowerCase();
    if (!/datepublished|datecreated|publish/.test(marker) && !("pubdate" in attributes)) continue;
    const candidate = publicationCandidate(attributes.datetime, "html_time");
    if (candidate) candidates.push(candidate);
  }

  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)) {
    const openingTag = match[0].slice(0, match[0].indexOf(">") + 1);
    const attributes = htmlAttributes(openingTag);
    if (!/application\/ld\+json/i.test(attributes.type ?? "")) continue;
    try {
      jsonLdPublicationCandidates(JSON.parse(match[1]), candidates);
    } catch {
      // One malformed JSON-LD block must not invalidate other first-party
      // metadata on the page.
    }
  }
  return selectConservativePublicationTime(candidates);
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 168)) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
  if (first === 203 && second === 0) return false;
  return true;
}

function isPublicIpAddress(address: string): boolean {
  const normalizedAddress = unbracketHostname(address);
  const family = isIP(normalizedAddress);
  if (family === 4) return isPublicIpv4(normalizedAddress);
  if (family !== 6) return false;
  const normalized = normalizedAddress.toLowerCase();
  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  // Allow globally routed IPv6 only. This rejects loopback, unspecified,
  // link-local, unique-local, multicast, documentation and IPv4-compatible
  // address ranges before a request can leave the service.
  return /^(?:2(?!001:db8:)[0-9a-f]{3}|3[0-9a-f]{3}):/i.test(normalized);
}

export function isPublicGdeltArticleAddress(address: string): boolean {
  return isPublicIpAddress(address);
}

async function resolvePublicArticleAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = unbracketHostname(url.hostname);
  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error("GDELT article URL resolved to a non-public address.");
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  const publicAddress = addresses.find((entry) => isPublicIpAddress(entry.address));
  if (!publicAddress) throw new Error("GDELT article hostname has no public address.");
  return { address: publicAddress.address, family: publicAddress.family as 4 | 6 };
}

type VerifiedPublisherPage = { html: string; finalUrl: string };

async function requestVerifiedPublisherPage(urlValue: string, redirects = 0): Promise<VerifiedPublisherPage | null> {
  if (redirects > 3) return null;
  const url = usableGdeltArticleUrl(urlValue);
  if (!url) return null;
  const address = await resolvePublicArticleAddress(url);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: VerifiedPublisherPage | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: unbracketHostname(url.hostname),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "user-agent": process.env.GDELT_USER_AGENT || "Claritas/1.0 (https://claritas.info; engineering@claritas.info)",
      },
      // Pin the request to the just-vetted DNS result. Calling global fetch
      // after a separate lookup would permit a DNS-rebinding race.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      agent: false,
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = typeof response.headers.location === "string" ? response.headers.location : null;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume();
        let redirect: string;
        try {
          redirect = new URL(location, url).toString();
        } catch {
          finish(null);
          return;
        }
        void requestVerifiedPublisherPage(redirect, redirects + 1).then(finish).catch(() => finish(null));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        finish(null);
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      const advertisedLength = Number(response.headers["content-length"]);
      if (
        (contentType && !/(?:text\/html|application\/xhtml\+xml)/.test(contentType)) ||
        (Number.isFinite(advertisedLength) && advertisedLength > GDELT_ARTICLE_HTML_MAX_BYTES)
      ) {
        response.resume();
        finish(null);
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > GDELT_ARTICLE_HTML_MAX_BYTES) {
          request.destroy();
          finish(null);
          return;
        }
        chunks.push(buffer);
      });
      response.on("error", () => finish(null));
      response.on("end", () => finish({ html: Buffer.concat(chunks).toString("utf8"), finalUrl: url.toString() }));
    });
    request.setTimeout(8_000, () => {
      request.destroy();
      finish(null);
    });
    request.on("error", () => finish(null));
    request.end();
  });
}

async function resolveGdeltPublisherPublicationTime(url: string): Promise<GdeltPublicationTime | null> {
  const urlCandidate = publicationTimeFromUrl(url);
  try {
    const page = await requestVerifiedPublisherPage(url);
    if (!page) return urlCandidate;
    // The final URL receives the same conservative date check. A redirect
    // cannot remove an older date embedded in the original canonical URL.
    const original = extractGdeltPublisherPublicationTime(page.html, url);
    const redirected = page.finalUrl === url
      ? null
      : extractGdeltPublisherPublicationTime(page.html, page.finalUrl);
    return selectConservativePublicationTime([original, redirected].filter((value): value is GdeltPublicationTime => Boolean(value)));
  } catch {
    // An unambiguous publication date embedded in a canonical article URL is
    // still more defensible than GDELT discovery time when a publisher blocks
    // metadata requests. With neither, the article is rejected below.
    return urlCandidate;
  }
}

export function assessGdeltDocArticleQuality(input: {
  title?: string | null;
  url?: string | null;
  providerSeenAt?: string | null;
  publication?: GdeltPublicationTime | null;
  now?: Date;
  maxPublisherAgeHours?: number;
  maxProviderSeenAgeHours?: number;
}): GdeltDocQualityResult {
  const title = input.title?.trim() ?? "";
  if (!title || title.length < 12 || title.length > 500 || GDELT_LOW_VALUE_TITLE.test(title)) {
    return { accepted: false, reason: "missing_title", publication: null };
  }
  const url = usableGdeltArticleUrl(input.url);
  if (!url) return { accepted: false, reason: "missing_or_unsafe_url", publication: null };
  if (!isLikelyArticleUrl(url)) return { accepted: false, reason: "non_article_url", publication: null };

  const seenAt = input.providerSeenAt ? Date.parse(input.providerSeenAt) : Number.NaN;
  if (!Number.isFinite(seenAt)) return { accepted: false, reason: "invalid_provider_seen_at", publication: null };
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (seenAt > nowMs + GDELT_MAX_FUTURE_SKEW_MS) {
    return { accepted: false, reason: "provider_seen_at_in_future", publication: null };
  }
  const maxProviderSeenAgeMs = clampHours(input.maxProviderSeenAgeHours, GDELT_DOC_DEFAULT_MAX_PROVIDER_SEEN_AGE_HOURS) * 3_600_000;
  if (nowMs - seenAt > maxProviderSeenAgeMs) {
    return { accepted: false, reason: "provider_seen_at_outside_window", publication: null };
  }

  const publication = input.publication ?? null;
  if (!publication) return { accepted: false, reason: "publisher_publication_unverified", publication: null };
  const publishedAt = Date.parse(publication.publishedAt);
  if (!Number.isFinite(publishedAt)) return { accepted: false, reason: "publisher_published_at_invalid", publication: null };
  if (publishedAt > nowMs + GDELT_MAX_FUTURE_SKEW_MS) {
    return { accepted: false, reason: "publisher_published_at_in_future", publication: null };
  }
  const maxPublisherAgeMs = clampHours(input.maxPublisherAgeHours, GDELT_DOC_DEFAULT_MAX_PUBLISH_AGE_HOURS) * 3_600_000;
  if (nowMs - publishedAt > maxPublisherAgeMs) {
    return { accepted: false, reason: "publisher_published_at_stale", publication };
  }
  if (publishedAt > seenAt + GDELT_MAX_FUTURE_SKEW_MS) {
    return { accepted: false, reason: "publisher_date_after_provider_seen", publication };
  }
  return { accepted: true, reason: "accepted", publication };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await callback(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * A quality rejection must also win against any previous copy of the same URL.
 * Without this tombstone, a stale item that was accepted before this policy
 * could remain sorted as current even after a later verification rejects it.
 */
async function quarantineGdeltArticle(
  sourceId: number,
  url: string | null,
  reason: GdeltDocQualityResult["reason"],
  checkedAt: string,
  providerSeenAt: string | null,
): Promise<boolean> {
  if (!url) return false;
  const { rows } = await query<{ id: number }>(
    `UPDATE item
     SET payload = item.payload || jsonb_build_object(
           'quality_status', 'rejected',
           'quality_rejection_reason', $3,
           'quality_checked_at', $4
         ) || CASE
           WHEN $5::text IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('last_provider_seen_at', $5::text)
         END,
         updated_at = now()
     WHERE source_id = $1
       AND external_id = $2
       AND kind = 'news_article'
       AND (
         item.payload->>'quality_status' IS DISTINCT FROM 'rejected'
         OR item.payload->>'quality_rejection_reason' IS DISTINCT FROM $3
       )
     RETURNING id`,
    [sourceId, url, reason, checkedAt, providerSeenAt],
  );
  return rows.length > 0;
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
  /\b(?:climate|wildfire|fire|flood|storm|hurricane|typhoon|cyclone|earthquake|aftershock|tsunami|volcano|eruption|landslide|drought|heatwave|disaster|emergency)\w*\b/i,
  /\b(?:shipping|vessel|ship|port|aviation|airline|airport|rail|pipeline|transport|logistics|strait|canal)\w*\b/i,
  /\b(?:outbreak|epidemic|pandemic|public health|vaccine|disease|hospital)\w*\b/i,
];

// GAL is a global rolling feed rather than a result set tailored to our
// product. A simple newest-first slice can therefore omit a major earthquake
// while admitting dozens of routine institutional headlines carrying the
// same feed timestamp. These terms rank high-consequence developments inside
// broad freshness bands; they are selection hints only and never become a
// causal or impact claim in the reader experience.
const GAL_MATERIAL_HAZARD_PATTERN = /\b(?:earthquakes?|aftershocks?|tsunamis?|volcan(?:o|oes|ic)|eruptions?|landslides?|wildfires?|hurricanes?|typhoons?|cyclones?|tornado(?:es)?|floods?|droughts?|heatwaves?)\b/gi;
const GAL_MATERIAL_IMPACT_PATTERN = /\b(?:magnitude\s*[6-9](?:\.\d+)?|m[6-9](?:\.\d+)?|major|severe|dead|deaths?|killed|injured|missing|rescues?|evacuat(?:e|ed|es|ing|ion|ions)|collapsed?|destroyed?|damaged?|blocked?|closed?|outages?|disrupt(?:ed|ion|ions)|emergency|warning|warnings)\b/gi;

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

function galMaterialityScore(title: string): number {
  const hazards = title.match(GAL_MATERIAL_HAZARD_PATTERN)?.length ?? 0;
  const impacts = title.match(GAL_MATERIAL_IMPACT_PATTERN)?.length ?? 0;
  return hazards * 3 + impacts * 2;
}

function galFreshnessBand(eventTime: string, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - Date.parse(eventTime));
  if (ageMs <= 6 * 3_600_000) return 0;
  if (ageMs <= 24 * 3_600_000) return 1;
  return 2;
}

function selectDomainDiverseGalArticles(
  candidates: GdeltGalArticle[],
  limit: number,
  nowMs: number,
): GdeltGalArticle[] {
  const ranked = [...candidates].sort((left, right) =>
    galFreshnessBand(left.eventTime, nowMs) - galFreshnessBand(right.eventTime, nowMs) ||
    right.materialityScore - left.materialityScore ||
    right.eventTime.localeCompare(left.eventTime) ||
    right.relevanceScore - left.relevanceScore ||
    left.domain.localeCompare(right.domain) ||
    left.url.localeCompare(right.url)
  );
  const domainLimit = Math.max(1, Math.ceil(limit / 8));
  const domainCounts = new Map<string, number>();
  const selected: GdeltGalArticle[] = [];
  const overflow: GdeltGalArticle[] = [];
  for (const article of ranked) {
    const domainCount = domainCounts.get(article.domain) ?? 0;
    if (domainCount >= domainLimit) {
      overflow.push(article);
      continue;
    }
    selected.push(article);
    domainCounts.set(article.domain, domainCount + 1);
    if (selected.length >= limit) return selected;
  }
  for (const article of overflow) {
    selected.push(article);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function selectGdeltDocCandidates(
  articles: GdeltDocArticle[],
  options: { limit?: number; now?: Date } = {},
): GdeltDocArticle[] {
  const limit = clampInt(options.limit, 1, 250, 25);
  const nowMs = (options.now ?? new Date()).getTime();
  const deduplicated = new Map<string, GdeltDocArticle>();
  for (const article of articles) {
    const title = nonEmpty(article.title);
    const url = usableGdeltArticleUrl(article.url);
    const providerSeenAt = parseGdeltTimestamp(article.seendate);
    if (!title || !url || !isLikelyArticleUrl(url) || !providerSeenAt) continue;
    const key = url.toString();
    const existing = deduplicated.get(key);
    if (!existing || providerSeenAt > (parseGdeltTimestamp(existing.seendate) ?? "")) {
      deduplicated.set(key, article);
    }
  }

  const score = (article: GdeltDocArticle) => ({
    eventTime: parseGdeltTimestamp(article.seendate) ?? "",
    materiality: galMaterialityScore(article.title ?? ""),
    relevance: galRelevanceScore(article.title ?? ""),
    domain: nonEmpty(article.domain) ?? hostnameFromUrl(article.url ?? null) ?? "unknown",
    url: article.url ?? "",
  });
  const scored = Array.from(deduplicated.values()).map((article) => ({ article, ...score(article) }));
  const priority = scored
    .filter((candidate) => candidate.materiality > 0)
    .sort((left, right) =>
      galFreshnessBand(left.eventTime, nowMs) - galFreshnessBand(right.eventTime, nowMs) ||
      right.materiality - left.materiality ||
      right.eventTime.localeCompare(left.eventTime) ||
      right.relevance - left.relevance ||
      left.url.localeCompare(right.url)
    );
  const general = [...scored].sort((left, right) =>
    galFreshnessBand(left.eventTime, nowMs) - galFreshnessBand(right.eventTime, nowMs) ||
    right.eventTime.localeCompare(left.eventTime) ||
    right.relevance - left.relevance ||
    right.materiality - left.materiality ||
    left.url.localeCompare(right.url)
  );
  const selected: typeof scored = [];
  const selectedUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const domainLimit = Math.max(1, Math.ceil(limit / 6));
  const take = (candidate: (typeof scored)[number], enforceDomainLimit: boolean): boolean => {
    if (selectedUrls.has(candidate.url)) return false;
    const domainCount = domainCounts.get(candidate.domain) ?? 0;
    if (enforceDomainLimit && domainCount >= domainLimit) return false;
    selected.push(candidate);
    selectedUrls.add(candidate.url);
    domainCounts.set(candidate.domain, domainCount + 1);
    return true;
  };

  const priorityTarget = Math.min(priority.length, Math.max(1, Math.ceil(limit / 3)));
  for (const candidate of priority) {
    take(candidate, true);
    if (selected.length >= priorityTarget) break;
  }
  for (const candidate of general) {
    take(candidate, true);
    if (selected.length >= limit) break;
  }
  // Sparse feeds should still fill the requested budget when publisher
  // diversity is unavailable; the cap is a preference, not an outage mode.
  if (selected.length < limit) {
    for (const candidate of general) {
      take(candidate, false);
      if (selected.length >= limit) break;
    }
  }
  return selected.map((candidate) => candidate.article);
}

const TARGETED_NATIVE_COUNTRY_SIGNALS: ReadonlyArray<readonly [string, RegExp]> = [
  ["CN", /(?:中国|中國)/u],
  ["JP", /日本/u],
  ["KR", /(?:韩国|韓國|한국|대한민국)/u],
  ["KP", /(?:朝鲜|朝鮮|북한)/u],
  ["ID", /(?:印度尼西亚|印度尼西亞|印尼)/u],
  ["IN", /(?:印度|भारत)/u],
  ["US", /(?:美国|美國|الولايات\s+المتحدة|США)/u],
  ["RU", /(?:俄罗斯|俄羅斯|Россия)/u],
  ["UA", /(?:乌克兰|烏克蘭|Україна)/u],
  ["IR", /(?:伊朗|ایران)/u],
  ["PK", /(?:巴基斯坦|پاکستان)/u],
  ["AF", /(?:阿富汗|افغانستان)/u],
  ["PH", /(?:菲律宾|菲律賓|Pilipinas)/iu],
];

export function describeTargetedGdeltMatch(
  article: Pick<GdeltDocArticle, "title">,
  context: GdeltTargetedDiscoveryContext,
): GdeltTargetedMatch {
  const title = article.title?.toLocaleLowerCase() ?? "";
  const normalizedAnchors = context.anchorTerms
    .map((term) => term.trim().toLocaleLowerCase())
    .filter((term) => term.length >= 2);
  const localAnchor = normalizedAnchors[0] ?? "";
  const countryAnchors = normalizedAnchors.slice(1);
  const titleMentionsHazard = hasEarthquakeHeadlineSignal(article.title);
  const titleMentionsLocalPlace = Boolean(localAnchor && title.includes(localAnchor));
  const headlineInference = inferNewsCountry({ title: article.title });
  const headlineCountries = new Set<string>();
  if (headlineInference.source === "content_alias" && headlineInference.iso2) {
    headlineCountries.add(headlineInference.iso2);
  }
  for (const [iso2, pattern] of TARGETED_NATIVE_COUNTRY_SIGNALS) {
    if (pattern.test(article.title ?? "")) headlineCountries.add(iso2);
  }
  const targetCountry = context.countryIso2?.trim().toUpperCase() ?? null;
  const titleMentionsCountry = countryAnchors.some((anchor) => title.includes(anchor))
    || Boolean(targetCountry && headlineCountries.has(targetCountry));
  const headlineCountryConflicts = Boolean(
    targetCountry && Array.from(headlineCountries).some((country) => country !== targetCountry),
  );
  const headlineMagnitudes = Array.from(title.matchAll(/\b(?:m(?:agnitude)?\s*)?([4-9](?:[.,]\d)?)\b/gi))
    .map((match) => Number(match[1].replace(",", ".")))
    .filter(Number.isFinite);
  const observedMagnitudeAtHeadlinePrecision = context.magnitude == null
    ? null
    : Math.round(Number(context.magnitude) * 10) / 10;
  const magnitudeMatches = observedMagnitudeAtHeadlinePrecision != null
    && headlineMagnitudes.some((magnitude) => (
      Math.round(magnitude * 10) / 10 === observedMagnitudeAtHeadlinePrecision
    ));
  const factors = [
    "bounded GDELT full-text query for earthquake terminology",
    "publisher publication time falls within 6 hours before to 72 hours after the event",
    "publisher-originating publication date independently verified",
  ];
  if (titleMentionsHazard) factors.push("headline contains earthquake terminology");
  if (titleMentionsLocalPlace) factors.push(`headline names ${context.anchorTerms[0]}`);
  else if (titleMentionsCountry) factors.push("headline names the event country");
  if (magnitudeMatches) factors.push("headline magnitude matches the observed event at one-decimal precision");
  if (magnitudeMatches && !headlineCountryConflicts && !titleMentionsCountry) {
    factors.push("headline contains no country that conflicts with the event country");
  }
  if (headlineCountryConflicts) factors.push("headline names a country that conflicts with the event country");

  const scope = titleMentionsLocalPlace
    ? "local_place"
    : titleMentionsHazard && magnitudeMatches && !headlineCountryConflicts
      ? "event_signature"
    : titleMentionsCountry
      ? "country"
      : "full_text_query";
  const confidence = titleMentionsHazard && titleMentionsLocalPlace
    ? 0.9
    : titleMentionsHazard && magnitudeMatches && titleMentionsCountry
      ? 0.84
      : titleMentionsHazard && magnitudeMatches && !headlineCountryConflicts
        ? 0.76
    : titleMentionsHazard && titleMentionsCountry
      ? 0.68
      : titleMentionsLocalPlace
        ? 0.74
        : 0.52;
  const linkEligible = !headlineCountryConflicts && titleMentionsHazard
    && (titleMentionsLocalPlace || magnitudeMatches);
  return {
    confidence,
    scope,
    link_eligible: linkEligible,
    factors,
    rationale: scope === "local_place"
      ? "The publisher headline and the targeted full-text result share the local place and event family."
      : scope === "event_signature"
        ? "The headline shares the event family and observed magnitude while the bounded query supplies the place/country retrieval anchor."
      : scope === "country"
        ? "The publisher headline and the targeted full-text result share only the country and event family; it is retained as a review candidate, not auto-linked locally."
        : "GDELT matched the bounded event query in the article text, but the headline does not expose a local place or event-signature anchor.",
    assessment_boundary: "Likely contextual reporting only. Retrieval proximity does not prove that the article describes this earthquake or any resulting impact.",
  };
}

export function eligibleTargetedGdeltCountryFallback(
  match: GdeltTargetedMatch | null,
  countryIso2: string | null,
): string | null {
  const normalized = countryIso2?.trim().toUpperCase() ?? "";
  return match?.link_eligible && /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function targetedGdeltPublicationIsTimely(
  publishedAt: string,
  context: Pick<GdeltTargetedDiscoveryContext, "observedAt">,
): boolean {
  const published = Date.parse(publishedAt);
  const observed = Date.parse(context.observedAt);
  if (!Number.isFinite(published) || !Number.isFinite(observed)) return false;
  return published >= observed - 6 * 3_600_000
    && published <= observed + 72 * 3_600_000;
}

export function selectTargetedGdeltDocCandidates(
  articles: GdeltDocArticle[],
  context: GdeltTargetedDiscoveryContext,
  options: { limit?: number; now?: Date } = {},
): GdeltDocArticle[] {
  const limit = clampInt(options.limit, 1, 12, 8);
  const scopeOrder: GdeltTargetedMatch["scope"][] = [
    "local_place",
    "event_signature",
    "country",
    "full_text_query",
  ];
  const ranked = scopeOrder.flatMap((scope) => selectGdeltDocCandidates(
    articles.filter((article) => describeTargetedGdeltMatch(article, context).scope === scope),
    { limit, now: options.now },
  ));
  const domainLimit = Math.max(1, Math.ceil(limit / 4));
  const selected: GdeltDocArticle[] = [];
  const overflow: GdeltDocArticle[] = [];
  const urls = new Set<string>();
  const domains = new Map<string, number>();
  for (const article of ranked) {
    const url = article.url ?? "";
    if (!url || urls.has(url)) continue;
    urls.add(url);
    const domain = nonEmpty(article.domain) ?? hostnameFromUrl(url) ?? "unknown";
    const count = domains.get(domain) ?? 0;
    if (count >= domainLimit) {
      overflow.push(article);
      continue;
    }
    selected.push(article);
    domains.set(domain, count + 1);
    if (selected.length >= limit) return selected;
  }
  for (const article of overflow) {
    selected.push(article);
    if (selected.length >= limit) break;
  }
  return selected;
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
    const materialityScore = title ? galMaterialityScore(title) : 0;
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
      materialityScore,
    };
    const existing = candidates.get(article.url);
    if (
      !existing || article.materialityScore > existing.materialityScore ||
      (article.materialityScore === existing.materialityScore && article.relevanceScore > existing.relevanceScore) ||
      (article.materialityScore === existing.materialityScore &&
        article.relevanceScore === existing.relevanceScore && article.eventTime > existing.eventTime)
    ) {
      candidates.set(article.url, article);
    }
  }
  const articles = selectDomainDiverseGalArticles(Array.from(candidates.values()), limit, nowMs);
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

async function withGdeltDocRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const previous = gdeltDocRequestTail;
  gdeltDocRequestTail = previous.then(() => turn);
  await previous;
  try {
    const waitMs = Math.max(0, gdeltDocNextRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    return await operation();
  } finally {
    gdeltDocNextRequestAt = Date.now() + GDELT_DOC_MIN_REQUEST_SPACING_MS;
    release();
  }
}

async function fetchRetry(url: string, attempts = 2): Promise<Response> {
  let lastResponse: Response | null = null;
  const hostname = new URL(url).hostname.toLowerCase();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const request = () => fetch(url, {
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "user-agent": process.env.GDELT_USER_AGENT || "Claritas/1.0 (https://claritas.info; engineering@claritas.info)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const response = hostname === "api.gdeltproject.org"
      ? await withGdeltDocRateLimit(request)
      : await request();
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
  selected_candidates: number;
  accepted: number;
  link_eligible: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  quality_quarantined: number;
  quality_rejections: Record<string, number>;
  latest_event_time: string | null;
}> {
  const apiUrl = new URL(process.env.GDELT_DOC_API_URL || DOC_API_URL);
  apiUrl.searchParams.set("query", params.query?.trim() || process.env.GDELT_DOC_QUERY || DEFAULT_GDELT_DOC_QUERY);
  apiUrl.searchParams.set("mode", "artlist");
  const selectionLimit = clampInt(params.maxRecords, 1, 250, 25);
  // Fetch a bounded candidate superset, then admit a diverse/material sample.
  // Asking GDELT for exactly the storage budget repeatedly returned the same
  // top 25 URLs during overlapping polls and hid lower-volume countries.
  const candidateLimit = Math.min(Math.max(selectionLimit * 4, selectionLimit), 250);
  apiUrl.searchParams.set("maxrecords", String(candidateLimit));
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("timespan", params.timespan?.trim() || "1h");
  apiUrl.searchParams.set("sort", "datedesc");
  const response = await fetchRetry(apiUrl.toString());
  const data = (await response.json()) as GdeltDocResponse;
  const rawArticles = Array.isArray(data.articles) ? data.articles : [];
  const articles = params.targetedDiscovery
    ? selectTargetedGdeltDocCandidates(rawArticles, params.targetedDiscovery, { limit: selectionLimit })
    : selectGdeltDocCandidates(rawArticles, { limit: selectionLimit });
  const urls = articles.map((article) => article.url).filter((value): value is string => Boolean(value));
  const signals = urls.length > 0
    ? await query<{ url: string; tone: number | null; themes: unknown; persons: unknown; organizations: unknown; locations: unknown; payload: unknown }>(
        `SELECT DISTINCT ON (url) url, tone, themes, persons, organizations, locations, payload
         FROM news_signal WHERE url = ANY($1::text[]) ORDER BY url, event_time DESC`, [urls]
      )
    : { rows: [] };
  const signalsByUrl = new Map(signals.rows.map((row) => [row.url, row]));
  const verificationNow = new Date();
  const maxPublisherAgeHours = gdeltPublisherMaxAgeHours();
  const maxProviderSeenAgeHours = gdeltProviderSeenMaxAgeHours(params);
  const verifiedArticles = await mapWithConcurrency(
    articles,
    GDELT_ARTICLE_VERIFICATION_CONCURRENCY,
    async (article) => {
      const url = nonEmpty(article.url);
      const providerSeenAt = parseGdeltTimestamp(article.seendate);
      const preflight = assessGdeltDocArticleQuality({
        title: article.title,
        url,
        providerSeenAt,
        publication: null,
        now: verificationNow,
        maxPublisherAgeHours,
        maxProviderSeenAgeHours,
      });
      if (preflight.reason !== "publisher_publication_unverified" || !url) {
        return { article, url, providerSeenAt, quality: preflight };
      }
      const publication = await resolveGdeltPublisherPublicationTime(url);
      return {
        article,
        url,
        providerSeenAt,
        quality: assessGdeltDocArticleQuality({
          title: article.title,
          url,
          providerSeenAt,
          publication,
          now: verificationNow,
          maxPublisherAgeHours,
          maxProviderSeenAgeHours,
        }),
      };
    },
  );
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = Math.max(0, rawArticles.length - articles.length);
  let quarantined = 0;
  const qualityRejections: Record<string, number> = {};
  let latestEventTime: string | null = null;
  let linkEligible = 0;
  for (const candidate of verifiedArticles) {
    const { article, url, providerSeenAt, quality } = candidate;
    if (!quality.accepted || !url || !providerSeenAt || !quality.publication) {
      skipped += 1;
      qualityRejections[quality.reason] = (qualityRejections[quality.reason] ?? 0) + 1;
      if (await quarantineGdeltArticle(sourceId, url, quality.reason, verificationNow.toISOString(), providerSeenAt)) {
        quarantined += 1;
      }
      continue;
    }
    if (params.targetedDiscovery
        && !targetedGdeltPublicationIsTimely(quality.publication.publishedAt, params.targetedDiscovery)) {
      skipped += 1;
      qualityRejections.target_event_time_mismatch = (qualityRejections.target_event_time_mismatch ?? 0) + 1;
      continue;
    }
    // GDELT's seendate is evidence of discovery only. Event ordering uses the
    // verified publisher date, so a re-indexed old URL cannot become new again.
    const eventTime = quality.publication.publishedAt;
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
    const targetedMatch = params.targetedDiscovery
      ? describeTargetedGdeltMatch(article, params.targetedDiscovery)
      : null;
    const targetCountry = params.targetedDiscovery?.countryIso2?.trim().toUpperCase() ?? null;
    const eligibleTargetCountry = eligibleTargetedGdeltCountryFallback(targetedMatch, targetCountry);
    if (targetedMatch?.link_eligible) linkEligible += 1;
    const contentCountry = inference.source === "content_alias" ? inference.iso2 : null;
    // Publisher country and URL TLD are low-confidence hints. For a targeted
    // event query they must not relabel a China story as U.S. merely because a
    // U.S. publisher reported it. Explicit article text/GKG geography still
    // wins, followed by the event-query country with its visible attribution.
    const countryIso2 = contentCountry ?? gkgCountry ?? eligibleTargetCountry ?? inference.iso2 ?? null;
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
      // `seendate` is GDELT's first-seen value, not an article publication
      // timestamp. We retain it for provenance but only expose a source date
      // that passed the publisher-date and freshness checks above.
      time_basis: "publisher_published_verified",
      time_precision: quality.publication.precision,
      publication_time_source: quality.publication.source,
      provider_seen_at: providerSeenAt,
      first_provider_seen_at: providerSeenAt,
      last_provider_seen_at: providerSeenAt,
      publisher_published_at: eventTime,
      quality_status: "accepted",
      quality_checked_at: verificationNow.toISOString(),
      quality_checks: {
        provider_seen_at_valid: true,
        publisher_date_verified: true,
        publisher_date_fresh: true,
        publisher_date_not_after_provider_seen: true,
        article_url_valid: true,
      },
      country_attribution:
        eligibleTargetCountry && !contentCountry && !gkgCountry
          ? "targeted_event_query_fallback"
          : inference.source === "feed_hint" && !gkgCountry && sourceCountry
          ? "publisher_country_fallback"
          : gkgCountry && countryIso2 === gkgCountry
            ? "gkg_location"
            : inference.source,
      ...(params.targetedDiscovery ? {
        targeted_discovery: {
          method: "deterministic_gdelt_doc_event_query_v1",
          event_type: "earthquake",
          earthquake_observation_id: params.targetedDiscovery.earthquakeObservationId,
          usgs_event_id: params.targetedDiscovery.usgsEventId,
          place: params.targetedDiscovery.place,
          country_iso2: targetCountry,
          magnitude: params.targetedDiscovery.magnitude,
          latitude: params.targetedDiscovery.latitude,
          longitude: params.targetedDiscovery.longitude,
          observed_at: params.targetedDiscovery.observedAt,
          query: params.targetedDiscovery.query,
          match: targetedMatch,
        },
      } : {}),
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
         country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2),
         -- Preserve the earliest verified publisher date. A subsequent GDELT
         -- rediscovery must update provenance, never promote an old URL.
         event_time = COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time),
         payload = item.payload || EXCLUDED.payload || jsonb_build_object(
           'first_provider_seen_at', COALESCE(
             item.payload->>'first_provider_seen_at',
             item.payload->>'provider_seen_at',
             EXCLUDED.payload->>'first_provider_seen_at'
           ),
           'last_provider_seen_at', EXCLUDED.payload->>'last_provider_seen_at',
           'provider_seen_at', EXCLUDED.payload->>'provider_seen_at',
           'publisher_published_at', to_jsonb(COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time))
         ),
         dedupe_hash = EXCLUDED.dedupe_hash,
         language_code = COALESCE(EXCLUDED.language_code, item.language_code),
         source_country_iso2 = COALESCE(EXCLUDED.source_country_iso2, item.source_country_iso2),
         tone = COALESCE(EXCLUDED.tone, item.tone), updated_at = now()
       WHERE item.title IS DISTINCT FROM COALESCE(EXCLUDED.title, item.title)
          OR item.summary IS DISTINCT FROM COALESCE(EXCLUDED.summary, item.summary)
          OR item.country_iso2 IS DISTINCT FROM COALESCE(EXCLUDED.country_iso2, item.country_iso2)
          OR item.event_time IS DISTINCT FROM COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time)
          OR item.payload IS DISTINCT FROM item.payload || EXCLUDED.payload || jsonb_build_object(
            'first_provider_seen_at', COALESCE(
              item.payload->>'first_provider_seen_at',
              item.payload->>'provider_seen_at',
              EXCLUDED.payload->>'first_provider_seen_at'
            ),
            'last_provider_seen_at', EXCLUDED.payload->>'last_provider_seen_at',
            'provider_seen_at', EXCLUDED.payload->>'provider_seen_at',
            'publisher_published_at', to_jsonb(COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time))
          )
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
    fetched: rawArticles.length,
    selected_candidates: articles.length,
    accepted: inserted + updated + unchanged,
    link_eligible: linkEligible,
    inserted,
    updated,
    unchanged,
    skipped,
    quality_quarantined: quarantined,
    quality_rejections: qualityRejections,
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

async function ingestGalFallback(
  sourceId: number,
  params: GdeltIngestParams,
  reason: "gdelt_doc_unavailable" | "coverage_diversity_supplement" = "gdelt_doc_unavailable",
): Promise<Record<string, unknown>> {
  const response = await fetchRetry(process.env.GDELT_GAL_RSS_URL?.trim() || GAL_RSS_URL);
  const xml = await response.text();
  const selectedLimit = clampInt(params.maxRecords ?? process.env.GDELT_GAL_MAX_ARTICLES, 1, 250, 25);
  const maxProviderSeenAgeHours = clampHours(process.env.GDELT_GAL_MAX_AGE_HOURS, 48);
  const parsed = parseGdeltGalRss(xml, {
    // Inspect a small bounded superset before source-date verification so a
    // few unverifiable results cannot starve the degraded fallback entirely.
    limit: Math.min(selectedLimit * 4, 250),
    maxAgeHours: maxProviderSeenAgeHours,
  });
  const verificationNow = new Date();
  const maxPublisherAgeHours = gdeltPublisherMaxAgeHours();
  const verifiedArticles = await mapWithConcurrency(
    parsed.articles,
    GDELT_ARTICLE_VERIFICATION_CONCURRENCY,
    async (article) => {
      const preflight = assessGdeltDocArticleQuality({
        title: article.title,
        url: article.url,
        providerSeenAt: article.eventTime,
        publication: null,
        now: verificationNow,
        maxPublisherAgeHours,
        maxProviderSeenAgeHours,
      });
      if (preflight.reason !== "publisher_publication_unverified") return { article, quality: preflight };
      const publication = await resolveGdeltPublisherPublicationTime(article.url);
      return {
        article,
        quality: assessGdeltDocArticleQuality({
          title: article.title,
          url: article.url,
          providerSeenAt: article.eventTime,
          publication,
          now: verificationNow,
          maxPublisherAgeHours,
          maxProviderSeenAgeHours,
        }),
      };
    },
  );
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = parsed.skipped;
  let quarantined = 0;
  const qualityRejections: Record<string, number> = {};
  let latestEventTime: string | null = null;
  let selected = 0;

  for (const candidate of verifiedArticles) {
    const { article, quality } = candidate;
    if (!quality.accepted || !quality.publication) {
      skipped += 1;
      qualityRejections[quality.reason] = (qualityRejections[quality.reason] ?? 0) + 1;
      if (await quarantineGdeltArticle(sourceId, article.url, quality.reason, verificationNow.toISOString(), article.eventTime)) {
        quarantined += 1;
      }
      continue;
    }
    if (selected >= selectedLimit) {
      // This is a bounded ingest, not a quality rejection. Keep the overflow
      // out of storage so degraded operation cannot grow the headline budget.
      skipped += 1;
      continue;
    }
    selected += 1;
    const eventTime = quality.publication.publishedAt;
    if (!latestEventTime || eventTime > latestEventTime) latestEventTime = eventTime;
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
      materiality_filter_score: article.materialityScore,
      time_basis: "publisher_published_verified",
      time_precision: quality.publication.precision,
      publication_time_source: quality.publication.source,
      provider_time_at: article.eventTime,
      provider_seen_at: article.eventTime,
      first_provider_seen_at: article.eventTime,
      last_provider_seen_at: article.eventTime,
      publisher_published_at: eventTime,
      quality_status: "accepted",
      quality_checked_at: verificationNow.toISOString(),
      quality_checks: {
        provider_seen_at_valid: true,
        publisher_date_verified: true,
        publisher_date_fresh: true,
        publisher_date_not_after_provider_seen: true,
        article_url_valid: true,
      },
      fallback_reason: reason,
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
         event_time = CASE
           WHEN item.payload->>'product' = 'doc-2.0' THEN item.event_time
           ELSE COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time)
         END,
         payload = CASE
           WHEN item.payload->>'product' = 'doc-2.0'
             THEN item.payload || jsonb_build_object(
               'gal_fallback_seen_at', EXCLUDED.payload->>'provider_seen_at',
               'gal_fallback_relevance_score', EXCLUDED.payload->'relevance_filter_score'
             )
           ELSE item.payload || EXCLUDED.payload || jsonb_build_object(
             'first_provider_seen_at', COALESCE(
               item.payload->>'first_provider_seen_at',
               item.payload->>'provider_seen_at',
               EXCLUDED.payload->>'first_provider_seen_at'
             ),
             'last_provider_seen_at', EXCLUDED.payload->>'last_provider_seen_at',
             'provider_seen_at', EXCLUDED.payload->>'provider_seen_at',
             'publisher_published_at', to_jsonb(COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time))
           )
         END,
         dedupe_hash = EXCLUDED.dedupe_hash,
         updated_at = now()
       WHERE item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
          OR (item.title IS NULL AND EXCLUDED.title IS NOT NULL)
          OR (item.country_iso2 IS NULL AND EXCLUDED.country_iso2 IS NOT NULL)
          OR (
            item.payload->>'product' = 'doc-2.0'
            AND item.payload->>'gal_fallback_seen_at' IS DISTINCT FROM EXCLUDED.payload->>'provider_seen_at'
          )
          OR (
            item.payload->>'product' IS DISTINCT FROM 'doc-2.0'
            AND (
              item.event_time IS DISTINCT FROM COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time)
              OR item.payload IS DISTINCT FROM item.payload || EXCLUDED.payload || jsonb_build_object(
                'first_provider_seen_at', COALESCE(
                  item.payload->>'first_provider_seen_at',
                  item.payload->>'provider_seen_at',
                  EXCLUDED.payload->>'first_provider_seen_at'
                ),
                'last_provider_seen_at', EXCLUDED.payload->>'last_provider_seen_at',
                'provider_seen_at', EXCLUDED.payload->>'provider_seen_at',
                'publisher_published_at', to_jsonb(COALESCE(LEAST(item.event_time, EXCLUDED.event_time), item.event_time, EXCLUDED.event_time))
              )
            )
          )
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, article.url, article.title, article.url, inference.iso2, eventTime, JSON.stringify(payload), dedupeHash],
    );
    if (!result.rows[0]) unchanged += 1;
    else if (result.rows[0].inserted) inserted += 1;
    else updated += 1;
  }

  return {
    provider: "gdelt",
    product: "gal-rss",
    health: reason === "gdelt_doc_unavailable" ? "degraded_fallback" : "supplemental",
    fetched: parsed.feed_items,
    selected,
    inserted,
    updated,
    unchanged,
    skipped,
    quality_quarantined: quarantined,
    quality_rejections: qualityRejections,
    latest_event_time: latestEventTime,
    coverage: "bounded materiality- and publisher-diverse sample from GDELT's rolling 15-minute global feed",
  };
}

/**
 * Runs one small event-specific DOC search. It deliberately reuses the same
 * publisher-date verification, URL safety, diversity and URL idempotency path
 * as the scheduled global feed, but does not fetch the unrelated Event/GKG
 * archives or the global GAL supplement.
 */
export async function ingestTargetedGdeltNews(
  context: GdeltTargetedDiscoveryContext,
  options: { timespan?: string; maxRecords?: number } = {},
): Promise<Record<string, unknown>> {
  if (!context.query.trim() || !context.earthquakeObservationId || !context.usgsEventId) {
    throw new Error("Targeted GDELT discovery requires an earthquake identity and a non-empty query.");
  }
  const sourceId = await ensureSource();
  const articles = await ingestDocArticles(sourceId, {
    query: context.query,
    timespan: options.timespan?.trim() || "3d",
    maxRecords: clampInt(options.maxRecords, 1, 12, 8),
    includeDoc: true,
    includeEvents: false,
    includeGkg: false,
    targetedDiscovery: context,
  });
  return {
    provider: "gdelt",
    product: "doc-2.0-targeted-event",
    health: articles.link_eligible > 0
      ? "likely_coverage_found"
      : articles.accepted > 0
        ? "review_candidates_only"
        : "no_verified_coverage",
    target: {
      event_type: "earthquake",
      earthquake_observation_id: context.earthquakeObservationId,
      usgs_event_id: context.usgsEventId,
      country_iso2: context.countryIso2,
      observed_at: context.observedAt,
    },
    query: context.query,
    articles,
    accepted: articles.accepted,
    link_eligible: articles.link_eligible,
    inserted: articles.inserted,
    updated: articles.updated,
    unchanged: articles.unchanged,
    skipped: articles.skipped,
    latest_event_time: articles.latest_event_time,
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
    const headlineBudgets = planGdeltHeadlineBudgets(params.maxRecords ?? process.env.GDELT_DOC_MAX_ARTICLES);
    result.headline_budget = headlineBudgets;
    try {
      const doc = await ingestDocArticles(sourceId, { ...params, maxRecords: headlineBudgets.doc });
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

      // GAL is an independent global view, not merely an outage substitute.
      // Fill the reserved lane—and any DOC quality-rejection shortfall—without
      // exceeding the caller's configured headline budget.
      const supplementBudget = Math.max(
        headlineBudgets.galReserve,
        headlineBudgets.total - doc.accepted,
      );
      if (supplementBudget > 0) {
        try {
          const supplement = await ingestGalFallback(
            sourceId,
            { ...params, maxRecords: supplementBudget },
            "coverage_diversity_supplement",
          );
          result.gal_supplement = supplement;
          result.gal_supplement_status = hasUsableGdeltFallbackCoverage(supplement) ? "healthy" : "empty";
          result.inserted = Number(result.inserted) + Number(supplement.inserted ?? 0);
          result.updated = Number(result.updated) + Number(supplement.updated ?? 0);
          result.skipped = Number(result.skipped) + Number(supplement.skipped ?? 0);
          if (
            typeof supplement.latest_event_time === "string" &&
            (!result.latest_event_time || supplement.latest_event_time > String(result.latest_event_time))
          ) {
            result.latest_event_time = supplement.latest_event_time;
          }
        } catch (supplementError) {
          const message = supplementError instanceof Error ? supplementError.message : String(supplementError);
          result.gal_supplement_status = "failed";
          result.gal_supplement_error = message;
          result.partial = true;
          result.http_failures = Number(result.http_failures) + (/\bHTTP\b/i.test(message) ? 1 : 0);
        }
      }
    } catch (error) {
      const docError = error instanceof Error ? error.message : String(error);
      result.doc_error = docError;
      result.doc_status = "degraded";
      result.health = "failed";
      result.http_failures = Number(result.http_failures) + (/\bHTTP\b/i.test(docError) ? 1 : 0);
      result.partial = true;
      try {
        const fallback = await ingestGalFallback(sourceId, { ...params, maxRecords: headlineBudgets.total });
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
