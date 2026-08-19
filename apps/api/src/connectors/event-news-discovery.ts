import type { PoolClient } from "pg";
import worldCountries from "world-countries";
import { query, withTransaction } from "../db";
import {
  ingestTargetedGdeltNews,
  type GdeltTargetedDiscoveryContext,
} from "./gdelt";

export type EarthquakeNewsDiscoveryTarget = {
  earthquakeObservationId: string;
  usgsEventId: string;
  place: string;
  countryIso2: string | null;
  magnitude: number | null;
  significance: number | null;
  tsunami: boolean;
  latitude: number;
  longitude: number;
  observedAt: Date;
  sourceUpdatedAt: Date;
};

type DiscoveryJob = {
  id: string;
  earthquake_observation_id: string;
  attempts: number;
  max_attempts: number;
  payload: unknown;
};

export type EarthquakeNewsDiscoveryStatus = {
  state: "ready" | "backlogged" | "attention";
  pending: number;
  processing: number;
  retrying: number;
  completed: number;
  dead_letter: number;
  active: number;
  capacity: number;
  oldest_active_at: string | null;
  latest_completed_at: string | null;
};

const DEFAULT_MINIMUM_MAGNITUDE = 5.5;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_QUEUE_CAPACITY = 100;
const TARGETED_QUERY_MAX_RECORDS = 8;
const TARGETED_QUERY_TIMESPAN = "3d";

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function normalizedCountryIso2(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function earthquakeCountryIso2FromPlace(place: unknown): string | null {
  if (typeof place !== "string" || !place.trim()) return null;
  const normalized = place.trim().toLocaleLowerCase();
  const matches = worldCountries.filter((country) => {
    const names = [country.name.common, country.name.official, ...(country.altSpellings ?? [])]
      .map((name) => name.trim().toLocaleLowerCase())
      .filter(Boolean);
    return names.some((name) => normalized === name
      || normalized.endsWith(`, ${name}`)
      || normalized.endsWith(` ${name}`));
  });
  return matches.length === 1 ? matches[0].cca2 : null;
}

function countryNameForIso2(countryIso2: string | null): string | null {
  if (!countryIso2) return null;
  return worldCountries.find((country) => country.cca2 === countryIso2)?.name.common ?? null;
}

function safeQueryTerm(value: string): string | null {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s.'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (normalized.length < 2 || /^(?:unspecified|unknown)(?: location)?$/i.test(normalized)) return null;
  return normalized;
}

export function earthquakePlaceAnchor(place: string): string | null {
  const localPart = place.split(",")[0] ?? place;
  const withoutDistance = localPart
    .replace(/^\s*\d+(?:\.\d+)?\s*km\s+(?:[NSEW]{1,3}\s+)?(?:of\s+)?/i, "")
    .replace(/^\s*(?:near|offshore(?: of)?|off the coast of)\s+/i, "")
    .trim();
  return safeQueryTerm(withoutDistance);
}

export function buildEarthquakeGdeltQuery(input: {
  place: string;
  countryIso2?: string | null;
}): { query: string; anchorTerms: string[] } {
  const countryIso2 = normalizedCountryIso2(input.countryIso2)
    ?? earthquakeCountryIso2FromPlace(input.place);
  const localPlace = earthquakePlaceAnchor(input.place);
  const countryName = countryNameForIso2(countryIso2)
    ?? safeQueryTerm(input.place.split(",").at(-1) ?? "");
  const anchorTerms = Array.from(new Set([localPlace, countryName].filter((term): term is string => Boolean(term))));
  if (!anchorTerms.length) throw new Error("Earthquake place does not contain a safe targeted-news search anchor.");
  const quotedAnchors = anchorTerms.map((term) => `\"${term.replace(/\"/g, "")}\"`).join(" OR ");
  return {
    query: `(earthquake OR quake OR aftershock OR seismic OR tremor OR tsunami) (${quotedAnchors})`,
    anchorTerms,
  };
}

export function qualifiesForEarthquakeNewsDiscovery(
  input: Pick<EarthquakeNewsDiscoveryTarget, "magnitude" | "significance" | "tsunami" | "place">,
  minimumMagnitude = DEFAULT_MINIMUM_MAGNITUDE,
): boolean {
  const magnitude = Number(input.magnitude);
  const significance = Number(input.significance);
  return Boolean(input.place.trim()) && (
    (Number.isFinite(magnitude) && magnitude >= minimumMagnitude)
    || (Number.isFinite(significance) && significance >= 600)
    || input.tsunami
  );
}

export function nextEarthquakeNewsDiscoveryState(input: {
  attempts: number;
  maxAttempts: number;
  observedAt: Date;
  now?: Date;
  failed: boolean;
  coverageFound?: boolean;
}): { status: "retry" | "completed" | "dead_letter"; retryAfterMinutes: number | null } {
  if (input.attempts >= input.maxAttempts) {
    return { status: input.failed ? "dead_letter" : "completed", retryAfterMinutes: null };
  }
  const now = input.now ?? new Date();
  const monitorHours = boundedInt(process.env.EVENT_NEWS_DISCOVERY_MONITOR_HOURS, 24, 3, 72);
  if (now.getTime() >= input.observedAt.getTime() + monitorHours * 3_600_000) {
    return { status: input.failed ? "dead_letter" : "completed", retryAfterMinutes: null };
  }
  // Coverage frequently emerges after the first machine observation. These
  // delays sample that reporting curve while keeping every event to six
  // small queries over roughly 21 hours by default.
  const retryMinutes = [15, 45, 120, 360, 720];
  return {
    status: "retry",
    retryAfterMinutes: retryMinutes[Math.min(input.attempts - 1, retryMinutes.length - 1)],
  };
}

export function isRetryableEarthquakeNewsDiscoveryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/payload|search anchor|event identity/i.test(message)) return false;
  const httpStatus = /\bGDELT HTTP (\d{3})\b/i.exec(message)?.[1];
  if (!httpStatus) return true;
  const status = Number(httpStatus);
  return status === 408 || status === 429 || status >= 500;
}

export function earthquakeNewsDiscoveryRevisionChanged(
  existingSourceUpdatedAt: unknown,
  nextSourceUpdatedAt: unknown,
): boolean {
  const existing = typeof existingSourceUpdatedAt === "string" ? Date.parse(existingSourceUpdatedAt) : Number.NaN;
  const next = typeof nextSourceUpdatedAt === "string" ? Date.parse(nextSourceUpdatedAt) : Number.NaN;
  return Number.isFinite(next) && (!Number.isFinite(existing) || existing !== next);
}

export function targetedDiscoveryResultHasLikelyCoverage(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  return Number((result as Record<string, unknown>).link_eligible ?? 0) > 0;
}

export async function enqueueEarthquakeNewsDiscovery(
  client: PoolClient,
  target: EarthquakeNewsDiscoveryTarget,
): Promise<boolean> {
  const minimumMagnitude = Number(process.env.EVENT_NEWS_DISCOVERY_MIN_MAGNITUDE ?? DEFAULT_MINIMUM_MAGNITUDE);
  if (!qualifiesForEarthquakeNewsDiscovery(
    target,
    Number.isFinite(minimumMagnitude) ? minimumMagnitude : DEFAULT_MINIMUM_MAGNITUDE,
  )) return false;
  const maximumAttempts = boundedInt(
    process.env.EVENT_NEWS_DISCOVERY_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
    2,
    8,
  );
  const queueCapacity = boundedInt(
    process.env.EVENT_NEWS_DISCOVERY_QUEUE_CAPACITY,
    DEFAULT_QUEUE_CAPACITY,
    10,
    500,
  );
  const payload = {
    usgs_event_id: target.usgsEventId,
    place: target.place,
    country_iso2: normalizedCountryIso2(target.countryIso2)
      ?? earthquakeCountryIso2FromPlace(target.place),
    magnitude: target.magnitude,
    significance: target.significance,
    tsunami: target.tsunami,
    latitude: target.latitude,
    longitude: target.longitude,
    observed_at: target.observedAt.toISOString(),
    source_updated_at: target.sourceUpdatedAt.toISOString(),
  };
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO earthquake_news_discovery (
       earthquake_observation_id,status,attempts,max_attempts,available_at,payload
     )
     SELECT $1::uuid,'pending',0,$2,now(),$3::jsonb
     WHERE EXISTS (
       SELECT 1 FROM earthquake_news_discovery WHERE earthquake_observation_id=$1::uuid
     ) OR (
       SELECT count(*) FROM earthquake_news_discovery
       WHERE status IN ('pending','processing','retry')
     ) < $4
     ON CONFLICT (earthquake_observation_id) DO UPDATE SET
       payload=EXCLUDED.payload,
       status=CASE
         WHEN earthquake_news_discovery.status IN ('completed','dead_letter') THEN 'pending'
         ELSE earthquake_news_discovery.status
       END,
       attempts=CASE
         WHEN earthquake_news_discovery.status IN ('completed','dead_letter') THEN 0
         ELSE earthquake_news_discovery.attempts
       END,
       max_attempts=EXCLUDED.max_attempts,
       available_at=CASE
         WHEN earthquake_news_discovery.status IN ('completed','dead_letter') THEN now()
         ELSE earthquake_news_discovery.available_at
       END,
       lease_until=CASE
         WHEN earthquake_news_discovery.status IN ('completed','dead_letter') THEN NULL
         ELSE earthquake_news_discovery.lease_until
       END,
       completed_at=CASE
         WHEN earthquake_news_discovery.status IN ('completed','dead_letter') THEN NULL
         ELSE earthquake_news_discovery.completed_at
       END,
       last_error=NULL,
       updated_at=now()
     WHERE earthquake_news_discovery.payload->>'source_updated_at'
       IS DISTINCT FROM EXCLUDED.payload->>'source_updated_at'
     RETURNING id`,
    [target.earthquakeObservationId, maximumAttempts, JSON.stringify(payload), queueCapacity],
  );
  return rows.length > 0;
}

function discoveryContext(job: DiscoveryJob): GdeltTargetedDiscoveryContext {
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) {
    throw new Error("Earthquake news discovery payload is invalid.");
  }
  const payload = job.payload as Record<string, unknown>;
  const place = typeof payload.place === "string" ? payload.place.trim() : "";
  const usgsEventId = typeof payload.usgs_event_id === "string" ? payload.usgs_event_id.trim() : "";
  const observedAt = typeof payload.observed_at === "string" ? payload.observed_at : "";
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!place || !usgsEventId || Number.isNaN(Date.parse(observedAt))
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Earthquake news discovery payload lacks a valid event identity, time, or coordinate.");
  }
  const countryIso2 = normalizedCountryIso2(payload.country_iso2)
    ?? earthquakeCountryIso2FromPlace(place);
  const { query: targetedQuery, anchorTerms } = buildEarthquakeGdeltQuery({ place, countryIso2 });
  const magnitude = payload.magnitude == null ? null : Number(payload.magnitude);
  return {
    earthquakeObservationId: job.earthquake_observation_id,
    usgsEventId,
    place,
    countryIso2,
    magnitude: Number.isFinite(magnitude) ? magnitude : null,
    latitude,
    longitude,
    observedAt: new Date(observedAt).toISOString(),
    query: targetedQuery,
    anchorTerms,
  };
}

async function claimDiscoveryJob(): Promise<DiscoveryJob | null> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE earthquake_news_discovery
       SET status='dead_letter',lease_until=NULL,completed_at=now(),
           last_error=COALESCE(last_error,'Retry budget exhausted.'),updated_at=now()
       WHERE attempts>=max_attempts
         AND (status IN ('pending','retry') OR (status='processing' AND lease_until<=now()))`,
    );
    const { rows } = await client.query<DiscoveryJob>(
      `WITH candidate AS (
         SELECT id FROM earthquake_news_discovery
         WHERE attempts<max_attempts
           AND (
             (status IN ('pending','retry') AND available_at<=now())
             OR (status='processing' AND lease_until<=now())
           )
         ORDER BY available_at,created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE earthquake_news_discovery discovery
       SET status='processing',attempts=attempts+1,
           lease_until=now()+interval '3 minutes',last_error=NULL,updated_at=now()
       FROM candidate WHERE discovery.id=candidate.id
       RETURNING discovery.id,discovery.earthquake_observation_id,
                 discovery.attempts,discovery.max_attempts,discovery.payload`,
    );
    return rows[0] ?? null;
  });
}

async function finishDiscoveryJob(
  job: DiscoveryJob,
  result: Record<string, unknown> | null,
  error: unknown,
): Promise<void> {
  let observedAt = new Date(0);
  try {
    observedAt = new Date(discoveryContext(job).observedAt);
  } catch {
    // Invalid payloads are handled as terminal acquisition failures below.
  }
  const failed = error != null;
  const coverageFound = targetedDiscoveryResultHasLikelyCoverage(result);
  const retryableFailure = failed && isRetryableEarthquakeNewsDiscoveryError(error);
  const next = nextEarthquakeNewsDiscoveryState({
    attempts: job.attempts,
    maxAttempts: failed && !retryableFailure ? job.attempts : job.max_attempts,
    observedAt,
    failed,
    coverageFound,
  });
  const message = failed ? (error instanceof Error ? error.message : String(error)).slice(0, 2_000) : null;
  await query(
    `UPDATE earthquake_news_discovery
     SET status=$2,
         available_at=CASE WHEN $3::int IS NULL THEN available_at ELSE now()+make_interval(mins=>$3::int) END,
         lease_until=NULL,last_result=$4::jsonb,last_error=$5,
         completed_at=CASE WHEN $2 IN ('completed','dead_letter') THEN now() ELSE NULL END,
         updated_at=now()
     WHERE id=$1::uuid`,
    [job.id, next.status, next.retryAfterMinutes, result ? JSON.stringify(result) : null, message],
  );
}

export async function processEarthquakeNewsDiscoveryQueue(options: {
  ingest?: typeof ingestTargetedGdeltNews;
  batchSize?: number;
} = {}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const ingest = options.ingest ?? ingestTargetedGdeltNews;
  const batchSize = boundedInt(
    options.batchSize ?? process.env.EVENT_NEWS_DISCOVERY_BATCH_SIZE,
    1,
    1,
    3,
  );
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < batchSize; index += 1) {
    const job = await claimDiscoveryJob();
    if (!job) break;
    processed += 1;
    try {
      const context = discoveryContext(job);
      const result = await ingest(context, {
        timespan: process.env.EVENT_NEWS_DISCOVERY_TIMESPAN?.trim() || TARGETED_QUERY_TIMESPAN,
        maxRecords: boundedInt(
          process.env.EVENT_NEWS_DISCOVERY_MAX_RECORDS,
          TARGETED_QUERY_MAX_RECORDS,
          1,
          12,
        ),
      });
      await finishDiscoveryJob(job, result, null);
      succeeded += 1;
    } catch (error) {
      await finishDiscoveryJob(job, null, error);
      failed += 1;
      console.warn(JSON.stringify({
        event: "earthquake_news_discovery_failed",
        earthquake_observation_id: job.earthquake_observation_id,
        attempt: job.attempts,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  // The queue is operational state, not an archive. Retention bounds table
  // growth while leaving a month of terminal outcomes for diagnostics.
  await query(
    `DELETE FROM earthquake_news_discovery
     WHERE status IN ('completed','dead_letter') AND completed_at<now()-interval '30 days'`,
  );
  return { processed, succeeded, failed };
}

export async function getEarthquakeNewsDiscoveryStatus(): Promise<EarthquakeNewsDiscoveryStatus> {
  const capacity = boundedInt(
    process.env.EVENT_NEWS_DISCOVERY_QUEUE_CAPACITY,
    DEFAULT_QUEUE_CAPACITY,
    10,
    500,
  );
  const { rows } = await query<{
    pending: number;
    processing: number;
    retrying: number;
    completed: number;
    dead_letter: number;
    oldest_active_at: string | Date | null;
    latest_completed_at: string | Date | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE status='pending')::int AS pending,
       count(*) FILTER (WHERE status='processing')::int AS processing,
       count(*) FILTER (WHERE status='retry')::int AS retrying,
       count(*) FILTER (WHERE status='completed')::int AS completed,
       count(*) FILTER (WHERE status='dead_letter')::int AS dead_letter,
       min(created_at) FILTER (WHERE status IN ('pending','processing','retry')) AS oldest_active_at,
       max(completed_at) FILTER (WHERE status='completed') AS latest_completed_at
     FROM earthquake_news_discovery`,
  );
  const row = rows[0] ?? {
    pending: 0,
    processing: 0,
    retrying: 0,
    completed: 0,
    dead_letter: 0,
    oldest_active_at: null,
    latest_completed_at: null,
  };
  const active = Number(row.pending) + Number(row.processing) + Number(row.retrying);
  return {
    state: active >= capacity ? "backlogged" : Number(row.dead_letter) > 0 ? "attention" : "ready",
    pending: Number(row.pending),
    processing: Number(row.processing),
    retrying: Number(row.retrying),
    completed: Number(row.completed),
    dead_letter: Number(row.dead_letter),
    active,
    capacity,
    oldest_active_at: row.oldest_active_at ? new Date(row.oldest_active_at).toISOString() : null,
    latest_completed_at: row.latest_completed_at ? new Date(row.latest_completed_at).toISOString() : null,
  };
}
