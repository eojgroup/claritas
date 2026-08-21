export const MARITIME_SOURCE_DEFINITIONS = {
  aisstream: {
    provider: "AISstream",
    coverage: "Configured AISstream reception areas",
    license: "Provider terms",
    sourceUrl: "https://aisstream.io/",
    priority: 100,
  },
  digitraffic: {
    provider: "Fintraffic Digitraffic",
    coverage: "Finland and nearby Baltic reception",
    license: "CC BY 4.0",
    sourceUrl: "https://www.digitraffic.fi/en/marine-traffic/",
    priority: 400,
  },
  mpa_oceans_x: {
    provider: "Maritime and Port Authority of Singapore OCEANS-X",
    coverage: "Singapore port and nearby reception",
    license: "MPA OCEANS-X API Terms of Service",
    sourceUrl:
      "https://oceans-x.mpa.gov.sg/marketplace/apis/483131e5-a59d-4dce-901f-597e952e09c4/documents",
    priority: 410,
  },
  kystverket: {
    provider: "Norwegian Coastal Administration",
    coverage: "Norwegian coastal and offshore reception",
    license: "NLOD 2.0",
    sourceUrl:
      "https://www.kystverket.no/en/sea-transport-and-ports/ais/access-to-ais-data/",
    // The public socket is unauthenticated plaintext. It is useful for
    // diagnostics, but must lose exact-timestamp arbitration to TLS feeds.
    priority: 50,
  },
  barentswatch: {
    provider: "Norwegian Coastal Administration via BarentsWatch",
    coverage: "Norwegian EEZ, Svalbard, and Jan Mayen reception",
    license: "NLOD 2.0",
    sourceUrl: "https://developer.barentswatch.no/docs/AIS/live-ais-api/",
    priority: 430,
  },
} as const;

export type MaritimeSourceName = keyof typeof MARITIME_SOURCE_DEFINITIONS;
export type RegionalMaritimeSourceName = Exclude<
  MaritimeSourceName,
  "aisstream"
>;

/** Provider-scoped cache keys prevent one feed's static vessel metadata from
 * being emitted under another feed's source/license attribution. */
export function maritimeStaticCacheKey(
  sourceName: MaritimeSourceName,
  mmsi: string,
): string {
  return `${sourceName}:${mmsi}`;
}

export type MaritimeSnapshotCandidate = {
  observed_at: string;
  source_name: MaritimeSourceName;
};

function observedMilliseconds(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Vessel observations from multiple feeds share one persisted MMSI row. Newer
 * observations always win; exact timestamp ties use a stable source order so
 * arrival timing cannot change the result.
 */
export function shouldReplaceMaritimeSnapshot(
  candidate: MaritimeSnapshotCandidate,
  current: MaritimeSnapshotCandidate | null | undefined,
): boolean {
  const candidateObservedAt = observedMilliseconds(candidate.observed_at);
  if (candidateObservedAt == null) return false;
  if (!current) return true;
  const currentObservedAt = observedMilliseconds(current.observed_at);
  if (currentObservedAt == null) return true;
  if (candidateObservedAt !== currentObservedAt) {
    return candidateObservedAt > currentObservedAt;
  }
  return (
    MARITIME_SOURCE_DEFINITIONS[candidate.source_name].priority >=
    MARITIME_SOURCE_DEFINITIONS[current.source_name].priority
  );
}

export function shouldAcceptSampledMaritimeSnapshot(input: {
  candidate: MaritimeSnapshotCandidate;
  current: MaritimeSnapshotCandidate | null | undefined;
  now: number;
  lastQueuedAt: number | null | undefined;
  sampleMilliseconds: number;
}): boolean {
  if (!shouldReplaceMaritimeSnapshot(input.candidate, input.current)) {
    return false;
  }
  if (
    !input.current ||
    input.lastQueuedAt == null ||
    input.now - input.lastQueuedAt >= input.sampleMilliseconds
  ) {
    return true;
  }
  return (
    input.candidate.source_name !== input.current.source_name &&
    MARITIME_SOURCE_DEFINITIONS[input.candidate.source_name].priority >
      MARITIME_SOURCE_DEFINITIONS[input.current.source_name].priority
  );
}
