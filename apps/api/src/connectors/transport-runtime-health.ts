export type TransportRetentionHealth = {
  running: boolean;
  last_pass_at: string | null;
  duration_ms: number | null;
  deleted_rows: number;
  batches: number;
  backlog: boolean;
  backlog_tables: string[];
  oldest_expired_at: string | null;
  budget_exhausted: boolean;
  error: boolean;
};

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%")[0];
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

export function transportRetentionBudgetAvailable(input: {
  now: number;
  deadline: number;
  batches: number;
  maximumBatches: number;
}): boolean {
  return input.now < input.deadline && input.batches < input.maximumBatches;
}

export type TransportRuntimeHealthInput = {
  now: number;
  freshnessMilliseconds: number;
  workerStarted: boolean;
  workerLeader: boolean;
  primaryConfigured: boolean;
  primaryConnected: boolean;
  primaryLastMessageAt: number | null;
  primaryLastSnapshotAt: number | null;
  primaryLastStoredAt: number | null;
  primaryError: boolean;
  fallbackConfigured: boolean;
  fallbackLastRefreshAt: number | null;
  fallbackLastSnapshotAt: number | null;
  fallbackLastStoredAt: number | null;
  fallbackError: boolean;
  retention: TransportRetentionHealth;
};

function mostRecent(...timestamps: Array<number | null>): number | null {
  const present = timestamps.filter(
    (timestamp): timestamp is number => timestamp != null && Number.isFinite(timestamp),
  );
  return present.length ? Math.max(...present) : null;
}

function isCurrent(now: number, timestamp: number | null, freshness: number): boolean {
  return timestamp != null && now - timestamp >= 0 && now - timestamp <= freshness;
}

function isoTimestamp(timestamp: number | null): string | null {
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

/**
 * Classify transport ingestion without pretending regional AIS is global.
 * A successful fallback poll is provider liveness even when no fresh vessel
 * happens to be in its reception area; usable traffic is reported separately.
 */
export function buildTransportRuntimeHealth(input: TransportRuntimeHealthInput) {
  const primaryStateAt = mostRecent(
    input.primaryLastMessageAt,
    input.primaryLastSnapshotAt,
    input.primaryLastStoredAt,
  );
  const primaryTrafficAt = mostRecent(
    input.primaryLastSnapshotAt,
    input.primaryLastStoredAt,
  );
  const fallbackStateAt = input.fallbackLastRefreshAt;
  const fallbackTrafficAt = mostRecent(
    input.fallbackLastSnapshotAt,
    input.fallbackLastStoredAt,
  );
  const primaryCurrent =
    input.primaryConfigured &&
    input.primaryConnected &&
    !input.primaryError &&
    // A WebSocket frame proves only that the connection is exchanging bytes.
    // Release readiness requires a decoded vessel position that was accepted
    // and persisted; malformed/control-only traffic must not make an empty
    // transport feature appear healthy.
    isCurrent(input.now, input.primaryLastSnapshotAt, input.freshnessMilliseconds) &&
    isCurrent(input.now, input.primaryLastStoredAt, input.freshnessMilliseconds);
  const fallbackCurrent =
    input.fallbackConfigured &&
    !input.fallbackError &&
    isCurrent(input.now, fallbackStateAt, input.freshnessMilliseconds);
  const primaryTrafficCurrent =
    input.primaryConfigured &&
    isCurrent(input.now, primaryTrafficAt, input.freshnessMilliseconds);
  const fallbackTrafficCurrent =
    input.fallbackConfigured &&
    isCurrent(input.now, fallbackTrafficAt, input.freshnessMilliseconds);

  const state = !input.workerStarted
    ? "not_started"
    : !input.workerLeader
      ? "standby"
      : primaryCurrent
        ? "live_primary"
        : fallbackCurrent
          ? "regional_fallback"
          : "unavailable";
  const ready = state === "live_primary" || state === "regional_fallback";
  const degraded = ready && state !== "live_primary";

  return {
    ready,
    degraded,
    state,
    checked_at: new Date(input.now).toISOString(),
    freshness_seconds: Math.round(input.freshnessMilliseconds / 1_000),
    primary: {
      provider: "AISstream",
      configured: input.primaryConfigured,
      connected: input.primaryConnected,
      current: primaryCurrent,
      traffic_current: primaryTrafficCurrent,
      last_state_at: isoTimestamp(primaryStateAt),
      last_traffic_at: isoTimestamp(primaryTrafficAt),
      readiness_basis: "accepted_and_persisted_position",
      error: input.primaryError,
      coverage: "best_effort_global_terrestrial_reception",
      service_level: "beta_no_sla",
    },
    fallback: {
      provider: "Fintraffic Digitraffic",
      configured: input.fallbackConfigured,
      current: fallbackCurrent,
      traffic_current: fallbackTrafficCurrent,
      last_state_at: isoTimestamp(fallbackStateAt),
      last_traffic_at: isoTimestamp(fallbackTrafficAt),
      error: input.fallbackError,
      coverage: "finland_and_nearby_baltic_reception",
      global: false,
    },
    retention: input.retention,
  };
}
