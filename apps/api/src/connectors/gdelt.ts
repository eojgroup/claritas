import crypto from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { unzipSync } from "fflate";
import worldCountries from "world-countries";
import { query, withTransaction } from "../db";
import { hasEarthquakeHeadlineSignal } from "../earthquake-language";
import { trustedNewsDirectCountrySql } from "../news-country-attribution";
import { inferNewsCountry, trustedSubjectCountryIso2 } from "./country-inference";

const DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_DATA_BASE_URL = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv2";
const GAL_RSS_URL = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv3/gal/feed.rss";
export const GDELT_DISCOVERY_LANES = [
  {
    id: "markets_macro",
    weight: 7,
    query: "(\"stock market\" OR stocks OR shares OR equities OR bonds OR treasury OR yields OR forex OR currency OR futures OR commodities OR inflation OR \"central bank\" OR \"Wall Street\" OR \"S&P 500\" OR Nasdaq OR FTSE OR DAX OR Nikkei OR \"Hang Seng\" OR rally OR selloff)",
  },
  {
    id: "companies_technology",
    weight: 4,
    query: "(earnings OR merger OR acquisition OR bankruptcy OR IPO OR semiconductor OR cybersecurity OR \"artificial intelligence\")",
  },
  {
    id: "geopolitics_policy",
    weight: 4,
    query: "(geopolitics OR sanctions OR conflict OR military OR election OR tariff OR regulation OR antitrust)",
  },
  {
    id: "energy_transport",
    weight: 3,
    query: "(energy OR oil OR gas OR OPEC OR shipping OR port OR aviation OR transport OR logistics OR \"supply chain\" OR agriculture OR food)",
  },
  {
    id: "major_hazards_health",
    weight: 2,
    query: "(disaster OR earthquake OR aftershock OR tsunami OR volcano OR landslide OR wildfire OR flood OR hurricane OR typhoon OR cyclone OR outbreak OR epidemic OR \"public health\")",
  },
] as const;
export const DEFAULT_GDELT_DOC_QUERY = `(${GDELT_DISCOVERY_LANES.map((lane) => lane.query.slice(1, -1)).join(" OR ")})`;
const ATTRIBUTION = "GDELT Project";
const GDELT_DOC_DEFAULT_MAX_PUBLISH_AGE_HOURS = 72;
const GDELT_DOC_DEFAULT_MAX_PROVIDER_SEEN_AGE_HOURS = 3;
const GDELT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
const GDELT_ARTICLE_HTML_MAX_BYTES = 350_000;
const GDELT_ARTICLE_VERIFICATION_CONCURRENCY = 4;
const GDELT_DOC_MIN_REQUEST_SPACING_MS = 5_500;
export const GDELT_CANONICAL_URL_ALGORITHM = "whatwg-url-v1";
const GDELT_CANONICAL_RECONCILIATION_BATCH_SIZE = 500;
let gdeltDocRequestTail: Promise<void> = Promise.resolve();
let gdeltDocNextRequestAt = 0;

export type GdeltDocArticle = {
  url?: string;
  /** Original provider URL retained only to reconcile pre-normalisation rows. */
  raw_url?: string;
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

export type GdeltPublisherContext = {
  description: string | null;
  keywords: string[];
  /** Country codes from Place/addressCountry inside the article-owned JSON-LD subtree only. */
  structuredCountryIso2s: string[];
};

type GdeltPublisherEvidence = {
  publication: GdeltPublicationTime | null;
  context: GdeltPublisherContext;
};

export type GdeltDocQualityResult = {
  accepted: boolean;
  reason:
    | "accepted"
    | "accepted_provider_first_seen"
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
    | "publisher_date_after_provider_seen"
    | "canonical_duplicate_merged";
  publication: GdeltPublicationTime | null;
  effectiveTime: string | null;
  timeBasis: "publisher_published_verified" | "provider_first_seen" | null;
};

export type GdeltGalArticle = {
  title: string;
  url: string;
  eventTime: string;
  domain: string;
  relevanceScore: number;
  materialityScore: number;
  discoveryLane: GdeltDiscoveryLaneId;
};

export type ExistingGdeltItem = {
  id: string;
  external_id: string;
  url: string | null;
  dedupe_hash: string | null;
  first_provider_seen_at: string | null;
  quality_status: string | null;
  time_basis: string | null;
  publication_time_verified: boolean | null;
  publisher_published_at: string | null;
  publication_time_source: string | null;
  time_precision: string | null;
  event_time: string | null;
  country_iso2: string | null;
  country_attribution: string | null;
  country_inference_source: string | null;
  country_inference_confidence: string | null;
  country_inference: unknown;
  subject_country_iso2s: unknown;
  gkg: unknown;
};

export type GdeltAliasPersistencePlan = {
  persistenceItemId: string | null;
  persistenceExternalId: string;
  firstProviderSeenAt: string | null;
  providerFirstSeenEventTime: string | null;
  verifiedPublication: {
    publishedAt: string;
    source: string | null;
    precision: string | null;
  } | null;
  countryIso2: string | null;
  countryAttribution: string | null;
  countryInference: unknown;
  subjectCountryIso2s: string[];
  gkg: unknown;
};

type GdeltCanonicalItemRow = {
  id: string;
  url: string | null;
  external_id: string;
};

type GdeltCanonicalSignalRow = {
  id: string;
  url: string | null;
  raw_url: string | null;
};

export type GdeltDiscoveryLaneId = (typeof GDELT_DISCOVERY_LANES)[number]["id"];

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

export type GdeltDiscoveryLaneBudget = {
  id: string;
  query: string;
  budget: number;
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

export function planGdeltDiscoveryLaneBudgets(value: unknown): GdeltDiscoveryLaneBudget[] {
  const total = clampInt(value, 1, 250, 20);
  if (total < GDELT_DISCOVERY_LANES.length) {
    return GDELT_DISCOVERY_LANES.slice(0, total).map((lane) => ({
      id: lane.id,
      query: lane.query,
      budget: 1,
    }));
  }
  const totalWeight = GDELT_DISCOVERY_LANES.reduce((sum, lane) => sum + lane.weight, 0);
  const allocations = GDELT_DISCOVERY_LANES.map((lane) => ({
    id: lane.id,
    query: lane.query,
    budget: 1,
    remainder: 0,
  }));
  let remaining = total - allocations.length;
  for (const allocation of allocations) {
    const lane = GDELT_DISCOVERY_LANES.find((candidate) => candidate.id === allocation.id)!;
    const exact = remaining * lane.weight / totalWeight;
    const extra = Math.floor(exact);
    allocation.budget += extra;
    allocation.remainder = exact - extra;
  }
  let assigned = allocations.reduce((sum, allocation) => sum + allocation.budget, 0);
  for (const allocation of [...allocations].sort((left, right) => (
    right.remainder - left.remainder || left.id.localeCompare(right.id)
  ))) {
    if (assigned >= total) break;
    allocation.budget += 1;
    assigned += 1;
  }
  return allocations.map(({ remainder: _remainder, ...allocation }) => allocation);
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
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_/i.test(key) || [
        "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "vero_conv", "vero_id",
      ].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
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

function jsonLdPublicationCandidates(
  value: unknown,
  candidates: GdeltPublicationTime[],
  depth = 0,
  articleScope = false,
): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) jsonLdPublicationCandidates(child, candidates, depth + 1, articleScope);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const rawTypes = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  const types = rawTypes.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase());
  const isArticle = types.some((type) => [
    "article", "newsarticle", "reportagenewsarticle", "analysisnewsarticle", "report",
  ].includes(type));
  const articleContainerKeys = new Set([
    "@graph", "mainentity", "subjectof", "haspart", "itemlistelement",
  ]);
  for (const [key, child] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    if ((isArticle || articleScope) && (normalizedKey === "datepublished" || normalizedKey === "datecreated")) {
      const candidate = publicationCandidate(child, "json_ld");
      if (candidate) candidates.push(candidate);
    }
    if (["publisher", "author", "creator", "copyrightholder", "provider", "sourceorganization", "editor"].includes(normalizedKey)) {
      continue;
    }
    if (!isArticle && !articleScope && articleContainerKeys.has(normalizedKey)) {
      jsonLdPublicationCandidates(child, candidates, depth + 1, false);
    } else if (types.length === 0 && !articleScope) {
      // Untyped wrappers may contain the typed article node. Once inside an
      // article, dates on nested ImageObject/WebPage nodes are not publication
      // evidence and are intentionally not traversed.
      jsonLdPublicationCandidates(child, candidates, depth + 1, false);
    }
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

function boundedPublisherContextText(value: unknown, maximum = 600): string | null {
  if (typeof value !== "string") return null;
  const normalized = decodeXml(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function collectJsonLdPublisherContext(
  value: unknown,
  output: string[],
  structuredCountries: Set<string>,
  depth = 0,
  articleOwnedContext = false,
  trustedLocationContext = false,
): void {
  if (depth > 10 || output.length >= 40 || value == null) return;
  if (Array.isArray(value)) {
    value.slice(0, 30).forEach((entry) => collectJsonLdPublisherContext(
      entry,
      output,
      structuredCountries,
      depth + 1,
      articleOwnedContext,
      trustedLocationContext,
    ));
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const rawTypes = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  const types = rawTypes.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase());
  const isArticleNode = types.some((type) => [
    "article", "newsarticle", "reportagenewsarticle", "analysisnewsarticle", "report",
  ].includes(type));
  const isTypedLocationNode = types.some((type) => [
    "place", "administrativearea", "country", "city", "state",
  ].includes(type));
  const trustedLocation = trustedLocationContext || (articleOwnedContext && isTypedLocationNode);
  // @graph commonly includes a sibling Organization/Person node. Only an
  // article node and the article's own location/about subtree may contribute
  // subject context; sibling publisher metadata is ignored completely.
  const articleContainerKeys = new Set([
    "@graph", "mainentity", "subjectof", "haspart", "itemlistelement",
  ]);

  for (const [key, child] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    // Publisher/author geography identifies who produced the page, not what
    // the article is about. Never let those subtrees leak into subject-country
    // inference (the production GB heatmap skew was one consequence).
    if ([
      "publisher", "author", "creator", "copyrightholder", "provider",
      "sourceorganization", "editor",
    ].includes(normalizedKey)) continue;
    const descriptiveField = ["description", "keywords", "articlesection"].includes(normalizedKey);
    const locationField = ["about", "contentlocation", "locationcreated"].includes(normalizedKey);
    const explicitLocationField = ["contentlocation", "locationcreated"].includes(normalizedKey);
    const locationLabelField = ["name", "alternatename"].includes(normalizedKey);
    const locationChildField = ["address", "geo", "containedinplace", "containsplace"].includes(normalizedKey);
    const countryField = normalizedKey === "addresscountry";
    if (
      (descriptiveField && (isArticleNode || articleOwnedContext))
      || (locationField && (isArticleNode || articleOwnedContext))
      || (locationLabelField && articleOwnedContext)
      || (locationChildField && trustedLocation)
      || (countryField && trustedLocation)
    ) {
      if (typeof child === "string") {
        const normalized = boundedPublisherContextText(child, 300);
        if (normalized) output.push(normalized);
        if ((trustedLocation || (isArticleNode && explicitLocationField))
            && (countryField || locationLabelField || explicitLocationField)) {
          const structuredCountry = countryNameToIso2(child);
          if (structuredCountry) structuredCountries.add(structuredCountry);
        }
        if (normalizedKey === "addresscountry" && /^[A-Za-z]{2}$/.test(child.trim())) {
          const countryName = worldCountries.find((country) => country.cca2 === child.trim().toUpperCase())?.name.common;
          if (countryName) output.push(countryName);
        }
      } else {
        collectJsonLdPublisherContext(
          child,
          output,
          structuredCountries,
          depth + 1,
          articleOwnedContext || locationField,
          trustedLocation || explicitLocationField,
        );
      }
    } else if (
      !isArticleNode &&
      !articleOwnedContext &&
      articleContainerKeys.has(normalizedKey) &&
      child &&
      typeof child === "object"
    ) {
      collectJsonLdPublisherContext(child, output, structuredCountries, depth + 1, false, false);
    } else if (types.length === 0 && child && typeof child === "object") {
      // JSON-LD wrappers without @type may contain the actual article node.
      collectJsonLdPublisherContext(
        child,
        output,
        structuredCountries,
        depth + 1,
        articleOwnedContext,
        trustedLocation,
      );
    }
  }
}

/**
 * Extracts bounded publisher metadata for transient subject-country inference.
 * The article body is neither parsed nor stored.
 */
export function extractGdeltPublisherContext(html: string): GdeltPublisherContext {
  let description: string | null = null;
  const keywords: string[] = [];
  const structuredCountries = new Set<string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = htmlAttributes(match[0]);
    const keys = [attributes.property, attributes.name, attributes.itemprop]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());
    if (!description && keys.some((key) => ["description", "og:description", "twitter:description"].includes(key))) {
      description = boundedPublisherContextText(attributes.content);
    }
    if (keys.includes("keywords")) {
      for (const candidate of String(attributes.content ?? "").split(/[,;|]/)) {
        const normalized = boundedPublisherContextText(candidate, 100);
        if (normalized) keywords.push(normalized);
      }
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)) {
    const openingTag = match[0].slice(0, match[0].indexOf(">") + 1);
    if (!/application\/ld\+json/i.test(htmlAttributes(openingTag).type ?? "")) continue;
    try {
      const values: string[] = [];
      collectJsonLdPublisherContext(JSON.parse(match[1]), values, structuredCountries);
      for (const value of values) {
        if (!description && value.length >= 40) description = value.slice(0, 600);
        else keywords.push(value.slice(0, 100));
      }
    } catch {
      // Ignore malformed publisher JSON-LD and retain any valid meta fields.
    }
  }
  return {
    description,
    keywords: Array.from(new Set(keywords.map((value) => value.toLocaleLowerCase()))).slice(0, 20),
    structuredCountryIso2s: Array.from(structuredCountries).sort(),
  };
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

async function resolveGdeltPublisherEvidence(url: string): Promise<GdeltPublisherEvidence> {
  const urlCandidate = publicationTimeFromUrl(url);
  try {
    const page = await requestVerifiedPublisherPage(url);
    if (!page) return {
      publication: urlCandidate,
      context: { description: null, keywords: [], structuredCountryIso2s: [] },
    };
    // The final URL receives the same conservative date check. A redirect
    // cannot remove an older date embedded in the original canonical URL.
    const original = extractGdeltPublisherPublicationTime(page.html, url);
    const redirected = page.finalUrl === url
      ? null
      : extractGdeltPublisherPublicationTime(page.html, page.finalUrl);
    return {
      publication: selectConservativePublicationTime(
        [original, redirected].filter((value): value is GdeltPublicationTime => Boolean(value)),
      ),
      context: extractGdeltPublisherContext(page.html),
    };
  } catch {
    // An unambiguous publication date embedded in a canonical article URL is
    // still more defensible than GDELT discovery time when a publisher blocks
    // metadata requests. With neither, the article is rejected below.
    return {
      publication: urlCandidate,
      context: { description: null, keywords: [], structuredCountryIso2s: [] },
    };
  }
}

async function resolveGdeltPublisherPublicationTime(url: string): Promise<GdeltPublicationTime | null> {
  return (await resolveGdeltPublisherEvidence(url)).publication;
}

export function assessGdeltDocArticleQuality(input: {
  title?: string | null;
  url?: string | null;
  providerSeenAt?: string | null;
  publication?: GdeltPublicationTime | null;
  now?: Date;
  maxPublisherAgeHours?: number;
  maxProviderSeenAgeHours?: number;
  allowProviderFirstSeen?: boolean;
}): GdeltDocQualityResult {
  const reject = (
    reason: Exclude<GdeltDocQualityResult["reason"], "accepted" | "accepted_provider_first_seen">,
    publication: GdeltPublicationTime | null = null,
  ): GdeltDocQualityResult => ({
    accepted: false,
    reason,
    publication,
    effectiveTime: null,
    timeBasis: null,
  });
  const title = input.title?.trim() ?? "";
  if (!title || title.length < 12 || title.length > 500 || GDELT_LOW_VALUE_TITLE.test(title)) {
    return reject("missing_title");
  }
  const url = usableGdeltArticleUrl(input.url);
  if (!url) return reject("missing_or_unsafe_url");
  if (!isLikelyArticleUrl(url)) return reject("non_article_url");

  const seenAt = input.providerSeenAt ? Date.parse(input.providerSeenAt) : Number.NaN;
  if (!Number.isFinite(seenAt)) return reject("invalid_provider_seen_at");
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (seenAt > nowMs + GDELT_MAX_FUTURE_SKEW_MS) {
    return reject("provider_seen_at_in_future");
  }
  const maxProviderSeenAgeMs = clampHours(input.maxProviderSeenAgeHours, GDELT_DOC_DEFAULT_MAX_PROVIDER_SEEN_AGE_HOURS) * 3_600_000;
  if (nowMs - seenAt > maxProviderSeenAgeMs) {
    return reject("provider_seen_at_outside_window");
  }

  const publication = input.publication ?? null;
  if (!publication) {
    if (input.allowProviderFirstSeen) {
      return {
        accepted: true,
        reason: "accepted_provider_first_seen",
        publication: null,
        effectiveTime: new Date(seenAt).toISOString(),
        timeBasis: "provider_first_seen",
      };
    }
    return reject("publisher_publication_unverified");
  }
  const publishedAt = Date.parse(publication.publishedAt);
  if (!Number.isFinite(publishedAt)) return reject("publisher_published_at_invalid");
  if (publishedAt > nowMs + GDELT_MAX_FUTURE_SKEW_MS) {
    return reject("publisher_published_at_in_future");
  }
  const maxPublisherAgeMs = clampHours(input.maxPublisherAgeHours, GDELT_DOC_DEFAULT_MAX_PUBLISH_AGE_HOURS) * 3_600_000;
  if (nowMs - publishedAt > maxPublisherAgeMs) {
    return reject("publisher_published_at_stale", publication);
  }
  if (publishedAt > seenAt + GDELT_MAX_FUTURE_SKEW_MS) {
    return reject("publisher_date_after_provider_seen", publication);
  }
  return {
    accepted: true,
    reason: "accepted",
    publication,
    effectiveTime: publication.publishedAt,
    timeBasis: "publisher_published_verified",
  };
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
  title: string | null | undefined,
  reason: GdeltDocQualityResult["reason"],
  checkedAt: string,
  providerSeenAt: string | null,
): Promise<boolean> {
  if (!url) return false;
  const canonicalUrl = canonicalGdeltUrl(url);
  const { rows } = await query<{ id: number }>(
    `INSERT INTO item (
       source_id,external_id,kind,title,url,event_time,payload
     ) VALUES (
       $1,$2,'news_article',$3,$2,$6::timestamptz,jsonb_build_object(
         'provider','gdelt',
         'quality_status','rejected',
         'quality_rejection_reason',$4,
         'quality_checked_at',$5,
         'first_provider_seen_at',$6,
         'last_provider_seen_at',$6,
         'provider_seen_at',$6,
         'canonical_url',$7,
         'canonical_url_algorithm',$8
       )
     )
     ON CONFLICT (source_id,external_id) DO UPDATE SET
       payload = item.payload || jsonb_build_object(
           'quality_status', 'rejected',
           'quality_rejection_reason', $4,
           'quality_checked_at', $5,
           'first_provider_seen_at', COALESCE(
             item.payload->>'first_provider_seen_at',
             item.payload->>'provider_seen_at',
             $6::text
           ),
           'canonical_url',$7::text,
           'canonical_url_algorithm',$8::text
         ) || CASE
           WHEN $6::text IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('last_provider_seen_at', $6::text)
         END,
       updated_at = now()
     WHERE item.kind='news_article'
       AND (
         item.payload->>'quality_status' IS DISTINCT FROM 'rejected'
         OR item.payload->>'quality_rejection_reason' IS DISTINCT FROM $4
         OR item.payload->>'canonical_url' IS DISTINCT FROM $7::text
         OR item.payload->>'canonical_url_algorithm' IS DISTINCT FROM $8::text
       )
     RETURNING id`,
    [
      sourceId,
      url,
      title ?? null,
      reason,
      checkedAt,
      providerSeenAt,
      canonicalUrl,
      GDELT_CANONICAL_URL_ALGORITHM,
    ],
  );
  return rows.length > 0;
}

const EXISTING_GDELT_TIME_VERIFIED_SQL = `(
  COALESCE(item.payload->>'publication_time_verified'='true',false)
  OR COALESCE(item.payload->>'time_basis' LIKE 'publisher_published%',false)
)`;
const INCOMING_GDELT_TIME_VERIFIED_SQL = `(
  COALESCE(EXCLUDED.payload->>'publication_time_verified'='true',false)
  OR COALESCE(EXCLUDED.payload->>'time_basis' LIKE 'publisher_published%',false)
)`;
const MERGED_GDELT_EVENT_TIME_SQL = `CASE
  WHEN ${EXISTING_GDELT_TIME_VERIFIED_SQL} AND NOT ${INCOMING_GDELT_TIME_VERIFIED_SQL}
    THEN item.event_time
  WHEN ${INCOMING_GDELT_TIME_VERIFIED_SQL} AND NOT ${EXISTING_GDELT_TIME_VERIFIED_SQL}
    THEN EXCLUDED.event_time
  ELSE COALESCE(LEAST(item.event_time,EXCLUDED.event_time),item.event_time,EXCLUDED.event_time)
END`;
const MERGED_GDELT_COUNTRY_SQL = `COALESCE(EXCLUDED.country_iso2,CASE
  WHEN ${trustedNewsDirectCountrySql("item")} THEN item.country_iso2
  ELSE NULL
END)`;
const MERGED_GDELT_PAYLOAD_SQL = `(item.payload-'canonical_alias_of_item_id'-'canonical_alias_synchronized_at')
  || EXCLUDED.payload || jsonb_build_object(
  'first_provider_seen_at',COALESCE(
    LEAST(
      NULLIF(COALESCE(item.payload->>'first_provider_seen_at',item.payload->>'provider_seen_at'),''),
      NULLIF(EXCLUDED.payload->>'first_provider_seen_at','')
    ),
    NULLIF(COALESCE(item.payload->>'first_provider_seen_at',item.payload->>'provider_seen_at'),''),
    NULLIF(EXCLUDED.payload->>'first_provider_seen_at','')
  ),
  'last_provider_seen_at',EXCLUDED.payload->>'last_provider_seen_at',
  'provider_seen_at',EXCLUDED.payload->>'provider_seen_at',
  'time_basis',CASE
    WHEN ${EXISTING_GDELT_TIME_VERIFIED_SQL} OR ${INCOMING_GDELT_TIME_VERIFIED_SQL}
      THEN 'publisher_published_verified'
    ELSE 'provider_first_seen'
  END,
  'publication_time_verified',${EXISTING_GDELT_TIME_VERIFIED_SQL} OR ${INCOMING_GDELT_TIME_VERIFIED_SQL},
  'provider_discovery_fallback',NOT (${EXISTING_GDELT_TIME_VERIFIED_SQL} OR ${INCOMING_GDELT_TIME_VERIFIED_SQL}),
  'publisher_published_at',COALESCE(
    LEAST(
      NULLIF(item.payload->>'publisher_published_at',''),
      NULLIF(EXCLUDED.payload->>'publisher_published_at','')
    ),
    NULLIF(item.payload->>'publisher_published_at',''),
    NULLIF(EXCLUDED.payload->>'publisher_published_at','')
  ),
  'publication_time_source',CASE
    WHEN NULLIF(item.payload->>'publisher_published_at','') IS NOT NULL
     AND (
       NULLIF(EXCLUDED.payload->>'publisher_published_at','') IS NULL
       OR item.payload->>'publisher_published_at'<=EXCLUDED.payload->>'publisher_published_at'
     ) THEN item.payload->>'publication_time_source'
    ELSE EXCLUDED.payload->>'publication_time_source'
  END,
  'time_precision',CASE
    WHEN NULLIF(item.payload->>'publisher_published_at','') IS NOT NULL
     AND (
       NULLIF(EXCLUDED.payload->>'publisher_published_at','') IS NULL
       OR item.payload->>'publisher_published_at'<=EXCLUDED.payload->>'publisher_published_at'
    ) THEN item.payload->>'time_precision'
    ELSE EXCLUDED.payload->>'time_precision'
  END,
  -- Country evidence must move as one unit. A transient GKG miss may update
  -- discovery provenance, but it cannot erase a previously trusted subject
  -- location while MERGED_GDELT_COUNTRY_SQL retains that location.
  'country_attribution',CASE
    WHEN EXCLUDED.country_iso2 IS NOT NULL THEN EXCLUDED.payload->>'country_attribution'
    ELSE COALESCE(item.payload->>'country_attribution',EXCLUDED.payload->>'country_attribution')
  END,
  'country_inference',CASE
    WHEN EXCLUDED.country_iso2 IS NOT NULL THEN EXCLUDED.payload->'country_inference'
    ELSE COALESCE(item.payload->'country_inference',EXCLUDED.payload->'country_inference')
  END,
  'subject_country_iso2s',CASE
    WHEN jsonb_typeof(EXCLUDED.payload->'subject_country_iso2s')='array'
     AND jsonb_array_length(EXCLUDED.payload->'subject_country_iso2s')>0
      THEN EXCLUDED.payload->'subject_country_iso2s'
    ELSE COALESCE(item.payload->'subject_country_iso2s','[]'::jsonb)
  END,
  'gkg',COALESCE(
    NULLIF(EXCLUDED.payload->'gkg','null'::jsonb),
    NULLIF(item.payload->'gkg','null'::jsonb),
    'null'::jsonb
  )
)`;

// GAL is a degraded/supplemental discovery path. When it collides with a DOC
// row, retain the richer DOC payload while still merging canonical-alias time
// and geography history. This keeps event_time and its provenance internally
// consistent without letting the fallback replace DOC-specific metadata.
const MERGED_GDELT_DOC_ALIAS_HISTORY_PAYLOAD_SQL = `(item.payload-'canonical_alias_of_item_id'-'canonical_alias_synchronized_at')
  || jsonb_build_object(
  'canonical_url',EXCLUDED.payload->>'canonical_url',
  'canonical_url_algorithm',EXCLUDED.payload->>'canonical_url_algorithm',
  'gal_fallback_seen_at',EXCLUDED.payload->>'provider_seen_at',
  'gal_fallback_relevance_score',EXCLUDED.payload->'relevance_filter_score',
  'first_provider_seen_at',COALESCE(
    LEAST(
      NULLIF(COALESCE(item.payload->>'first_provider_seen_at',item.payload->>'provider_seen_at'),''),
      NULLIF(EXCLUDED.payload->>'first_provider_seen_at','')
    ),
    NULLIF(COALESCE(item.payload->>'first_provider_seen_at',item.payload->>'provider_seen_at'),''),
    NULLIF(EXCLUDED.payload->>'first_provider_seen_at','')
  ),
  'time_basis',CASE
    WHEN ${EXISTING_GDELT_TIME_VERIFIED_SQL} OR ${INCOMING_GDELT_TIME_VERIFIED_SQL}
      THEN 'publisher_published_verified'
    ELSE 'provider_first_seen'
  END,
  'publication_time_verified',${EXISTING_GDELT_TIME_VERIFIED_SQL} OR ${INCOMING_GDELT_TIME_VERIFIED_SQL},
  'provider_discovery_fallback',NOT (${EXISTING_GDELT_TIME_VERIFIED_SQL} OR ${INCOMING_GDELT_TIME_VERIFIED_SQL}),
  'publisher_published_at',COALESCE(
    LEAST(
      NULLIF(item.payload->>'publisher_published_at',''),
      NULLIF(EXCLUDED.payload->>'publisher_published_at','')
    ),
    NULLIF(item.payload->>'publisher_published_at',''),
    NULLIF(EXCLUDED.payload->>'publisher_published_at','')
  ),
  'publication_time_source',CASE
    WHEN NULLIF(item.payload->>'publisher_published_at','') IS NOT NULL
     AND (
       NULLIF(EXCLUDED.payload->>'publisher_published_at','') IS NULL
       OR item.payload->>'publisher_published_at'<=EXCLUDED.payload->>'publisher_published_at'
     ) THEN item.payload->>'publication_time_source'
    ELSE EXCLUDED.payload->>'publication_time_source'
  END,
  'time_precision',CASE
    WHEN NULLIF(item.payload->>'publisher_published_at','') IS NOT NULL
     AND (
       NULLIF(EXCLUDED.payload->>'publisher_published_at','') IS NULL
       OR item.payload->>'publisher_published_at'<=EXCLUDED.payload->>'publisher_published_at'
     ) THEN item.payload->>'time_precision'
    ELSE EXCLUDED.payload->>'time_precision'
  END,
  'country_attribution',CASE
    WHEN item.country_iso2 IS NOT NULL THEN item.payload->>'country_attribution'
    ELSE EXCLUDED.payload->>'country_attribution'
  END,
  'country_inference',CASE
    WHEN item.country_iso2 IS NOT NULL THEN item.payload->'country_inference'
    ELSE EXCLUDED.payload->'country_inference'
  END,
  'subject_country_iso2s',CASE
    WHEN jsonb_typeof(EXCLUDED.payload->'subject_country_iso2s')='array'
     AND jsonb_array_length(EXCLUDED.payload->'subject_country_iso2s')>0
      THEN EXCLUDED.payload->'subject_country_iso2s'
    ELSE COALESCE(item.payload->'subject_country_iso2s','[]'::jsonb)
  END,
  'gkg',COALESCE(
    NULLIF(item.payload->'gkg','null'::jsonb),
    NULLIF(EXCLUDED.payload->'gkg','null'::jsonb),
    'null'::jsonb
  )
)`;

export function canonicalGdeltUrl(value: string | null | undefined): string | null {
  return usableGdeltArticleUrl(value)?.toString() ?? null;
}

function gdeltArticleDedupeHash(url: string): string {
  return crypto.createHash("sha256").update(`${url}|gdelt-article`).digest("hex");
}

type GdeltCanonicalReconciliationResult = {
  itemRows: number;
  signalRows: number;
  batches: number;
  itemComplete: boolean;
  signalComplete: boolean;
};

const gdeltCanonicalReconciliations = new Map<number, Promise<GdeltCanonicalReconciliationResult>>();

type GdeltCanonicalCursor = {
  item_after_id?: unknown;
  signal_after_id?: unknown;
};

type GdeltCanonicalReconciliationStep = GdeltCanonicalReconciliationResult;

function canonicalCursorId(value: unknown): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return "0";
}

async function reconcileGdeltCanonicalBatch(
  sourceId: number,
  repairSignals: boolean,
): Promise<GdeltCanonicalReconciliationStep> {
  return withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`gdelt-canonical-history:${sourceId}:${GDELT_CANONICAL_URL_ALGORITHM}`],
    );

    const feedKey = `canonical-url-reconciliation:${GDELT_CANONICAL_URL_ALGORITHM}`;
    await client.query(
      `INSERT INTO source_feed(source_id,feed_key,params,cursor)
       VALUES ($1,$2,$3::jsonb,$4::jsonb)
       ON CONFLICT (source_id,feed_key) DO NOTHING`,
      [
        sourceId,
        feedKey,
        JSON.stringify({ purpose: "gdelt_canonical_url_reconciliation", algorithm: GDELT_CANONICAL_URL_ALGORITHM }),
        JSON.stringify({
          algorithm: GDELT_CANONICAL_URL_ALGORITHM,
          item_after_id: "0",
          signal_after_id: "0",
          item_complete: false,
          signal_complete: false,
        }),
      ],
    );
    const state = await client.query<{ cursor: GdeltCanonicalCursor | null }>(
      `SELECT cursor FROM source_feed WHERE source_id=$1 AND feed_key=$2 FOR UPDATE`,
      [sourceId, feedKey],
    );
    const cursor = state.rows[0]?.cursor ?? {};
    let itemAfterId = canonicalCursorId(cursor.item_after_id);
    let signalAfterId = canonicalCursorId(cursor.signal_after_id);

    const selectItems = (afterId: string) => client.query<GdeltCanonicalItemRow>(
      `SELECT id::text,url,external_id
       FROM item
       WHERE source_id=$1
         AND kind='news_article'
         AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
         AND id>$3::bigint
       ORDER BY id
       LIMIT $4`,
      [sourceId, GDELT_CANONICAL_URL_ALGORITHM, afterId, GDELT_CANONICAL_RECONCILIATION_BATCH_SIZE],
    );
    let legacyItems = await selectItems(itemAfterId);
    if (legacyItems.rows.length === 0 && itemAfterId !== "0") {
      itemAfterId = "0";
      legacyItems = await selectItems(itemAfterId);
    }

    const selectSignals = (afterId: string) => client.query<GdeltCanonicalSignalRow>(
      `SELECT id::text,url,NULLIF(payload->>'raw_url','') AS raw_url
       FROM news_signal
       WHERE source_id=$1
         AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
         AND id>$3::bigint
       ORDER BY id
       LIMIT $4`,
      [sourceId, GDELT_CANONICAL_URL_ALGORITHM, afterId, GDELT_CANONICAL_RECONCILIATION_BATCH_SIZE],
    );
    let legacySignals: { rows: GdeltCanonicalSignalRow[] } = { rows: [] };
    if (repairSignals) legacySignals = await selectSignals(signalAfterId);
    if (repairSignals && legacySignals.rows.length === 0 && signalAfterId !== "0") {
      signalAfterId = "0";
      legacySignals = await selectSignals(signalAfterId);
    }

    // V52 makes these settings trigger-aware. Derived key repair must not
    // pretend historical reporting is fresh or enqueue a news update event.
    await client.query(
      `SELECT set_config('claritas.preserve_updated_at','on',true),
              set_config('claritas.suppress_item_outbox','on',true)`,
    );
    if (legacyItems.rows.length > 0) {
      const repairs = legacyItems.rows.map((row) => ({
        id: row.id,
        canonical_url: canonicalGdeltUrl(row.url) ?? canonicalGdeltUrl(row.external_id),
      }));
      await client.query(
        `UPDATE item AS news
         SET payload = jsonb_set(
           CASE
             WHEN repair.canonical_url IS NULL THEN news.payload - 'canonical_url'
             ELSE jsonb_set(news.payload,'{canonical_url}',to_jsonb(repair.canonical_url),true)
           END,
           '{canonical_url_algorithm}',to_jsonb($2::text),true
         )
         FROM jsonb_to_recordset($1::jsonb)
           AS repair(id bigint,canonical_url text)
         WHERE news.id=repair.id
           AND news.source_id=$3
           AND news.kind='news_article'
           AND news.payload->>'canonical_url_algorithm' IS DISTINCT FROM $2`,
        [JSON.stringify(repairs), GDELT_CANONICAL_URL_ALGORITHM, sourceId],
      );
      itemAfterId = legacyItems.rows.at(-1)?.id ?? itemAfterId;
    }
    if (legacySignals.rows.length > 0) {
      const repairs = legacySignals.rows.map((row) => {
        const rawUrl = row.raw_url ?? row.url;
        return { id: row.id, raw_url: rawUrl, canonical_url: canonicalGdeltUrl(rawUrl) };
      });
      await client.query(
        `UPDATE news_signal AS signal
         SET url=repair.canonical_url,
             payload=jsonb_set(
               jsonb_set(
                 signal.payload,
                 '{raw_url}',COALESCE(to_jsonb(repair.raw_url),'null'::jsonb),true
               ),
               '{canonical_url}',COALESCE(to_jsonb(repair.canonical_url),'null'::jsonb),true
             ) || jsonb_build_object('canonical_url_algorithm',$2::text)
         FROM jsonb_to_recordset($1::jsonb)
           AS repair(id bigint,raw_url text,canonical_url text)
         WHERE signal.id=repair.id
           AND signal.source_id=$3
           AND signal.payload->>'canonical_url_algorithm' IS DISTINCT FROM $2`,
        [JSON.stringify(repairs), GDELT_CANONICAL_URL_ALGORITHM, sourceId],
      );
      signalAfterId = legacySignals.rows.at(-1)?.id ?? signalAfterId;
    }

    const remaining = await client.query<{ items: boolean; signals: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM item
           WHERE source_id=$1 AND kind='news_article'
             AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
         ) AS items,
         EXISTS (
           SELECT 1 FROM news_signal
           WHERE source_id=$1
             AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
         ) AS signals`,
      [sourceId, GDELT_CANONICAL_URL_ALGORITHM],
    );
    const itemComplete = !remaining.rows[0]?.items;
    const signalComplete = !remaining.rows[0]?.signals;
    await client.query(
      `UPDATE source_feed
       SET cursor=$3::jsonb,updated_at=now()
       WHERE source_id=$1 AND feed_key=$2`,
      [
        sourceId,
        feedKey,
        JSON.stringify({
          algorithm: GDELT_CANONICAL_URL_ALGORITHM,
          item_after_id: itemComplete ? "0" : itemAfterId,
          signal_after_id: signalComplete ? "0" : signalAfterId,
          item_complete: itemComplete,
          signal_complete: signalComplete,
          checked_at: new Date().toISOString(),
        }),
      ],
    );
    return {
      itemRows: legacyItems.rows.length,
      signalRows: legacySignals.rows.length,
      batches: legacyItems.rows.length > 0 || legacySignals.rows.length > 0 ? 1 : 0,
      itemComplete,
      signalComplete,
    };
  });
}

/**
 * Repair every legacy URL with the exact same WHATWG implementation used for
 * current DOC/GAL/GKG records. A durable source-feed cursor and advisory lock
 * make the repair resumable across pods and restarts. Article identity rows
 * are completed before a new story may be admitted. The much larger legacy
 * GKG signal set advances through a small per-call budget and never blocks
 * current GKG rows, which are canonicalized before they are persisted.
 */
export async function reconcileGdeltCanonicalHistory(
  sourceId: number,
): Promise<GdeltCanonicalReconciliationResult> {
  const active = gdeltCanonicalReconciliations.get(sourceId);
  if (active) return active;
  const pending = (async () => {
    let itemRows = 0;
    let signalRows = 0;
    let batches = 0;
    let signalBatchesRemaining = clampInt(
      process.env.GDELT_SIGNAL_CANONICAL_RECONCILIATION_BATCHES,
      1,
      4,
      1,
    );
    // Transactions remain small, but the one-time item pass deliberately
    // reaches completion. A partial item pass cannot safely prove that a
    // newly discovered canonical URL has no tracked historical alias.
    while (true) {
      const repairSignals = signalBatchesRemaining > 0;
      let step: GdeltCanonicalReconciliationStep;
      try {
        step = await reconcileGdeltCanonicalBatch(sourceId, repairSignals);
      } catch (error) {
        if (!repairSignals) throw error;
        signalBatchesRemaining = 0;
        console.warn(JSON.stringify({
          event: "gdelt_signal_canonical_reconciliation_degraded",
          message: error instanceof Error ? error.message : String(error),
        }));
        // Signal history is optional enrichment. Retry this item batch without
        // it so a corrupt/oversized legacy signal cannot block current news.
        step = await reconcileGdeltCanonicalBatch(sourceId, false);
      }
      itemRows += step.itemRows;
      signalRows += step.signalRows;
      batches += step.batches;
      if (repairSignals) signalBatchesRemaining = Math.max(0, signalBatchesRemaining - 1);
      if (step.itemComplete && (step.signalComplete || signalBatchesRemaining === 0)) {
        return {
          itemRows,
          signalRows,
          batches,
          itemComplete: true,
          signalComplete: step.signalComplete,
        };
      }
    }
  })();
  gdeltCanonicalReconciliations.set(sourceId, pending);
  try {
    return await pending;
  } finally {
    if (gdeltCanonicalReconciliations.get(sourceId) === pending) {
      gdeltCanonicalReconciliations.delete(sourceId);
    }
  }
}

async function requireGdeltCanonicalItemHistory(sourceId: number): Promise<void> {
  const reconciliation = await reconcileGdeltCanonicalHistory(sourceId);
  if (!reconciliation.itemComplete) {
    throw new Error(
      `GDELT article canonical URL reconciliation is incomplete (`
        + `${reconciliation.itemRows} items and ${reconciliation.signalRows} signals repaired).`,
    );
  }
}

function existingGdeltPreference(left: ExistingGdeltItem, right: ExistingGdeltItem): number {
  const trust = (item: ExistingGdeltItem) =>
    (item.publication_time_verified ? 4 : 0)
    + (item.time_basis === "provider_first_seen" ? 1 : 0);
  const timestamp = (item: ExistingGdeltItem) => {
    const parsed = Date.parse(item.event_time ?? "");
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  };
  return Number(right.quality_status === "accepted") - Number(left.quality_status === "accepted")
    || trust(right) - trust(left)
    // Equally trusted aliases must retain the earliest known effective time.
    // Choosing the newest alias here can promote an old syndicated story when
    // its tracking parameters change.
    || timestamp(left) - timestamp(right)
    || left.external_id.localeCompare(right.external_id);
}

function earliestGdeltTimestamp(values: Array<string | null | undefined>): string | null {
  let earliest: number | null = null;
  for (const value of values) {
    const parsed = Date.parse(value ?? "");
    if (!Number.isFinite(parsed)) continue;
    if (earliest === null || parsed < earliest) earliest = parsed;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

function existingGdeltCountryIsTrusted(item: ExistingGdeltItem): boolean {
  if (!/^[A-Za-z]{2}$/.test(item.country_iso2?.trim() ?? "")) return false;
  const source = (item.country_attribution ?? item.country_inference_source ?? "").trim().toLowerCase();
  const confidence = (item.country_inference_confidence ?? "").trim().toLowerCase();
  return [
    "gkg_location",
    "article_structured_location",
    "targeted_event_query_fallback",
    "institutional_jurisdiction",
  ].includes(source) || (source === "content_alias" && ["medium", "high"].includes(confidence));
}

function existingGdeltSubjectCountries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((country): country is string => typeof country === "string" && /^[A-Za-z]{2}$/.test(country.trim()))
    .map((country) => country.trim().toUpperCase());
}

/**
 * Pick the row that can be updated without violating the global dedupe index,
 * while independently carrying the strongest/earliest history from every URL
 * alias into that row. The canonical URL remains the public identity even when
 * a legacy external_id must be retained as the conflict key.
 */
export function planGdeltAliasPersistence(
  canonicalUrl: string,
  aliases: ExistingGdeltItem[],
): GdeltAliasPersistencePlan {
  const ranked = [...aliases].sort(existingGdeltPreference);
  const canonicalHash = gdeltArticleDedupeHash(canonicalUrl);
  const persistence = ranked.find((item) => item.dedupe_hash === canonicalHash)
    ?? ranked[0];
  const verified = ranked.filter((item) => item.publication_time_verified === true
    || item.time_basis?.startsWith("publisher_published") === true);
  const verifiedPublishedAt = earliestGdeltTimestamp(verified.flatMap((item) => [
    item.publisher_published_at,
    item.event_time,
  ]));
  const verifiedSource = verified
    .filter((item) => earliestGdeltTimestamp([item.publisher_published_at, item.event_time]) === verifiedPublishedAt)
    .sort(existingGdeltPreference)[0];
  const trustedCountry = ranked
    .filter(existingGdeltCountryIsTrusted)
    .sort((left, right) => Number(right.quality_status === "accepted") - Number(left.quality_status === "accepted")
      || existingGdeltPreference(left, right))[0];
  const subjectCountryIso2s = Array.from(new Set([
    ...ranked.flatMap((item) => existingGdeltSubjectCountries(item.subject_country_iso2s)),
    ...(trustedCountry?.country_iso2 ? [trustedCountry.country_iso2.trim().toUpperCase()] : []),
  ])).sort();
  const historicalGkg = ranked.find((item) => item.gkg && typeof item.gkg === "object")?.gkg ?? null;

  return {
    persistenceItemId: persistence?.id ?? null,
    persistenceExternalId: persistence?.external_id ?? canonicalUrl,
    firstProviderSeenAt: earliestGdeltTimestamp(ranked.flatMap((item) => [
      item.first_provider_seen_at,
      item.time_basis === "provider_first_seen" ? item.event_time : null,
    ])),
    providerFirstSeenEventTime: earliestGdeltTimestamp(
      ranked
        .filter((item) => item.time_basis === "provider_first_seen")
        .map((item) => item.event_time),
    ),
    verifiedPublication: verifiedPublishedAt ? {
      publishedAt: verifiedPublishedAt,
      source: verifiedSource?.publication_time_source ?? "historical_alias",
      precision: verifiedSource?.time_precision ?? null,
    } : null,
    countryIso2: trustedCountry?.country_iso2?.trim().toUpperCase() ?? null,
    countryAttribution: trustedCountry?.country_attribution
      ?? trustedCountry?.country_inference_source
      ?? null,
    countryInference: trustedCountry?.country_inference ?? null,
    subjectCountryIso2s,
    gkg: historicalGkg,
  };
}

export function gdeltAliasQualityContinuation(
  aliases: ExistingGdeltItem[],
  providerSeenAt: string | null,
): { allowProviderFirstSeen: boolean; preserveAcceptedVerified: boolean } {
  const providerSeenMs = Date.parse(providerSeenAt ?? "");
  return {
    allowProviderFirstSeen: aliases.length === 0 || aliases.some((item) => {
      const existingSeenMs = Date.parse(item.first_provider_seen_at ?? "");
      return item.quality_status === "accepted"
        && item.time_basis === "provider_first_seen"
        && Number.isFinite(existingSeenMs)
        && Number.isFinite(providerSeenMs)
        && Math.abs(existingSeenMs - providerSeenMs) <= GDELT_MAX_FUTURE_SKEW_MS;
    }),
    preserveAcceptedVerified: aliases.some((item) => item.quality_status === "accepted"
      && item.publication_time_verified === true),
  };
}

export function mergeGdeltAliasTemporalEvidence(
  aliasHistory: GdeltAliasPersistencePlan,
  incoming: {
    eventTime: string;
    timeBasis: "publisher_published_verified" | "provider_first_seen";
    publication: GdeltPublicationTime | null;
    providerSeenAt: string;
  },
): {
  eventTime: string;
  timeBasis: "publisher_published_verified" | "provider_first_seen";
  publicationTimeVerified: boolean;
  publisherPublishedAt: string | null;
  publicationTimeSource: string | null;
  timePrecision: string;
  firstProviderSeenAt: string;
  incomingPublicationConsistent: boolean;
} {
  const historicalPublication = aliasHistory.verifiedPublication;
  const historicalFirstSeenMs = Date.parse(aliasHistory.firstProviderSeenAt ?? "");
  const incomingPublicationMs = Date.parse(incoming.publication?.publishedAt ?? "");
  // An article cannot have been published after Claritas already observed the
  // same canonical URL. Reused/updated pages commonly rewrite metadata; treat
  // that newer claim as conflicting provenance, not as fresh publication.
  const incomingPublicationConsistent = !Number.isFinite(historicalFirstSeenMs)
    || !Number.isFinite(incomingPublicationMs)
    || incomingPublicationMs <= historicalFirstSeenMs + GDELT_MAX_FUTURE_SKEW_MS;
  const admissibleIncomingPublication = incomingPublicationConsistent ? incoming.publication : null;
  const currentVerifiedTime = incoming.timeBasis === "publisher_published_verified"
      && incomingPublicationConsistent
    ? incoming.eventTime
    : null;
  const publisherPublishedAt = earliestGdeltTimestamp([
    admissibleIncomingPublication?.publishedAt,
    historicalPublication?.publishedAt,
  ]);
  const publicationTimeVerified = publisherPublishedAt !== null;
  const eventTime = publicationTimeVerified
    ? earliestGdeltTimestamp([currentVerifiedTime, historicalPublication?.publishedAt]) ?? incoming.eventTime
    : earliestGdeltTimestamp([
        aliasHistory.providerFirstSeenEventTime,
        aliasHistory.firstProviderSeenAt,
        incoming.providerSeenAt,
      ]) ?? incoming.providerSeenAt;
  const useHistoricalPublication = Boolean(historicalPublication) && (
    !admissibleIncomingPublication
    || Date.parse(historicalPublication?.publishedAt ?? "") <= Date.parse(admissibleIncomingPublication.publishedAt)
  );

  return {
    eventTime,
    timeBasis: publicationTimeVerified ? "publisher_published_verified" : "provider_first_seen",
    publicationTimeVerified,
    publisherPublishedAt,
    publicationTimeSource: useHistoricalPublication
      ? historicalPublication?.source ?? "historical_alias"
      : admissibleIncomingPublication?.source ?? null,
    timePrecision: (useHistoricalPublication
      ? historicalPublication?.precision
      : admissibleIncomingPublication?.precision) ?? "15_minute",
    firstProviderSeenAt: earliestGdeltTimestamp([
      aliasHistory.firstProviderSeenAt,
      incoming.providerSeenAt,
    ]) ?? incoming.providerSeenAt,
    incomingPublicationConsistent,
  };
}

/**
 * Reconcile current canonical URLs with rows written before tracking
 * parameters were normalised. The application backfill above uses this exact
 * WHATWG canonicalizer for the full historical GDELT corpus, so an old UTM
 * variant cannot evade quarantine or re-enter as a newly discovered story.
 */
async function loadExistingGdeltItems(
  sourceId: number,
  canonicalUrls: string[],
  rawAliases: string[] = [],
): Promise<Map<string, ExistingGdeltItem[]>> {
  if (canonicalUrls.length === 0) return new Map();
  await requireGdeltCanonicalItemHistory(sourceId);
  const aliases = Array.from(new Set([...canonicalUrls, ...rawAliases].filter(Boolean)));
  const existing = await query<ExistingGdeltItem>(
    `SELECT id::text,external_id,url,dedupe_hash,
            COALESCE(payload->>'first_provider_seen_at',payload->>'provider_seen_at') AS first_provider_seen_at,
            payload->>'quality_status' AS quality_status,
            payload->>'time_basis' AS time_basis,
            COALESCE(
              payload->>'publication_time_verified' = 'true',
              payload->>'time_basis' LIKE 'publisher_published%'
            ) AS publication_time_verified,
            payload->>'publisher_published_at' AS publisher_published_at,
            payload->>'publication_time_source' AS publication_time_source,
            payload->>'time_precision' AS time_precision,
            event_time::text,country_iso2::text,
            payload->>'country_attribution' AS country_attribution,
            payload#>>'{country_inference,source}' AS country_inference_source,
            payload#>>'{country_inference,confidence}' AS country_inference_confidence,
            payload->'country_inference' AS country_inference,
            payload->'subject_country_iso2s' AS subject_country_iso2s,
            payload->'gkg' AS gkg
     FROM item
     WHERE source_id=$1 AND kind='news_article'
       AND (
         external_id=ANY($2::text[])
         OR url=ANY($2::text[])
         OR payload->>'canonical_url'=ANY($3::text[])
       )`,
    [sourceId, aliases, canonicalUrls],
  );
  const grouped = new Map<string, ExistingGdeltItem[]>();
  for (const item of existing.rows) {
    const key = canonicalGdeltUrl(item.url) ?? canonicalGdeltUrl(item.external_id);
    if (!key || !canonicalUrls.includes(key)) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  }
  for (const rows of grouped.values()) rows.sort(existingGdeltPreference);
  return grouped;
}

/**
 * Keep pre-normalisation item identities readable instead of rejecting them.
 * Item-id keyed assessments, translations, briefings and event evidence may
 * still point at those rows, and queued correlation work may do so after this
 * ingest returns. Synchronising their canonical story fields makes every
 * alias converge under reader deduplication without a lossy cross-table move.
 */
async function synchronizeAcceptedGdeltAliases(
  survivorItemId: string | null,
  aliases: ExistingGdeltItem[],
): Promise<number> {
  if (!survivorItemId || !/^\d+$/.test(survivorItemId)) return 0;
  const aliasIds = Array.from(new Set(
    aliases
      .map((item) => item.id)
      .filter((id) => /^\d+$/.test(id) && id !== survivorItemId),
  ));
  if (aliasIds.length === 0) return 0;
  const synchronized = await withTransaction(async (client) => {
    // Aliases stay addressable for historical item-id dependents, but only
    // the survivor may emit fresh intelligence work.
    await client.query(`SELECT set_config('claritas.suppress_item_outbox','on',true)`);
    return client.query<{ id: string }>(
      `UPDATE item AS alias
     SET title=survivor.title,
         summary=COALESCE(survivor.summary,alias.summary),
         url=survivor.url,
         country_iso2=survivor.country_iso2,
         event_time=survivor.event_time,
         payload=(alias.payload-'quality_rejection_reason') || jsonb_build_object(
           'quality_status','accepted',
           'canonical_url',survivor.payload->>'canonical_url',
           'canonical_url_algorithm',survivor.payload->>'canonical_url_algorithm',
           'canonical_alias_of_item_id',survivor.id,
           'canonical_alias_synchronized_at',now(),
           'time_basis',survivor.payload->>'time_basis',
           'time_precision',survivor.payload->>'time_precision',
           'publication_time_source',survivor.payload->>'publication_time_source',
           'publication_time_verified',COALESCE(
             survivor.payload->>'publication_time_verified'='true',false
           ),
           'provider_discovery_fallback',COALESCE(
             survivor.payload->>'provider_discovery_fallback'='true',false
           ),
           'quality_checked_at',survivor.payload->>'quality_checked_at',
           'quality_checks',COALESCE(survivor.payload->'quality_checks','{}'::jsonb),
           'publisher_published_at',survivor.payload->>'publisher_published_at',
           'first_provider_seen_at',COALESCE(
             LEAST(
               NULLIF(COALESCE(alias.payload->>'first_provider_seen_at',alias.payload->>'provider_seen_at'),''),
               NULLIF(survivor.payload->>'first_provider_seen_at','')
             ),
             NULLIF(COALESCE(alias.payload->>'first_provider_seen_at',alias.payload->>'provider_seen_at'),''),
             NULLIF(survivor.payload->>'first_provider_seen_at','')
           ),
           'country_attribution',survivor.payload->>'country_attribution',
           'country_inference',survivor.payload->'country_inference',
           'subject_country_iso2s',COALESCE(survivor.payload->'subject_country_iso2s','[]'::jsonb),
           'gkg',COALESCE(survivor.payload->'gkg','null'::jsonb)
         ),
         language_code=COALESCE(survivor.language_code,alias.language_code),
         source_country_iso2=COALESCE(survivor.source_country_iso2,alias.source_country_iso2),
         tone=COALESCE(survivor.tone,alias.tone),
         updated_at=now()
     FROM item AS survivor
     WHERE survivor.id=$1::bigint
       AND alias.id=ANY($2::bigint[])
       AND alias.source_id=survivor.source_id
       AND alias.kind='news_article'
       AND (
         alias.title IS DISTINCT FROM survivor.title
         OR alias.summary IS DISTINCT FROM COALESCE(survivor.summary,alias.summary)
         OR alias.url IS DISTINCT FROM survivor.url
         OR alias.country_iso2 IS DISTINCT FROM survivor.country_iso2
         OR alias.event_time IS DISTINCT FROM survivor.event_time
         OR alias.payload->>'quality_status' IS DISTINCT FROM 'accepted'
         OR alias.payload->>'canonical_url' IS DISTINCT FROM survivor.payload->>'canonical_url'
         OR alias.payload->>'canonical_url_algorithm' IS DISTINCT FROM survivor.payload->>'canonical_url_algorithm'
         OR alias.payload->>'canonical_alias_of_item_id' IS DISTINCT FROM survivor.id::text
         OR alias.payload ? 'quality_rejection_reason'
         OR alias.payload->>'time_basis' IS DISTINCT FROM survivor.payload->>'time_basis'
         OR alias.payload->>'time_precision' IS DISTINCT FROM survivor.payload->>'time_precision'
         OR alias.payload->>'publication_time_source' IS DISTINCT FROM survivor.payload->>'publication_time_source'
         OR alias.payload->'publication_time_verified' IS DISTINCT FROM to_jsonb(COALESCE(
              survivor.payload->>'publication_time_verified'='true',false
            ))
         OR alias.payload->'provider_discovery_fallback' IS DISTINCT FROM to_jsonb(COALESCE(
              survivor.payload->>'provider_discovery_fallback'='true',false
            ))
         OR alias.payload->>'quality_checked_at' IS DISTINCT FROM survivor.payload->>'quality_checked_at'
         OR alias.payload->'quality_checks' IS DISTINCT FROM COALESCE(
              survivor.payload->'quality_checks','{}'::jsonb
            )
         OR alias.payload->>'publisher_published_at' IS DISTINCT FROM survivor.payload->>'publisher_published_at'
         OR COALESCE(alias.payload->>'first_provider_seen_at',alias.payload->>'provider_seen_at')
              IS DISTINCT FROM COALESCE(
                LEAST(
                  NULLIF(COALESCE(alias.payload->>'first_provider_seen_at',alias.payload->>'provider_seen_at'),''),
                  NULLIF(survivor.payload->>'first_provider_seen_at','')
                ),
                NULLIF(COALESCE(alias.payload->>'first_provider_seen_at',alias.payload->>'provider_seen_at'),''),
                NULLIF(survivor.payload->>'first_provider_seen_at','')
              )
         OR alias.payload->>'country_attribution' IS DISTINCT FROM survivor.payload->>'country_attribution'
         OR alias.payload->'country_inference' IS DISTINCT FROM COALESCE(
              survivor.payload->'country_inference','null'::jsonb
            )
         OR alias.payload->'subject_country_iso2s' IS DISTINCT FROM COALESCE(
              survivor.payload->'subject_country_iso2s','[]'::jsonb
            )
         OR alias.payload->'gkg' IS DISTINCT FROM COALESCE(
              survivor.payload->'gkg','null'::jsonb
            )
         OR alias.language_code IS DISTINCT FROM COALESCE(survivor.language_code,alias.language_code)
         OR alias.source_country_iso2 IS DISTINCT FROM COALESCE(survivor.source_country_iso2,alias.source_country_iso2)
         OR alias.tone IS DISTINCT FROM COALESCE(survivor.tone,alias.tone)
       )
     RETURNING alias.id::text`,
      [survivorItemId, aliasIds],
    );
  });
  return synchronized.rows.length;
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

export function resolveGdeltArticleSubject(input: {
  title?: string | null;
  url?: string | null;
  context: GdeltPublisherContext;
  gkgCountry?: string | null;
  sourceCountry?: string | null;
  eligibleTargetCountry?: string | null;
}): {
  inference: ReturnType<typeof inferNewsCountry>;
  countryIso2: string | null;
  countryAttribution: string;
  subjectCountryIso2s: string[];
} {
  const structuredCountries = Array.from(new Set(
    input.context.structuredCountryIso2s
      .map((value) => value.trim().toUpperCase())
      .filter((value) => worldCountries.some((country) => country.cca2 === value)),
  )).sort();
  const gkgCountry = countryNameToIso2(input.gkgCountry);
  const sourceCountry = countryNameToIso2(input.sourceCountry);
  const eligibleTargetCountry = countryNameToIso2(input.eligibleTargetCountry);
  const inference = inferNewsCountry({
    title: input.title,
    summary: input.context.description,
    keywords: input.context.keywords,
    url: input.url,
    feedCountryHint: gkgCountry ?? sourceCountry,
  });
  const contentCountry = trustedSubjectCountryIso2(inference);
  const soleStructuredCountry = structuredCountries.length === 1 ? structuredCountries[0] : null;
  const countryIso2 = soleStructuredCountry ?? contentCountry ?? gkgCountry ?? eligibleTargetCountry ?? null;
  const countryAttribution = soleStructuredCountry
    ? "article_structured_location"
    : contentCountry
      ? inference.source
      : gkgCountry
        ? "gkg_location"
        : eligibleTargetCountry
          ? "targeted_event_query_fallback"
          : inference.source === "feed_hint" && sourceCountry
            ? "publisher_country_fallback"
            : inference.source;
  return {
    inference,
    countryIso2,
    countryAttribution,
    subjectCountryIso2s: Array.from(new Set([
      ...structuredCountries,
      ...(countryIso2 ? [countryIso2] : []),
    ])).sort(),
  };
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
const GDELT_LANE_HEADLINE_PATTERNS: Record<GdeltDiscoveryLaneId, RegExp> = {
  markets_macro: /\b(?:markets?|stocks?|shares?|equities|bonds?|treasur(?:y|ies)|yields?|forex|currenc(?:y|ies)|futures?|commodit(?:y|ies)|inflation|central banks?|interest rates?|wall street|s&p\s*500|dow(?: jones)?|nasdaq|ftse|dax|nikkei|hang seng|rally|rallied|selloff|traders?|investors?)\b/i,
  companies_technology: /\b(?:earnings|revenue|profits?|losses|mergers?|acquisitions?|takeovers?|bankrupt(?:cy)?|\bipo\b|companies|corporate|semiconductors?|cybersecurity|artificial intelligence|technology|software|cloud computing)\b/i,
  geopolitics_policy: /\b(?:geopolitic|sanctions?|conflicts?|war|military|elections?|tariffs?|regulat(?:ion|or|ory)|antitrust|government|minister|president|parliament|policy|court)\w*\b/i,
  energy_transport: /\b(?:energy|oil|gas|opec|shipping|vessels?|ports?|aviation|airlines?|airports?|transport|logistics|supply chains?|agriculture|food|freight|canals?|straits?)\b/i,
  major_hazards_health: /\b(?:disasters?|earthquakes?|aftershocks?|tsunamis?|volcan(?:o|oes|ic)|landslides?|wildfires?|floods?|hurricanes?|typhoons?|cyclones?|outbreaks?|epidemics?|pandemics?|public health|diseases?|vaccines?)\b/i,
};

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

export function gdeltDiscoveryLaneForTitle(title: string): GdeltDiscoveryLaneId {
  for (const lane of GDELT_DISCOVERY_LANES) {
    if (GDELT_LANE_HEADLINE_PATTERNS[lane.id].test(title)) return lane.id;
  }
  // Every admitted GAL item matched at least one governed relevance pattern.
  // The policy/geopolitics lane is the least misleading fallback for broad
  // institutional/security headlines that do not match a narrower topic.
  return "geopolitics_policy";
}

function gdeltHeadlineMatchesLane(title: string, laneId: string): boolean {
  if (!(laneId in GDELT_LANE_HEADLINE_PATTERNS)) return true;
  return GDELT_LANE_HEADLINE_PATTERNS[laneId as GdeltDiscoveryLaneId].test(title);
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
  const selectedUrls = new Set<string>();
  const take = (article: GdeltGalArticle, enforceDomainLimit: boolean): boolean => {
    if (selectedUrls.has(article.url) || selected.length >= limit) return false;
    const domainCount = domainCounts.get(article.domain) ?? 0;
    if (enforceDomainLimit && domainCount >= domainLimit) return false;
    selected.push(article);
    selectedUrls.add(article.url);
    domainCounts.set(article.domain, domainCount + 1);
    return true;
  };
  const takeFrom = (candidates: GdeltGalArticle[], maximum: number, enforceDomainLimit: boolean) => {
    if (maximum <= 0 || selected.length >= limit) return;
    let taken = 0;
    for (const article of candidates) {
      if (take(article, enforceDomainLimit)) taken += 1;
      if (taken >= maximum || selected.length >= limit) break;
    }
  };

  const byLane = new Map<GdeltDiscoveryLaneId, GdeltGalArticle[]>();
  for (const lane of GDELT_DISCOVERY_LANES) byLane.set(lane.id, []);
  for (const article of ranked) byLane.get(article.discoveryLane)?.push(article);

  // Chronology is a hard product invariant. Preserve the globally newest
  // current headline before applying topic quotas within the remaining slots.
  const newest = [...ranked].sort((left, right) =>
    right.eventTime.localeCompare(left.eventTime) || left.url.localeCompare(right.url)
  )[0];
  if (newest) take(newest, true);

  // A material disaster remains visible, but cannot monopolise a global feed.
  // Market/macro receives the largest guaranteed share; the remaining lanes
  // are sampled round-robin before any same-topic overflow is admitted.
  const hazardBudget = Math.max(1, Math.ceil(limit / 5));
  const selectedInLane = (laneId: GdeltDiscoveryLaneId) => selected.filter((article) => article.discoveryLane === laneId).length;
  takeFrom(
    byLane.get("major_hazards_health") ?? [],
    Math.max(0, hazardBudget - selectedInLane("major_hazards_health")),
    true,
  );
  const marketsBudget = Math.max(1, Math.ceil(limit * 0.4));
  takeFrom(
    byLane.get("markets_macro") ?? [],
    Math.max(0, marketsBudget - selectedInLane("markets_macro")),
    true,
  );
  const diversityLanes: GdeltDiscoveryLaneId[] = [
    "companies_technology", "geopolitics_policy", "energy_transport",
  ];
  const laneOffsets = new Map<GdeltDiscoveryLaneId, number>();
  let madeProgress = true;
  while (selected.length < limit && madeProgress) {
    madeProgress = false;
    for (const laneId of diversityLanes) {
      const candidates = byLane.get(laneId) ?? [];
      let laneOffset = laneOffsets.get(laneId) ?? 0;
      while (laneOffset < candidates.length && selectedUrls.has(candidates[laneOffset].url)) laneOffset += 1;
      const candidate = candidates[laneOffset];
      laneOffsets.set(laneId, laneOffset + 1);
      if (candidate && take(candidate, true)) madeProgress = true;
    }
  }

  takeFrom(ranked.filter((article) => article.discoveryLane !== "major_hazards_health"), limit, true);
  takeFrom(ranked, limit, true);
  // Sparse feeds may relax publisher diversity, never topic balance, before
  // finally admitting hazard overflow as the only alternative to an empty slot.
  takeFrom(ranked.filter((article) => article.discoveryLane !== "major_hazards_health"), limit, false);
  takeFrom(ranked, limit, false);
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
      deduplicated.set(key, { ...article, raw_url: article.raw_url ?? article.url, url: key });
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
  const url = usableGdeltArticleUrl(value);
  if (!url || GAL_NON_ARTICLE_PATH.test(url.pathname)) return null;
  if (url.pathname === "/" || url.pathname.length < 5) return null;
  return { url: url.toString(), domain: url.hostname.replace(/^www\./, "") };
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
      discoveryLane: gdeltDiscoveryLaneForTitle(title),
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

export function gdeltGkgWindowUrls(latestUrl: string, timespan: string | undefined): string[] {
  const match = /(\d{14})(?=\.gkg\.csv\.zip$)/.exec(latestUrl);
  if (!match) return [latestUrl];
  const stamp = match[1];
  const latest = new Date(Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14)),
  ));
  if (Number.isNaN(latest.getTime())) return [latestUrl];
  const archiveCount = Math.min(8, Math.max(1, Math.ceil(parseGdeltTimespanHours(timespan) * 4)));
  return Array.from({ length: archiveCount }, (_, offset) => {
    const candidate = new Date(latest.getTime() - offset * 15 * 60_000)
      .toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return latestUrl.replace(stamp, candidate);
  });
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

type ParsedGkgLine = {
  fields: string[];
  url: string | null;
  rawUrl: string | null;
};

type GdeltGkgArchiveWindow = {
  urls: string[];
  resolutionError?: string;
};

type GdeltGkgArchiveIngest = {
  sampled: number;
  matched: number;
  countryRows: number;
  matchedCountryRows: number;
  matchedCountryUrls: string[];
  canonicalCountryUrls: string[];
  archivesScanned: number;
  archiveErrors: string[];
};

function* linesInText(text: string): Generator<string> {
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    if (line) yield line;
    if (newline === -1) return;
    start = newline + 1;
  }
}

function parseGkgLine(line: string): ParsedGkgLine | null {
  if (!line) return null;
  const fields = line.split("\t");
  if (fields.length < 27) return null;
  const rawUrl = fields[4] || null;
  return { fields, url: canonicalGdeltUrl(rawUrl), rawUrl };
}

export function selectGdeltGkgRowsForUrls(text: string, urls: string[]): string[] {
  const targets = new Set(urls.map(canonicalGdeltUrl).filter((value): value is string => Boolean(value)));
  if (targets.size === 0) return [];
  const matched = new Map<string, string>();
  for (const line of linesInText(text)) {
    const parsed = parseGkgLine(line);
    if (!parsed?.url || !targets.has(parsed.url) || matched.has(parsed.url)) continue;
    matched.set(parsed.url, line);
    if (matched.size === targets.size) break;
  }
  return Array.from(matched.values());
}

export function countAcceptedGdeltGkgCountryMatches(
  acceptedArticleUrls: string[],
  matchedCountryUrls: string[],
): number {
  const accepted = new Set(
    acceptedArticleUrls.map(canonicalGdeltUrl).filter((value): value is string => Boolean(value)),
  );
  const matched = new Set(
    matchedCountryUrls.map(canonicalGdeltUrl).filter((value): value is string => Boolean(value)),
  );
  return Array.from(matched).filter((url) => accepted.has(url)).length;
}

function gkgLocationsHaveRecognizedCountry(locations: Array<Record<string, unknown>>): boolean {
  return locations.some((location) => (
    typeof location.country_iso2 === "string"
    && worldCountries.some((country) => country.cca2 === location.country_iso2)
  ));
}

export function selectGdeltGkgCountryProbeLine(text: string): string | null {
  for (const line of linesInText(text)) {
    const parsed = parseGkgLine(line);
    if (!parsed?.url) continue;
    if (gkgLocationsHaveRecognizedCountry(parseLocations(parsed.fields[10] || parsed.fields[9]))) {
      return line;
    }
  }
  return null;
}

function* gkgLinesWithCountryProbeFirst(text: string): Generator<string> {
  const probe = selectGdeltGkgCountryProbeLine(text);
  if (probe) yield probe;
  for (const line of linesInText(text)) {
    if (line !== probe) yield line;
  }
}

async function ingestGkgLines(
  sourceId: number,
  lines: Iterable<string>,
  maxRows: number,
): Promise<{ persisted: number; withCountries: number; withCountryUrls: string[] }> {
  let persisted = 0;
  let withCountries = 0;
  const withCountryUrls = new Set<string>();
  for (const line of lines) {
    if (!line || persisted >= maxRows) break;
    const parsed = parseGkgLine(line);
    if (!parsed) continue;
    const { fields, url, rawUrl } = parsed;
    const locations = parseLocations(fields[10] || fields[9]);
    const primaryCountry = locations.map((location) => location.country_iso2).find((value) => typeof value === "string") as string | undefined;
    await ensureCountry(primaryCountry ?? null);
    const toneParts = (fields[15] || "").split(",").map((value) => asNumber(value));
    const domain = fields[3] || hostnameFromUrl(url);
    const themes = parseEnhancedList(fields[8] || fields[7]);
    const persons = parseEnhancedList(fields[12] || fields[11]);
    const organizations = parseEnhancedList(fields[14] || fields[13]);
    const eventTime = parseGdeltTimestamp(fields[1]);
    if (!eventTime) continue;
    const payload = {
      provider: "gdelt", product: "gkg-2.1", attribution: ATTRIBUTION,
      raw_url: rawUrl,
      canonical_url: url,
      canonical_url_algorithm: GDELT_CANONICAL_URL_ALGORITHM,
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
    persisted += 1;
    if (gkgLocationsHaveRecognizedCountry(locations)) {
      withCountries += 1;
      if (url) withCountryUrls.add(url);
    }
  }
  return { persisted, withCountries, withCountryUrls: Array.from(withCountryUrls) };
}

async function downloadGkgArchiveText(archiveUrl: string): Promise<string> {
  const response = await fetchRetry(archiveUrl);
  return firstZipText(new Uint8Array(await response.arrayBuffer()));
}

async function ingestGkgArchiveWindow(
  sourceId: number,
  window: GdeltGkgArchiveWindow,
  matchUrls: string[],
  maxRawRows: number,
): Promise<GdeltGkgArchiveIngest> {
  let sampled = 0;
  let matched = 0;
  let countryRows = 0;
  let matchedCountryRows = 0;
  const matchedCountryUrls = new Set<string>();
  const canonicalCountryUrls = new Set<string>();
  let archivesScanned = 0;
  const archiveErrors = window.resolutionError ? [window.resolutionError] : [];
  const unresolved = new Set(
    matchUrls.map(canonicalGdeltUrl).filter((value): value is string => Boolean(value)),
  );

  // Each GKG archive expands to many times its compressed size. Download,
  // match and release one interval at a time so a one-hour enrichment window
  // never retains four fully decoded archives in the API process.
  for (const [index, archiveUrl] of window.urls.entries()) {
    if (index > 0 && unresolved.size === 0) break;
    try {
      const text = await downloadGkgArchiveText(archiveUrl);
      archivesScanned += 1;
      if (index === 0 && maxRawRows > 0) {
        // Put one country-bearing, canonicalizable row first when the archive
        // has one. The bounded sample then supplies a deterministic parser +
        // persistence probe without depending on random DOC URL coincidence.
        const sample = await ingestGkgLines(sourceId, gkgLinesWithCountryProbeFirst(text), maxRawRows);
        sampled += sample.persisted;
        countryRows += sample.withCountries;
        for (const url of sample.withCountryUrls) canonicalCountryUrls.add(url);
      }
      if (unresolved.size > 0) {
        const matchedLines = selectGdeltGkgRowsForUrls(text, Array.from(unresolved));
        const matchedResult = await ingestGkgLines(
          sourceId,
          matchedLines,
          Math.max(matchedLines.length, 1),
        );
        matched += matchedResult.persisted;
        matchedCountryRows += matchedResult.withCountries;
        for (const url of matchedResult.withCountryUrls) {
          matchedCountryUrls.add(url);
          canonicalCountryUrls.add(url);
        }
        countryRows += matchedResult.withCountries;
        for (const line of matchedLines) {
          const canonical = parseGkgLine(line)?.url;
          if (canonical) unresolved.delete(canonical);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      archiveErrors.push(`${archiveUrl}: ${message}`);
    }
  }

  return {
    sampled,
    matched,
    countryRows,
    matchedCountryRows,
    matchedCountryUrls: Array.from(matchedCountryUrls),
    canonicalCountryUrls: Array.from(canonicalCountryUrls),
    archivesScanned,
    archiveErrors,
  };
}

async function ingestDocArticles(
  sourceId: number,
  params: GdeltIngestParams,
  gkgArchiveWindow?: Promise<GdeltGkgArchiveWindow>,
): Promise<{
  fetched: number;
  selected_candidates: number;
  accepted: number;
  link_eligible: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  quality_quarantined: number;
  canonical_aliases_synchronized: number;
  provider_first_seen_accepted: number;
  gkg_sampled: number;
  gkg_matched: number;
  gkg_country_rows: number;
  gkg_matched_country_rows: number;
  gkg_canonical_country_url_probes: number;
  gkg_archives_scanned: number;
  gkg_archive_errors: string[];
  quality_rejections: Record<string, number>;
  latest_event_time: string | null;
  discovery_lanes: Array<{
    id: string;
    budget: number;
    status: "healthy" | "empty" | "failed";
    fetched: number;
    candidates: number;
    accepted: number;
    error?: string;
  }>;
}> {
  // Do not fetch or admit a new headline until every pre-versioned article
  // identity has passed through this runtime's exact canonicalizer. Legacy
  // GKG enrichment advances separately and cannot block current reporting.
  await requireGdeltCanonicalItemHistory(sourceId);
  const selectionLimit = clampInt(params.maxRecords, 1, 250, 25);
  const configuredQuery = params.query?.trim() || process.env.GDELT_DOC_QUERY?.trim();
  const laneBudgets: GdeltDiscoveryLaneBudget[] = configuredQuery || params.targetedDiscovery
    ? [{ id: params.targetedDiscovery ? "targeted_event" : "configured", query: configuredQuery || DEFAULT_GDELT_DOC_QUERY, budget: selectionLimit }]
    : planGdeltDiscoveryLaneBudgets(selectionLimit);
  const articles: Array<{ article: GdeltDocArticle; laneId: string; laneBudget: number }> = [];
  const selectedUrls = new Set<string>();
  const discoveryLanes: Array<{
    id: string;
    budget: number;
    status: "healthy" | "empty" | "failed";
    fetched: number;
    candidates: number;
    accepted: number;
    error?: string;
  }> = [];
  let rawArticleCount = 0;
  for (const lane of laneBudgets) {
    try {
      const apiUrl = new URL(process.env.GDELT_DOC_API_URL || DOC_API_URL);
      apiUrl.searchParams.set("query", lane.query);
      apiUrl.searchParams.set("mode", "artlist");
      // Preserve each topic's storage lane. Publisher-page verification is
      // supplemented by the explicitly labelled first-discovery path, so a
      // climate burst cannot consume the markets/macroeconomy allocation.
      const verificationLimit = lane.budget;
      const candidateLimit = Math.min(Math.max(verificationLimit * 3, verificationLimit), 250);
      apiUrl.searchParams.set("maxrecords", String(candidateLimit));
      apiUrl.searchParams.set("format", "json");
      apiUrl.searchParams.set("timespan", params.timespan?.trim() || "1h");
      apiUrl.searchParams.set("sort", "datedesc");
      // fetchRetry serializes every DOC request (including retries) through
      // the process-wide 5.5-second limiter. The per-lane catch lets a 429 in
      // one topic degrade coverage without discarding successful lanes.
      const response = await fetchRetry(apiUrl.toString());
      const data = (await response.json()) as GdeltDocResponse;
      const rawArticles = Array.isArray(data.articles) ? data.articles : [];
      rawArticleCount += rawArticles.length;
      const laneInput = !params.targetedDiscovery && lane.id !== "configured"
        ? rawArticles.filter((article) => gdeltHeadlineMatchesLane(article.title ?? "", lane.id))
        : rawArticles;
      const laneCandidates = params.targetedDiscovery
        ? selectTargetedGdeltDocCandidates(laneInput, params.targetedDiscovery, { limit: candidateLimit })
        : selectGdeltDocCandidates(laneInput, { limit: candidateLimit });
      let admitted = 0;
      for (const article of laneCandidates) {
        const url = nonEmpty(article.url);
        if (!url || selectedUrls.has(url)) continue;
        selectedUrls.add(url);
        articles.push({ article, laneId: lane.id, laneBudget: lane.budget });
        admitted += 1;
      }
      discoveryLanes.push({
        id: lane.id,
        budget: lane.budget,
        status: "healthy",
        fetched: rawArticles.length,
        candidates: admitted,
        accepted: 0,
      });
    } catch (error) {
      discoveryLanes.push({
        id: lane.id,
        budget: lane.budget,
        status: "failed",
        fetched: 0,
        candidates: 0,
        accepted: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!discoveryLanes.some((lane) => lane.status === "healthy")) {
    throw new Error(`All GDELT DOC discovery lanes failed: ${discoveryLanes.map((lane) => `${lane.id}: ${lane.error ?? "unknown error"}`).join("; ")}`);
  }
  const urls = articles.map(({ article }) => article.url).filter((value): value is string => Boolean(value));
  // GKG archives are much larger than our bounded general-purpose sample.
  // Scan every 15-minute interval covered by the DOC query for selected URLs,
  // while treating archive lookup/download as optional enrichment. Headlines
  // remain ingestible when the raw archive service is delayed or unavailable.
  const gkg = gkgArchiveWindow
    ? await ingestGkgArchiveWindow(
        sourceId,
        await gkgArchiveWindow,
        urls,
        clampInt(params.maxRawRows ?? process.env.GDELT_MAX_RAW_ROWS, 25, 5000, 750),
      )
    : {
        sampled: 0,
        matched: 0,
        countryRows: 0,
        matchedCountryRows: 0,
        matchedCountryUrls: [],
        canonicalCountryUrls: [],
        archivesScanned: 0,
        archiveErrors: [],
      };
  // Current-window GKG rows were canonicalized before persistence. Advance a
  // further legacy signal batch opportunistically, but gate only on article
  // identity safety before the exact DOC-to-GKG join below.
  await requireGdeltCanonicalItemHistory(sourceId);
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
  const rawAliases = articles
    .map(({ article }) => nonEmpty(article.raw_url))
    .filter((value): value is string => Boolean(value));
  const existingByUrl = await loadExistingGdeltItems(sourceId, urls, rawAliases);
  const verifiedArticles = await mapWithConcurrency(
    articles,
    GDELT_ARTICLE_VERIFICATION_CONCURRENCY,
    async (discovered) => {
      const { article } = discovered;
      const url = nonEmpty(article.url);
      const providerSeenAt = parseGdeltTimestamp(article.seendate);
      const existingAliases = url ? (existingByUrl.get(url) ?? []) : [];
      const existing = existingAliases[0];
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
        return {
          ...discovered,
          url,
          providerSeenAt,
          existing,
          existingAliases,
          context: { description: null, keywords: [], structuredCountryIso2s: [] } as GdeltPublisherContext,
          quality: preflight,
        };
      }
      const evidence = await resolveGdeltPublisherEvidence(url);
      // A provider discovery timestamp is admitted only for a URL that is new
      // to Claritas, or whose stored first discovery is the same current
      // window. Rediscovery can never promote an older URL.
      // Event-specific discovery is allowed to auto-link to a canonical
      // earthquake. That higher-trust path must retain independently verified
      // publisher time; provider discovery is suitable only for the general
      // browse stream.
      const continuation = gdeltAliasQualityContinuation(existingAliases, providerSeenAt);
      const allowProviderFirstSeen = !params.targetedDiscovery && continuation.allowProviderFirstSeen;
      return {
        ...discovered,
        url,
        providerSeenAt,
        existing,
        existingAliases,
        context: evidence.context,
        quality: assessGdeltDocArticleQuality({
          title: article.title,
          url,
          providerSeenAt,
          publication: evidence.publication,
          now: verificationNow,
          maxPublisherAgeHours,
          maxProviderSeenAgeHours,
          allowProviderFirstSeen,
        }),
      };
    },
  );
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = Math.max(0, rawArticleCount - articles.length);
  let quarantined = 0;
  let aliasesSynchronized = 0;
  let providerFirstSeenAccepted = 0;
  const qualityRejections: Record<string, number> = {};
  let latestEventTime: string | null = null;
  let linkEligible = 0;
  const acceptedPersistedUrls = new Set<string>();
  const acceptedByLane = new Map<string, number>();
  for (const candidate of verifiedArticles) {
    const { article, laneId, laneBudget, url, providerSeenAt, quality } = candidate;
    if (!quality.accepted || !url || !providerSeenAt || !quality.effectiveTime || !quality.timeBasis) {
      skipped += 1;
      qualityRejections[quality.reason] = (qualityRejections[quality.reason] ?? 0) + 1;
      const preserveVerified = quality.reason === "publisher_publication_unverified"
        && gdeltAliasQualityContinuation(
          candidate.existingAliases ?? [],
          providerSeenAt,
        ).preserveAcceptedVerified;
      if (preserveVerified) continue;
      const rejectionAliases = Array.from(new Set([
        url,
        ...(candidate.existingAliases ?? []).map((item) => item.external_id),
      ].filter((value): value is string => Boolean(value))));
      for (const alias of rejectionAliases) {
        if (await quarantineGdeltArticle(sourceId, alias, article.title, quality.reason, verificationNow.toISOString(), providerSeenAt)) {
          quarantined += 1;
        }
      }
      continue;
    }
    if ((acceptedByLane.get(laneId) ?? 0) >= laneBudget) {
      skipped += 1;
      continue;
    }
    if (inserted + updated + unchanged >= selectionLimit) {
      skipped += 1;
      continue;
    }
    const aliasHistory = planGdeltAliasPersistence(url, candidate.existingAliases ?? []);
    const temporal = mergeGdeltAliasTemporalEvidence(aliasHistory, {
      eventTime: quality.effectiveTime,
      timeBasis: quality.timeBasis,
      publication: quality.publication,
      providerSeenAt,
    });
    if (params.targetedDiscovery
        && !targetedGdeltPublicationIsTimely(temporal.eventTime, params.targetedDiscovery)) {
      skipped += 1;
      qualityRejections.target_event_time_mismatch = (qualityRejections.target_event_time_mismatch ?? 0) + 1;
      continue;
    }
    // GDELT's seendate is evidence of discovery only. The payload preserves
    // that distinction, and conflicts retain the earliest effective time so a
    // rediscovery can never move an existing URL forward.
    const eventTime = temporal.eventTime;
    if (temporal.timeBasis === "provider_first_seen") providerFirstSeenAccepted += 1;
    const publisherDomain = nonEmpty(article.domain) ?? hostnameFromUrl(url);
    const languageCode = normalizeLanguage(article.language);
    const sourceCountry = countryNameToIso2(article.sourcecountry);
    const signal = signalsByUrl.get(url);
    const locations = Array.isArray(signal?.locations) ? signal.locations as Array<Record<string, unknown>> : [];
    const gkgCountry = locations.map((location) => location.country_iso2).find((value) => typeof value === "string") as string | undefined;
    const targetedMatch = params.targetedDiscovery
      ? describeTargetedGdeltMatch(article, params.targetedDiscovery)
      : null;
    const targetCountry = params.targetedDiscovery?.countryIso2?.trim().toUpperCase() ?? null;
    const eligibleTargetCountry = eligibleTargetedGdeltCountryFallback(targetedMatch, targetCountry);
    if (targetedMatch?.link_eligible) linkEligible += 1;
    // Typed Place/addressCountry metadata inside the NewsArticle subtree is
    // direct publisher-authored subject evidence. Publisher jurisdiction and
    // URL TLD remain provenance-only hints, while GKG and targeted-event
    // geography keep explicit attribution.
    const subject = resolveGdeltArticleSubject({
      title: article.title,
      url,
      context: candidate.context,
      gkgCountry: gkgCountry ?? null,
      sourceCountry,
      eligibleTargetCountry,
    });
    const hasCurrentSubjectCountry = Boolean(subject.countryIso2 || subject.subjectCountryIso2s.length > 0);
    const countryIso2 = subject.countryIso2 ?? aliasHistory.countryIso2;
    const subjectCountryIso2s = Array.from(new Set([
      ...subject.subjectCountryIso2s,
      ...aliasHistory.subjectCountryIso2s,
      ...(countryIso2 ? [countryIso2] : []),
    ])).sort();
    const countryAttribution = hasCurrentSubjectCountry
      ? subject.countryAttribution
      : aliasHistory.countryAttribution;
    const countryInference = hasCurrentSubjectCountry
      ? subject.inference
      : aliasHistory.countryInference ?? subject.inference;
    const gkgPayload = signal ? {
      tone: signal.tone, themes: signal.themes, persons: signal.persons,
      organizations: signal.organizations, locations: signal.locations,
    } : aliasHistory.gkg;
    await ensureCountry(countryIso2);
    await ensureCountry(sourceCountry);
    for (const subjectCountry of subjectCountryIso2s) await ensureCountry(subjectCountry);
    const externalId = aliasHistory.persistenceExternalId;
    const payload = {
      provider: "gdelt", product: "doc-2.0", attribution: ATTRIBUTION,
      canonical_url: url,
      canonical_url_algorithm: GDELT_CANONICAL_URL_ALGORITHM,
      source: publisherDomain, publisher: publisherDomain,
      domain: publisherDomain, source_country: article.sourcecountry || null,
      source_country_iso2: sourceCountry, language: article.language || null,
      language_code: languageCode, image_url: article.socialimage || null,
      mobile_url: article.url_mobile || null,
      country_inference: countryInference,
      subject_country_iso2s: subjectCountryIso2s,
      // `seendate` is GDELT's first-seen value, not an article publication
      // timestamp. We retain it for provenance but only expose a source date
      // that passed the publisher-date and freshness checks above.
      time_basis: temporal.timeBasis,
      time_precision: temporal.timePrecision,
      publication_time_source: temporal.publicationTimeSource,
      provider_seen_at: providerSeenAt,
      first_provider_seen_at: temporal.firstProviderSeenAt,
      last_provider_seen_at: providerSeenAt,
      publisher_published_at: temporal.publisherPublishedAt,
      publication_time_verified: temporal.publicationTimeVerified,
      provider_discovery_fallback: temporal.timeBasis === "provider_first_seen",
      quality_status: "accepted",
      quality_checked_at: verificationNow.toISOString(),
      quality_checks: {
        provider_seen_at_valid: true,
        publisher_date_verified: temporal.publicationTimeVerified,
        publisher_date_fresh: quality.publication && temporal.incomingPublicationConsistent ? true : null,
        publisher_date_not_after_provider_seen: quality.publication ? true : null,
        publisher_date_not_after_historical_first_seen: quality.publication
          ? temporal.incomingPublicationConsistent
          : null,
        article_url_valid: true,
      },
      discovery_lane: laneId,
      country_attribution: countryAttribution,
      ...(candidate.existingAliases?.length ? {
        canonical_alias_history: {
          aliases_seen: candidate.existingAliases.length,
          persistence_external_id: externalId,
          earliest_effective_at: eventTime,
        },
      } : {}),
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
      gkg: gkgPayload,
      license: { data: "GDELT unrestricted use with attribution", article: "Third-party publisher content" },
      raw: article,
    };
    const dedupeHash = gdeltArticleDedupeHash(url);
    const result = await query<{ id: string; inserted: boolean; event_time: string }>(
      `INSERT INTO item (
         source_id, external_id, kind, title, summary, url, country_iso2, event_time,
         payload, dedupe_hash, language_code, source_country_iso2, tone
       ) VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, item.title), summary = COALESCE(EXCLUDED.summary, item.summary),
         url = EXCLUDED.url,
         country_iso2 = ${MERGED_GDELT_COUNTRY_SQL},
         -- Preserve the earliest effective publisher/discovery date. A
         -- subsequent GDELT rediscovery may update provenance, never recency.
         event_time = ${MERGED_GDELT_EVENT_TIME_SQL},
         payload = ${MERGED_GDELT_PAYLOAD_SQL},
         dedupe_hash = EXCLUDED.dedupe_hash,
         language_code = COALESCE(EXCLUDED.language_code, item.language_code),
         source_country_iso2 = COALESCE(EXCLUDED.source_country_iso2, item.source_country_iso2),
         tone = COALESCE(EXCLUDED.tone, item.tone), updated_at = now()
       WHERE item.title IS DISTINCT FROM COALESCE(EXCLUDED.title, item.title)
          OR item.summary IS DISTINCT FROM COALESCE(EXCLUDED.summary, item.summary)
          OR item.url IS DISTINCT FROM EXCLUDED.url
          OR item.country_iso2 IS DISTINCT FROM ${MERGED_GDELT_COUNTRY_SQL}
          OR item.event_time IS DISTINCT FROM ${MERGED_GDELT_EVENT_TIME_SQL}
          OR item.payload IS DISTINCT FROM ${MERGED_GDELT_PAYLOAD_SQL}
          OR item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
          OR item.language_code IS DISTINCT FROM COALESCE(EXCLUDED.language_code, item.language_code)
          OR item.source_country_iso2 IS DISTINCT FROM COALESCE(EXCLUDED.source_country_iso2, item.source_country_iso2)
          OR item.tone IS DISTINCT FROM COALESCE(EXCLUDED.tone, item.tone)
       RETURNING id::text,(xmax = 0) AS inserted,event_time::text`,
      [sourceId, externalId, article.title || null,
       signal ? `GDELT themes: ${(signal.themes as string[]).slice(0, 4).join(", ")}` : null,
       url, countryIso2, eventTime, JSON.stringify(payload), dedupeHash,
       languageCode, sourceCountry, signal?.tone ?? null]
    );
    if (!result.rows[0]) unchanged += 1;
    else if (result.rows[0].inserted) inserted += 1;
    else updated += 1;
    acceptedPersistedUrls.add(url);
    const persistedEventTime = result.rows[0]?.event_time ?? candidate.existing?.event_time ?? eventTime;
    if (!latestEventTime || persistedEventTime > latestEventTime) latestEventTime = persistedEventTime;
    aliasesSynchronized += await synchronizeAcceptedGdeltAliases(
      result.rows[0]?.id ?? aliasHistory.persistenceItemId,
      candidate.existingAliases ?? [],
    );
    acceptedByLane.set(laneId, (acceptedByLane.get(laneId) ?? 0) + 1);
  }
  for (const lane of discoveryLanes) {
    lane.accepted = acceptedByLane.get(lane.id) ?? 0;
    if (lane.status === "healthy" && lane.accepted === 0) lane.status = "empty";
  }
  return {
    fetched: rawArticleCount,
    selected_candidates: articles.length,
    accepted: inserted + updated + unchanged,
    link_eligible: linkEligible,
    inserted,
    updated,
    unchanged,
    skipped,
    quality_quarantined: quarantined,
    canonical_aliases_synchronized: aliasesSynchronized,
    provider_first_seen_accepted: providerFirstSeenAccepted,
    gkg_sampled: gkg.sampled,
    gkg_matched: gkg.matched,
    gkg_country_rows: gkg.countryRows,
    // Release health must be grounded in GKG geography attached to an article
    // that survived publisher-time/quality verification and persistence.
    gkg_matched_country_rows: countAcceptedGdeltGkgCountryMatches(
      Array.from(acceptedPersistedUrls),
      gkg.matchedCountryUrls,
    ),
    // Deterministic release proof: these country-bearing latest-archive rows
    // traversed WHATWG canonicalization and a successful news_signal upsert.
    // Unlike random DOC/GKG coincidence, a healthy current archive should
    // reliably produce this without overstating article-level enrichment.
    gkg_canonical_country_url_probes: gkg.canonicalCountryUrls.length,
    gkg_archives_scanned: gkg.archivesScanned,
    gkg_archive_errors: gkg.archiveErrors,
    quality_rejections: qualityRejections,
    latest_event_time: latestEventTime,
    discovery_lanes: discoveryLanes,
  };
}

export function hasUsableGdeltDocCoverage(result: {
  latest_event_time: string | null;
  accepted?: number;
}, options: { now?: Date; maxAgeHours?: number } = {}): boolean {
  const eventTime = typeof result.latest_event_time === "string"
    ? Date.parse(result.latest_event_time)
    : Number.NaN;
  const now = (options.now ?? new Date()).getTime();
  const maxAgeHours = clampHours(options.maxAgeHours, 4);
  return Number(result.accepted ?? 1) > 0
    && Number.isFinite(eventTime)
    && eventTime <= now + GDELT_MAX_FUTURE_SKEW_MS
    && now - eventTime <= maxAgeHours * 3_600_000;
}

export function hasUsableGdeltFallbackCoverage(result: {
  selected?: unknown;
  latest_event_time?: unknown;
}, options: { now?: Date; maxAgeHours?: number } = {}): boolean {
  const selected = Number(result.selected);
  const eventTime = typeof result.latest_event_time === "string"
    ? Date.parse(result.latest_event_time)
    : Number.NaN;
  const now = (options.now ?? new Date()).getTime();
  const maxAgeHours = clampHours(options.maxAgeHours, 4);
  return Number.isFinite(selected)
    && selected > 0
    && Number.isFinite(eventTime)
    && eventTime <= now + GDELT_MAX_FUTURE_SKEW_MS
    && now - eventTime <= maxAgeHours * 3_600_000;
}

async function ingestGalFallback(
  sourceId: number,
  params: GdeltIngestParams,
  reason: "gdelt_doc_unavailable" | "coverage_diversity_supplement" = "gdelt_doc_unavailable",
): Promise<Record<string, unknown>> {
  const response = await fetchRetry(process.env.GDELT_GAL_RSS_URL?.trim() || GAL_RSS_URL);
  const xml = await response.text();
  const selectedLimit = clampInt(params.maxRecords ?? process.env.GDELT_GAL_MAX_ARTICLES, 1, 250, 25);
  const maxProviderSeenAgeHours = clampHours(process.env.GDELT_GAL_MAX_AGE_HOURS, 3);
  const parsed = parseGdeltGalRss(xml, {
    // Inspect a small bounded superset before source-date verification so a
    // few unverifiable results cannot starve the degraded fallback entirely.
    limit: Math.min(selectedLimit * 4, 250),
    maxAgeHours: maxProviderSeenAgeHours,
  });
  const verificationNow = new Date();
  const maxPublisherAgeHours = gdeltPublisherMaxAgeHours();
  const galUrls = parsed.articles.map((article) => article.url);
  const existingByUrl = await loadExistingGdeltItems(sourceId, galUrls);
  const verifiedArticles = await mapWithConcurrency(
    parsed.articles,
    GDELT_ARTICLE_VERIFICATION_CONCURRENCY,
    async (article) => {
      const existingAliases = existingByUrl.get(article.url) ?? [];
      const existing = existingAliases[0];
      const preflight = assessGdeltDocArticleQuality({
        title: article.title,
        url: article.url,
        providerSeenAt: article.eventTime,
        publication: null,
        now: verificationNow,
        maxPublisherAgeHours,
        maxProviderSeenAgeHours,
      });
      if (preflight.reason !== "publisher_publication_unverified") {
        return {
          article,
          existing,
          existingAliases,
          context: { description: null, keywords: [], structuredCountryIso2s: [] } as GdeltPublisherContext,
          quality: preflight,
        };
      }
      const evidence = await resolveGdeltPublisherEvidence(article.url);
      const allowProviderFirstSeen = gdeltAliasQualityContinuation(
        existingAliases,
        article.eventTime,
      ).allowProviderFirstSeen;
      return {
        article,
        existing,
        existingAliases,
        context: evidence.context,
        quality: assessGdeltDocArticleQuality({
          title: article.title,
          url: article.url,
          providerSeenAt: article.eventTime,
          publication: evidence.publication,
          now: verificationNow,
          maxPublisherAgeHours,
          maxProviderSeenAgeHours,
          allowProviderFirstSeen,
        }),
      };
    },
  );
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = parsed.skipped;
  let quarantined = 0;
  let aliasesSynchronized = 0;
  let providerFirstSeenAccepted = 0;
  const qualityRejections: Record<string, number> = {};
  let latestEventTime: string | null = null;
  let selected = 0;

  for (const candidate of verifiedArticles) {
    const { article, quality } = candidate;
    if (!quality.accepted || !quality.effectiveTime || !quality.timeBasis) {
      skipped += 1;
      qualityRejections[quality.reason] = (qualityRejections[quality.reason] ?? 0) + 1;
      const preserveVerified = quality.reason === "publisher_publication_unverified"
        && gdeltAliasQualityContinuation(
          candidate.existingAliases ?? [],
          article.eventTime,
        ).preserveAcceptedVerified;
      if (preserveVerified) continue;
      const rejectionAliases = Array.from(new Set([
        article.url,
        ...(candidate.existingAliases ?? []).map((item) => item.external_id),
      ]));
      for (const alias of rejectionAliases) {
        if (await quarantineGdeltArticle(sourceId, alias, article.title, quality.reason, verificationNow.toISOString(), article.eventTime)) {
          quarantined += 1;
        }
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
    const aliasHistory = planGdeltAliasPersistence(article.url, candidate.existingAliases ?? []);
    const temporal = mergeGdeltAliasTemporalEvidence(aliasHistory, {
      eventTime: quality.effectiveTime,
      timeBasis: quality.timeBasis,
      publication: quality.publication,
      providerSeenAt: article.eventTime,
    });
    const eventTime = temporal.eventTime;
    if (temporal.timeBasis === "provider_first_seen") providerFirstSeenAccepted += 1;
    const subject = resolveGdeltArticleSubject({
      title: article.title,
      url: article.url,
      context: candidate.context,
    });
    const hasCurrentSubjectCountry = Boolean(subject.countryIso2 || subject.subjectCountryIso2s.length > 0);
    const subjectCountry = subject.countryIso2 ?? aliasHistory.countryIso2;
    const subjectCountryIso2s = Array.from(new Set([
      ...subject.subjectCountryIso2s,
      ...aliasHistory.subjectCountryIso2s,
      ...(subjectCountry ? [subjectCountry] : []),
    ])).sort();
    const countryAttribution = hasCurrentSubjectCountry
      ? subject.countryAttribution
      : aliasHistory.countryAttribution;
    const countryInference = hasCurrentSubjectCountry
      ? subject.inference
      : aliasHistory.countryInference ?? subject.inference;
    await ensureCountry(subjectCountry);
    for (const country of subjectCountryIso2s) await ensureCountry(country);
    const payload = {
      provider: "gdelt",
      product: "gal-rss",
      canonical_url: article.url,
      canonical_url_algorithm: GDELT_CANONICAL_URL_ALGORITHM,
      attribution: ATTRIBUTION,
      source: article.domain,
      publisher: article.domain,
      domain: article.domain,
      source_country_iso2: null,
      language_code: "en",
      country_inference: countryInference,
      country_attribution: countryAttribution,
      subject_country_iso2s: subjectCountryIso2s,
      relevance_filter_score: article.relevanceScore,
      materiality_filter_score: article.materialityScore,
      discovery_lane: article.discoveryLane,
      time_basis: temporal.timeBasis,
      time_precision: temporal.timePrecision,
      publication_time_source: temporal.publicationTimeSource,
      provider_time_at: article.eventTime,
      provider_seen_at: article.eventTime,
      first_provider_seen_at: temporal.firstProviderSeenAt,
      last_provider_seen_at: article.eventTime,
      publisher_published_at: temporal.publisherPublishedAt,
      publication_time_verified: temporal.publicationTimeVerified,
      provider_discovery_fallback: temporal.timeBasis === "provider_first_seen",
      quality_status: "accepted",
      quality_checked_at: verificationNow.toISOString(),
      quality_checks: {
        provider_seen_at_valid: true,
        publisher_date_verified: temporal.publicationTimeVerified,
        publisher_date_fresh: quality.publication && temporal.incomingPublicationConsistent ? true : null,
        publisher_date_not_after_provider_seen: quality.publication ? true : null,
        publisher_date_not_after_historical_first_seen: quality.publication
          ? temporal.incomingPublicationConsistent
          : null,
        article_url_valid: true,
      },
      fallback_reason: reason,
      ...(candidate.existingAliases?.length ? {
        canonical_alias_history: {
          aliases_seen: candidate.existingAliases.length,
          persistence_external_id: aliasHistory.persistenceExternalId,
          earliest_effective_at: eventTime,
        },
      } : {}),
      gkg: aliasHistory.gkg,
      license: { data: "GDELT unrestricted use with attribution", article: "Third-party publisher content" },
    };
    const dedupeHash = gdeltArticleDedupeHash(article.url);
    const result = await query<{ id: string; inserted: boolean; event_time: string }>(
      `INSERT INTO item (
         source_id, external_id, kind, title, summary, url, country_iso2, event_time,
         payload, dedupe_hash, language_code, source_country_iso2, tone
       ) VALUES ($1,$2,'news_article',$3,NULL,$4,$5,$6,$7,$8,'en',NULL,NULL)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         title = COALESCE(item.title, EXCLUDED.title),
         url = EXCLUDED.url,
         country_iso2 = CASE
           WHEN item.payload->>'product'='doc-2.0' AND item.country_iso2 IS NOT NULL THEN item.country_iso2
           ELSE ${MERGED_GDELT_COUNTRY_SQL}
         END,
         event_time = ${MERGED_GDELT_EVENT_TIME_SQL},
         payload = CASE
           WHEN item.payload->>'product' = 'doc-2.0'
             THEN ${MERGED_GDELT_DOC_ALIAS_HISTORY_PAYLOAD_SQL}
           ELSE ${MERGED_GDELT_PAYLOAD_SQL}
         END,
         dedupe_hash = EXCLUDED.dedupe_hash,
         updated_at = now()
       WHERE item.url IS DISTINCT FROM EXCLUDED.url
          OR item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
          OR (item.title IS NULL AND EXCLUDED.title IS NOT NULL)
          OR item.country_iso2 IS DISTINCT FROM CASE
            WHEN item.payload->>'product'='doc-2.0' AND item.country_iso2 IS NOT NULL THEN item.country_iso2
            ELSE ${MERGED_GDELT_COUNTRY_SQL}
          END
          OR item.event_time IS DISTINCT FROM ${MERGED_GDELT_EVENT_TIME_SQL}
          OR (
            item.payload->>'product' = 'doc-2.0'
            AND item.payload IS DISTINCT FROM ${MERGED_GDELT_DOC_ALIAS_HISTORY_PAYLOAD_SQL}
          )
          OR (
            item.payload->>'product' IS DISTINCT FROM 'doc-2.0'
            AND (
              item.event_time IS DISTINCT FROM ${MERGED_GDELT_EVENT_TIME_SQL}
              OR item.payload IS DISTINCT FROM ${MERGED_GDELT_PAYLOAD_SQL}
            )
          )
       RETURNING id::text,(xmax = 0) AS inserted,event_time::text`,
      [sourceId, aliasHistory.persistenceExternalId, article.title, article.url, subjectCountry, eventTime, JSON.stringify(payload), dedupeHash],
    );
    if (!result.rows[0]) unchanged += 1;
    else if (result.rows[0].inserted) inserted += 1;
    else updated += 1;
    const persistedEventTime = result.rows[0]?.event_time ?? candidate.existing?.event_time ?? eventTime;
    if (!latestEventTime || persistedEventTime > latestEventTime) latestEventTime = persistedEventTime;
    aliasesSynchronized += await synchronizeAcceptedGdeltAliases(
      result.rows[0]?.id ?? aliasHistory.persistenceItemId,
      candidate.existingAliases ?? [],
    );
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
    canonical_aliases_synchronized: aliasesSynchronized,
    provider_first_seen_accepted: providerFirstSeenAccepted,
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
  // Raw Event/GKG archives are enrichment, not a prerequisite for headlines.
  // Resolve them in parallel with DOC discovery and convert lookup failures to
  // values immediately so a rejected promise cannot suppress DOC/GAL or become
  // an unhandled rejection while the rate-limited discovery lanes are running.
  const archiveResolution = includeEvents || includeGkg
    ? getLatestArchiveUrls().then(
        (urls) => ({ urls, error: null as string | null }),
        (error) => ({
          urls: null,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    : Promise.resolve({ urls: null, error: null as string | null });
  const gkgArchiveWindow = includeGkg
    ? archiveResolution.then<GdeltGkgArchiveWindow>((resolution) => (
        resolution.urls
          ? { urls: gdeltGkgWindowUrls(resolution.urls.gkg, params.timespan?.trim() || "1h") }
          : { urls: [], resolutionError: resolution.error ?? "GDELT archive lookup failed." }
      ))
    : undefined;
  const eventArchive = includeEvents
    ? archiveResolution.then(async (resolution): Promise<{ count: number; error: string | null }> => {
        if (!resolution.urls) return { count: 0, error: resolution.error ?? "GDELT archive lookup failed." };
        try {
          return {
            count: await ingestEventArchive(sourceId, resolution.urls.event, maxRawRows),
            error: null,
          };
        } catch (error) {
          return { count: 0, error: error instanceof Error ? error.message : String(error) };
        }
      })
    : Promise.resolve({ count: 0, error: null as string | null });
  let gkgHandledByDoc = false;
  if (includeDoc) {
    const headlineBudgets = planGdeltHeadlineBudgets(params.maxRecords ?? process.env.GDELT_DOC_MAX_ARTICLES);
    result.headline_budget = headlineBudgets;
    try {
      const doc = await ingestDocArticles(
        sourceId,
        { ...params, maxRecords: headlineBudgets.doc },
        gkgArchiveWindow,
      );
      gkgHandledByDoc = includeGkg;
      // GKG is fetched alongside the DOC lanes. Preserve its exact-run
      // completion metrics even when DOC itself has no usable headline and
      // GAL must provide the headline fallback; otherwise the release gate
      // can incorrectly report that no location archive was decoded.
      result.signals = doc.gkg_sampled + doc.gkg_matched;
      result.gkg_sampled = doc.gkg_sampled;
      result.gkg_matched = doc.gkg_matched;
      result.gkg_country_rows = doc.gkg_country_rows;
      result.gkg_matched_country_rows = doc.gkg_matched_country_rows;
      result.gkg_canonical_country_url_probes = doc.gkg_canonical_country_url_probes;
      result.gkg_archives_scanned = doc.gkg_archives_scanned;
      result.gkg_archive_errors = doc.gkg_archive_errors;
      result.inserted = Number(result.inserted) + doc.gkg_sampled + doc.gkg_matched;
      if (!hasUsableGdeltDocCoverage(doc)) {
        throw new Error("GDELT DOC returned no current persisted article inside the four-hour coverage window.");
      }
      const failedLanes = doc.discovery_lanes.filter((lane) => lane.status === "failed");
      const emptyLanes = doc.discovery_lanes.filter((lane) => lane.status === "empty");
      const requiredEmptyLanes = emptyLanes.filter((lane) => lane.id === "markets_macro");
      const degradedLanes = [...failedLanes, ...requiredEmptyLanes];
      result.articles = doc;
      result.doc_status = degradedLanes.length > 0 ? "healthy_partial" : "healthy";
      result.health = degradedLanes.length > 0 ? "degraded" : "healthy";
      if (degradedLanes.length > 0) {
        result.partial = true;
        result.failed_discovery_lanes = failedLanes.map((lane) => lane.id);
        result.empty_required_discovery_lanes = requiredEmptyLanes.map((lane) => lane.id);
        result.http_failures = Number(result.http_failures)
          + failedLanes.filter((lane) => /\bHTTP\b/i.test(lane.error ?? "")).length;
      }
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

  // A DOC-wide failure can occur before optional GKG enrichment starts. Keep
  // the raw signal sample available in that case, still without allowing it to
  // alter the headline fallback decision.
  if (includeGkg && !gkgHandledByDoc && gkgArchiveWindow) {
    const gkg = await ingestGkgArchiveWindow(sourceId, await gkgArchiveWindow, [], maxRawRows);
    result.signals = gkg.sampled;
    result.gkg_sampled = gkg.sampled;
    result.gkg_matched = gkg.matched;
    result.gkg_country_rows = gkg.countryRows;
    result.gkg_matched_country_rows = gkg.matchedCountryRows;
    result.gkg_canonical_country_url_probes = gkg.canonicalCountryUrls.length;
    result.gkg_archives_scanned = gkg.archivesScanned;
    result.gkg_archive_errors = gkg.archiveErrors;
    result.inserted = Number(result.inserted) + gkg.sampled;
  }

  const event = await eventArchive;
  if (includeEvents) {
    result.events = event.count;
    result.inserted = Number(result.inserted) + event.count;
    if (event.error) result.event_archive_error = event.error;
  }
  const archiveErrors = Array.from(new Set([
    ...(Array.isArray(result.gkg_archive_errors) ? result.gkg_archive_errors as string[] : []),
    ...(event.error ? [event.error] : []),
  ]));
  if (archiveErrors.length > 0) {
    result.partial = true;
    result.raw_archive_status = "degraded";
    result.http_failures = Number(result.http_failures)
      + archiveErrors.filter((message) => /\bHTTP\b/i.test(message)).length;
    if (result.health === "healthy") result.health = "degraded";
  } else if (includeEvents || includeGkg) {
    result.raw_archive_status = "healthy";
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
