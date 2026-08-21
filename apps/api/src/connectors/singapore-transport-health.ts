export const SINGAPORE_TRANSPORT_COUNTRY = "SG";

export type SingaporeTransportHealthRow = {
  current_vessels: string | number | null;
  latest_observed_at: string | Date | null;
  source_names: string[] | null;
};

export function buildSingaporeTransportHealthQuery(): string {
  return `SELECT
    COUNT(*) AS current_vessels,
    MAX(s.observed_at) AS latest_observed_at,
    ARRAY_AGG(DISTINCT s.source_name ORDER BY s.source_name)
      FILTER (WHERE s.source_name IS NOT NULL) AS source_names
  FROM transport_snapshot s
  WHERE s.mode = 'maritime'
    AND s.current_country_iso2 = $1
    AND s.observed_at >= now() - ($2::integer * interval '1 second')
    AND s.observed_at <= now() + interval '1 minute'`;
}

function parseCount(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function timestamp(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validate the position-derived Singapore vessel coverage stored in the
 * release database. Flag, origin, destination and route links deliberately do
 * not contribute to this gate.
 */
export function evaluateSingaporeTransportHealth(
  row: SingaporeTransportHealthRow | undefined,
  options: { now: number; freshnessMilliseconds: number },
) {
  const currentVessels = parseCount(row?.current_vessels);
  const latestObservedAt = timestamp(row?.latest_observed_at);
  const ageMilliseconds = latestObservedAt == null
    ? null
    : options.now - latestObservedAt;
  const latestPositionCurrent =
    ageMilliseconds != null &&
    ageMilliseconds >= -60_000 &&
    ageMilliseconds <= options.freshnessMilliseconds;
  const ready = currentVessels > 0 && latestPositionCurrent;

  return {
    ready,
    state: ready ? "current_singapore_vessel" : "no_current_singapore_vessel",
    checked_at: new Date(options.now).toISOString(),
    country: SINGAPORE_TRANSPORT_COUNTRY,
    mode: "maritime" as const,
    position_basis: "current_country_iso2" as const,
    cache_bypassed: true,
    freshness_seconds: Math.round(options.freshnessMilliseconds / 1_000),
    current_vessels: currentVessels,
    latest_observed_at:
      latestObservedAt == null ? null : new Date(latestObservedAt).toISOString(),
    source_names: Array.from(new Set(row?.source_names ?? [])).sort(),
  };
}
