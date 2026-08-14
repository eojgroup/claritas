import crypto from "node:crypto";
import worldCountries from "world-countries";
import { query } from "../db";
import { inferNewsCountry, type CountryInferenceResult } from "./country-inference";

const GOVUK_SEARCH_URL = "https://www.gov.uk/api/search.json";
const GOVUK_HOMEPAGE = "https://www.gov.uk/search/news-and-communications";
const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const ALLOWED_DOCUMENT_TYPES = ["news_story", "press_release", "world_news_story"] as const;
const ALLOWED_DOCUMENT_TYPE_SET = new Set<string>(ALLOWED_DOCUMENT_TYPES);

type GovUkOrganisation = {
  title?: unknown;
  acronym?: unknown;
  link?: unknown;
};

type GovUkWorldLocation = {
  title?: unknown;
  link?: unknown;
};

type GovUkSearchResult = {
  _id?: unknown;
  title?: unknown;
  description?: unknown;
  link?: unknown;
  public_timestamp?: unknown;
  content_store_document_type?: unknown;
  organisations?: unknown;
  world_locations?: unknown;
};

type GovUkSearchResponse = {
  total?: unknown;
  results?: unknown;
};

export type NormalizedGovUkNewsItem = {
  externalId: string;
  title: string;
  summary: string | null;
  url: string;
  eventTime: string;
  documentType: (typeof ALLOWED_DOCUMENT_TYPES)[number];
  publisher: string;
  organisations: Array<{ title: string; acronym: string | null; url: string | null }>;
  worldLocations: Array<{ title: string; url: string | null }>;
  countryInference: CountryInferenceResult;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), min), max) : fallback;
}

function text(value: unknown, max = 10_000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function govUkUrl(path: unknown): string | null {
  const value = text(path, 2_000);
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://www.gov.uk");
    return url.origin === "https://www.gov.uk" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  // A malformed or prematurely indexed future date must not make the news
  // pipeline appear current indefinitely.
  if (parsed > Date.now() + 5 * 60_000) return null;
  return new Date(parsed).toISOString();
}

function normalizeOrganisations(value: unknown): NormalizedGovUkNewsItem["organisations"] {
  if (!Array.isArray(value)) return [];
  const organizations: NormalizedGovUkNewsItem["organisations"] = [];
  for (const entry of value.slice(0, 10)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const organisation = entry as GovUkOrganisation;
    const title = text(organisation.title, 300);
    if (!title) continue;
    organizations.push({
      title,
      acronym: text(organisation.acronym, 60),
      url: govUkUrl(organisation.link),
    });
  }
  return organizations;
}

function normalizeWorldLocations(value: unknown): NormalizedGovUkNewsItem["worldLocations"] {
  if (!Array.isArray(value)) return [];
  const locations: NormalizedGovUkNewsItem["worldLocations"] = [];
  for (const entry of value.slice(0, 20)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const location = entry as GovUkWorldLocation;
    const title = text(location.title, 200);
    if (!title) continue;
    locations.push({ title, url: govUkUrl(location.link) });
  }
  return locations;
}

function normalizedCountryName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const COUNTRY_BY_EXACT_NAME = new Map<string, string>();
for (const country of worldCountries) {
  const names = [country.name.common, country.name.official, ...(country.altSpellings ?? [])];
  for (const name of names) {
    const normalized = normalizedCountryName(name);
    if (normalized) COUNTRY_BY_EXACT_NAME.set(normalized, country.cca2);
  }
}

function inferGovUkSubjectCountry(input: {
  title: string;
  summary: string | null;
  url: string;
  worldLocations: NormalizedGovUkNewsItem["worldLocations"];
}): CountryInferenceResult {
  const inferred = inferNewsCountry({
    title: input.title,
    summary: input.summary,
    content: input.worldLocations.map((location) => location.title).join(" "),
    url: input.url,
    feedCountryHint: "GB",
  });
  const structuredCountries = Array.from(new Set(
    input.worldLocations
      .map((location) => COUNTRY_BY_EXACT_NAME.get(normalizedCountryName(location.title)) ?? null)
      .filter((iso2): iso2 is string => Boolean(iso2)),
  ));
  if (structuredCountries.length !== 1) return inferred;

  // GOV.UK world_locations describe the subject of a world news story. That
  // structured geography is stronger than the .gov.uk publisher origin or a
  // British organisation mentioned in the headline.
  return {
    ...inferred,
    iso2: structuredCountries[0],
    source: "content_alias",
    confidence: "high",
    matched_alias: input.worldLocations.find(
      (location) => COUNTRY_BY_EXACT_NAME.get(normalizedCountryName(location.title)) === structuredCountries[0],
    )?.title ?? null,
    content_score: Math.max(inferred.content_score, 10),
  };
}

export function normalizeGovUkNewsResult(value: unknown): NormalizedGovUkNewsItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as GovUkSearchResult;
  const title = text(result.title, 1_000);
  const url = govUkUrl(result.link);
  const eventTime = isoTimestamp(result.public_timestamp);
  const documentType = text(result.content_store_document_type, 80);
  if (!title || !url || !eventTime || !documentType || !ALLOWED_DOCUMENT_TYPE_SET.has(documentType)) {
    return null;
  }

  const summary = text(result.description, 5_000);
  const organisations = normalizeOrganisations(result.organisations);
  const worldLocations = normalizeWorldLocations(result.world_locations);
  const publisher = organisations[0]?.title ?? "UK Government";
  const countryInference = inferGovUkSubjectCountry({
    title,
    summary,
    url,
    worldLocations,
  });

  return {
    externalId: text(result._id, 2_000) ?? new URL(url).pathname,
    title,
    summary,
    url,
    eventTime,
    documentType: documentType as NormalizedGovUkNewsItem["documentType"],
    publisher,
    organisations,
    worldLocations,
    countryInference,
  };
}

export function buildGovUkNewsSearchUrl(options: {
  lookbackHours?: number;
  maxRecords?: number;
  now?: Date;
} = {}): string {
  const now = options.now ?? new Date();
  const lookbackHours = clampInt(
    options.lookbackHours ?? process.env.GOVUK_NEWS_LOOKBACK_HOURS,
    1,
    168,
    48,
  );
  const maxRecords = clampInt(
    options.maxRecords ?? process.env.GOVUK_NEWS_MAX_RECORDS,
    1,
    250,
    100,
  );
  const from = new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();
  const url = new URL(process.env.GOVUK_SEARCH_API_URL?.trim() || GOVUK_SEARCH_URL);
  url.searchParams.set("count", String(maxRecords));
  url.searchParams.set("order", "-public_timestamp");
  url.searchParams.set("filter_public_timestamp", `from:${from}`);
  for (const documentType of ALLOWED_DOCUMENT_TYPES) {
    url.searchParams.append("filter_any_content_store_document_type", documentType);
  }
  for (const field of [
    "title",
    "description",
    "link",
    "public_timestamp",
    "content_store_document_type",
    "organisations",
    "world_locations",
  ]) {
    url.searchParams.append("fields", field);
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGovUk(url: string): Promise<GovUkSearchResponse> {
  let lastStatus: number | null = null;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": process.env.APP_USER_AGENT?.trim() || "Claritas/1.0 (+https://app.claritas.info; engineering@claritas.info)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return await response.json() as GovUkSearchResponse;
    lastStatus = response.status;
    lastBody = (await response.text()).slice(0, 300);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 10_000) : 1_000 * (attempt + 1));
  }
  throw new Error(`GOV.UK Search API returned HTTP ${lastStatus ?? "unknown"}: ${lastBody || "empty response"}`);
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('govuk_search', $1, 'none', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type,
       metadata = EXCLUDED.metadata
     RETURNING id`,
    [GOVUK_SEARCH_URL, JSON.stringify({
      provider: "govuk_search",
      source_kind: "primary_source_news",
      publisher: "UK Government",
      homepage: GOVUK_HOMEPAGE,
      attribution: "Contains public sector information licensed under the Open Government Licence v3.0.",
      license: "Open Government Licence v3.0",
      license_url: OGL_URL,
      allowed_document_types: ALLOWED_DOCUMENT_TYPES,
      language_code: "en",
      source_country_iso2: "GB",
    })],
  );
  return rows[0].id;
}

export async function ingestGovUkNews(options: {
  lookbackHours?: number;
  maxRecords?: number;
} = {}): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  const retrievedAt = new Date().toISOString();
  const data = await fetchGovUk(buildGovUkNewsSearchUrl(options));
  const rawResults = Array.isArray(data.results) ? data.results : [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let latestEventTime: string | null = null;

  for (const rawResult of rawResults) {
    const item = normalizeGovUkNewsResult(rawResult);
    if (!item) {
      skipped += 1;
      continue;
    }
    if (!latestEventTime || item.eventTime > latestEventTime) latestEventTime = item.eventTime;
    if (item.countryInference.iso2) {
      await query(
        `INSERT INTO country (iso2, name) VALUES ($1::char(2), $1)
         ON CONFLICT (iso2) DO NOTHING`,
        [item.countryInference.iso2],
      );
    }
    const payload = {
      provider: "govuk_search",
      product: "search-api-v1",
      source: item.publisher,
      publisher: item.publisher,
      domain: "gov.uk",
      source_country: "United Kingdom",
      source_country_iso2: "GB",
      language: "English",
      language_code: "en",
      document_type: item.documentType,
      organisations: item.organisations,
      world_locations: item.worldLocations,
      country_inference: item.countryInference,
      country_attribution: item.countryInference.source,
      time_basis: "publisher_published",
      time_precision: "source_provided",
      publisher_published_at: item.eventTime,
      attribution: "Contains public sector information licensed under the Open Government Licence v3.0.",
      license: "Open Government Licence v3.0",
      license_url: OGL_URL,
    };
    const dedupeHash = crypto.createHash("sha256").update(`${item.url}|govuk-search`).digest("hex");
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO item (
         source_id, external_id, kind, title, summary, url, country_iso2, event_time,
         payload, dedupe_hash, language_code, source_country_iso2
       ) VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9,'en','GB')
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         url = EXCLUDED.url,
         country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2),
         event_time = EXCLUDED.event_time,
         payload = EXCLUDED.payload,
         dedupe_hash = EXCLUDED.dedupe_hash,
         language_code = EXCLUDED.language_code,
         source_country_iso2 = EXCLUDED.source_country_iso2,
         updated_at = now()
       WHERE item.title IS DISTINCT FROM EXCLUDED.title
          OR item.summary IS DISTINCT FROM EXCLUDED.summary
          OR item.url IS DISTINCT FROM EXCLUDED.url
          OR item.country_iso2 IS DISTINCT FROM COALESCE(EXCLUDED.country_iso2, item.country_iso2)
          OR item.event_time IS DISTINCT FROM EXCLUDED.event_time
          OR item.payload IS DISTINCT FROM EXCLUDED.payload
          OR item.dedupe_hash IS DISTINCT FROM EXCLUDED.dedupe_hash
          OR item.language_code IS DISTINCT FROM EXCLUDED.language_code
          OR item.source_country_iso2 IS DISTINCT FROM EXCLUDED.source_country_iso2
       RETURNING (xmax = 0) AS inserted`,
      [
        sourceId,
        item.externalId,
        item.title,
        item.summary,
        item.url,
        item.countryInference.iso2,
        item.eventTime,
        JSON.stringify(payload),
        dedupeHash,
      ],
    );
    if (!result.rows[0]) unchanged += 1;
    else if (result.rows[0].inserted) inserted += 1;
    else updated += 1;
  }

  return {
    provider: "govuk_search",
    health: "healthy",
    retrieved_at: retrievedAt,
    latest_event_time: latestEventTime,
    fetched: rawResults.length,
    total_available: typeof data.total === "number" ? data.total : null,
    inserted,
    updated,
    unchanged,
    skipped,
  };
}
