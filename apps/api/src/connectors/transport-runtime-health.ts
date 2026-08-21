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

export type TransportRegionalRuntimeHealthInput = {
  id: string;
  provider: string;
  configured: boolean;
  /**
   * Some regional feeds can be connected for diagnostics without being
   * suitable for release readiness. Callers must make that trust decision
   * explicitly so a newly added transport cannot silently become a fallback.
   */
  readinessEligible: boolean;
  transport?: string;
  lastRefreshAt: number | null;
  lastSnapshotAt: number | null;
  lastStoredAt: number | null;
  error: boolean;
  coverage: string;
  license?: string | null;
  global?: boolean;
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
  regionalSources: TransportRegionalRuntimeHealthInput[];
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
  const primaryTrafficCurrent =
    input.primaryConfigured &&
    isCurrent(input.now, primaryTrafficAt, input.freshnessMilliseconds);
  const regionalSources = input.regionalSources.map((source) => {
    const readinessEligible = source.readinessEligible;
    const stateAt = mostRecent(
      source.lastRefreshAt,
      source.lastSnapshotAt,
      source.lastStoredAt,
    );
    const trafficAt = mostRecent(source.lastSnapshotAt, source.lastStoredAt);
    return {
      id: source.id,
      provider: source.provider,
      transport: source.transport ?? null,
      configured: source.configured,
      readiness_eligible: readinessEligible,
      current:
        source.configured &&
        readinessEligible &&
        !source.error &&
        isCurrent(input.now, stateAt, input.freshnessMilliseconds),
      traffic_current:
        source.configured &&
        isCurrent(input.now, trafficAt, input.freshnessMilliseconds),
      last_state_at: isoTimestamp(stateAt),
      last_traffic_at: isoTimestamp(trafficAt),
      error: source.error,
      coverage: source.coverage,
      license: source.license ?? null,
      global: source.global ?? false,
    };
  });
  const regionalCurrent = regionalSources.some((source) => source.current);
  const configuredRegionalSources = regionalSources.filter(
    (source) => source.configured && source.readiness_eligible,
  );
  const configuredOrFirstRegionalSource =
    configuredRegionalSources.length === 1
      ? configuredRegionalSources[0]
      : regionalSources[0];
  const configuredRegionalInputs = input.regionalSources.filter(
    (source) => source.configured && source.readinessEligible,
  );
  const fallbackStateAt = mostRecent(
    ...configuredRegionalInputs.map((source) =>
      mostRecent(source.lastRefreshAt, source.lastSnapshotAt, source.lastStoredAt),
    ),
  );
  const fallbackTrafficAt = mostRecent(
    ...configuredRegionalInputs.map((source) =>
      mostRecent(source.lastSnapshotAt, source.lastStoredAt),
    ),
  );
  const fallbackConfigured = configuredRegionalSources.length > 0;
  const fallbackTrafficCurrent = configuredRegionalSources.some(
    (source) => source.traffic_current,
  );
  const fallbackError =
    configuredRegionalSources.length > 0 &&
    configuredRegionalSources.every((source) => source.error);

  const state = !input.workerStarted
    ? "not_started"
    : !input.workerLeader
      ? "standby"
      : primaryCurrent
        ? "live_primary"
        : regionalCurrent
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
      provider:
        configuredRegionalSources.length > 1
          ? "Official regional AIS providers"
          : configuredOrFirstRegionalSource?.provider ?? "Official regional AIS providers",
      configured: fallbackConfigured,
      current: regionalCurrent,
      traffic_current: fallbackTrafficCurrent,
      last_state_at: isoTimestamp(fallbackStateAt),
      last_traffic_at: isoTimestamp(fallbackTrafficAt),
      error: fallbackError,
      coverage:
        configuredRegionalSources.length === 1
          ? configuredRegionalSources[0].coverage
          : configuredRegionalSources.length > 1
            ? "official_regional_reception_only"
            : configuredOrFirstRegionalSource?.coverage ?? "regional_reception_only",
      global: false,
    },
    regional_sources: regionalSources,
    retention: input.retention,
  };
}
