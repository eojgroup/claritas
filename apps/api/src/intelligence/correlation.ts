import { createHash } from "crypto";
import type { CorrelationCandidate, CorrelationScore, IntelligenceSeverity } from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function resolveSignalCoordinates(input: {
  latitude?: number | null;
  longitude?: number | null;
  coordinatesAreExact?: boolean;
  locationType?: string | null;
}) {
  const latitude = input.latitude;
  const longitude = input.longitude;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  // Catalogued country coordinates are overview/navigation centroids. They
  // are never a spatial correlation anchor or an automatic observation AOI.
  if (input.locationType === "country" && input.coordinatesAreExact !== true) return null;
  return { latitude, longitude };
}

const EVENT_FAMILIES: readonly (readonly string[])[] = [
  ["wildfire"],
  ["earthquake"],
  ["flood"],
  ["severe_storm"],
  ["agricultural_stress"],
  ["transport_disruption", "aviation_disruption"],
  ["security_incident"],
  ["market_move"],
  ["reported_development"],
] as const;

export function eventFamilyTypes(eventType: string): string[] {
  const normalized = eventType.trim().toLowerCase();
  const family = EVENT_FAMILIES.find((members) => members.includes(normalized));
  return family ? [...family] : [normalized];
}

export type ScoredCorrelationCandidate<T extends CorrelationCandidate> = {
  candidate: T;
  correlation: CorrelationScore;
};

export function selectCorrelationOutcome<T extends CorrelationCandidate>(
  ranked: ScoredCorrelationCandidate<T>[],
) {
  const strongest = ranked[0] ?? null;
  const accepted = ranked.find((entry) => entry.correlation.accepted) ?? null;
  return {
    strongest,
    accepted,
    // Audit fields must all describe the event that was actually selected. A
    // higher-scoring near miss can lack the required anchor and is therefore
    // not the subject of an attach decision.
    decisionSubject: accepted ?? strongest,
  };
}

/**
 * Keeps "related" deliberately weaker than canonical correlation, while still
 * requiring a concrete place, spatial, or entity anchor. Time, event family,
 * and country alone never create a graph edge.
 */
export function qualifiedRelatedCorrelationCandidates<T extends CorrelationCandidate & { id: string }>(
  ranked: ScoredCorrelationCandidate<T>[],
  selectedEventId: string,
  threshold: number,
  limit = 3,
) {
  const minimumScore = Math.max(0.45, clamp(threshold) - 0.1);
  return ranked
    .filter(({ candidate, correlation }) => {
      const { location, spatial, entity } = correlation.components;
      return candidate.id !== selectedEventId
        && correlation.score >= minimumScore
        && (location === 1 || spatial >= 0.25 || entity >= 0.25);
    })
    .slice(0, Math.max(0, Math.min(10, Math.trunc(limit))));
}

export function shouldReplaceCanonicalSignal(input: {
  eventExists: boolean;
  existingCanonicalEvidenceKey: unknown;
  existingCanonicalRank: number;
  incomingEvidenceKey: string;
  incomingCanonicalRank: number;
}) {
  if (!input.eventExists) return true;
  const sameCanonicalProvenance = typeof input.existingCanonicalEvidenceKey === "string"
    && input.existingCanonicalEvidenceKey === input.incomingEvidenceKey;
  return sameCanonicalProvenance
    || input.incomingCanonicalRank > input.existingCanonicalRank + 0.02;
}

/**
 * Ranks already-bounded database candidates. The acceptance rule in
 * scoreCorrelation deliberately requires a location, spatial, or entity
 * anchor, so country and time alone can never merge broad generic stories.
 */
export function rankCorrelationCandidates<T extends CorrelationCandidate>(
  signal: CorrelationCandidate,
  candidates: T[],
  options: { maxHours?: number; maxDistanceKm?: number; threshold?: number } = {},
): ScoredCorrelationCandidate<T>[] {
  return candidates
    .map((candidate) => ({ candidate, correlation: scoreCorrelation(signal, candidate, options) }))
    .sort((left, right) => right.correlation.score - left.correlation.score);
}

export function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(latitudeB - latitudeA);
  const dLon = radians(longitudeB - longitudeA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(dLon / 2) ** 2;
  return 6_371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreCorrelation(
  left: CorrelationCandidate,
  right: CorrelationCandidate,
  options: { maxHours?: number; maxDistanceKm?: number; threshold?: number } = {},
): CorrelationScore {
  const maxHours = Math.max(1, options.maxHours ?? 72);
  const maxDistanceKm = Math.max(1, options.maxDistanceKm ?? 250);
  const threshold = clamp(options.threshold ?? 0.62);
  const hours = Math.abs(left.observedAt.getTime() - right.observedAt.getTime()) / 3_600_000;
  const temporal = clamp(1 - hours / maxHours);
  const hasCoordinates = [left.latitude, left.longitude, right.latitude, right.longitude]
    .every((value) => Number.isFinite(value));
  const distanceKm = hasCoordinates
    ? haversineDistanceKm(
        left.latitude as number,
        left.longitude as number,
        right.latitude as number,
        right.longitude as number,
      )
    : null;
  const spatial = distanceKm === null ? 0 : clamp(1 - distanceKm / maxDistanceKm);
  const location = left.locationId && right.locationId && left.locationId === right.locationId ? 1 : 0;
  const country = left.countryIso2 && right.countryIso2
    && left.countryIso2.toUpperCase() === right.countryIso2.toUpperCase() ? 1 : 0;
  const leftEntities = new Set((left.entityKeys ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
  const rightEntities = new Set((right.entityKeys ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
  const union = new Set([...leftEntities, ...rightEntities]);
  const shared = [...leftEntities].filter((value) => rightEntities.has(value)).length;
  const entity = union.size ? shared / union.size : 0;
  const eventType = eventFamilyTypes(left.eventType)[0] === eventFamilyTypes(right.eventType)[0] ? 1 : 0;
  const sourceReliability = clamp(((left.sourceReliability ?? 0.7) + (right.sourceReliability ?? 0.7)) / 2);

  const components = {
    temporal,
    spatial,
    location,
    country,
    entity,
    event_type: eventType,
    source_reliability: sourceReliability,
  };
  const score = clamp(
    temporal * 0.18
      + spatial * 0.18
      + location * 0.22
      + country * 0.08
      + entity * 0.12
      + eventType * 0.15
      + sourceReliability * 0.07,
  );
  return {
    score: Number(score.toFixed(4)),
    accepted: score >= threshold && (location === 1 || spatial >= 0.45 || entity >= 0.5),
    components,
    methodology: `weighted-v1; max_hours=${maxHours}; max_distance_km=${maxDistanceKm}; threshold=${threshold}`,
  };
}

export function buildEventDedupeKey(parts: Array<string | number | null | undefined>): string {
  const normalized = parts
    .filter((part): part is string | number => part !== null && typeof part !== "undefined")
    .map((part) => String(part).trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

export function buildAlertDedupeKey(eventId: string, activity: Date): string {
  return `${eventId}:${activity.toISOString().slice(0, 13)}`;
}

export function evaluateMarketMove(current: number, previous: number, threshold = 0.05) {
  const safeThreshold = Math.max(0.001, Math.abs(threshold));
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  const change = (current - previous) / Math.abs(previous);
  if (Math.abs(change) < safeThreshold) return null;
  return {
    change,
    magnitude: clamp(Math.abs(change) / safeThreshold),
    severity: (Math.abs(change) >= 0.12 ? "high" : "medium") as IntelligenceSeverity,
  };
}

export function severityRank(severity: IntelligenceSeverity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

export function maxSeverity(
  left: IntelligenceSeverity,
  right: IntelligenceSeverity,
): IntelligenceSeverity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

export function computeSignalPriority(input: {
  sourceReliability: number;
  sourceDiversity: number;
  freshnessHours: number;
  severity: IntelligenceSeverity;
  locationImportance: number;
  domainCount: number;
  physicalObservationAvailable?: boolean;
  anomalyMagnitude?: number;
}) {
  const freshness = clamp(1 - Math.max(0, input.freshnessHours) / 168);
  const severity = severityRank(input.severity) / 4;
  const sourceDiversity = clamp(input.sourceDiversity / 5);
  const domainDiversity = clamp(input.domainCount / 5);
  const physicalObservation = input.physicalObservationAvailable ? 1 : 0;
  const anomaly = clamp(input.anomalyMagnitude ?? 0);
  const components = {
    source_reliability: clamp(input.sourceReliability),
    source_diversity: sourceDiversity,
    freshness,
    severity,
    location_importance: clamp(input.locationImportance),
    domain_diversity: domainDiversity,
    physical_observation: physicalObservation,
    anomaly,
  };
  const score = components.source_reliability * 0.14
    + components.source_diversity * 0.12
    + components.freshness * 0.14
    + components.severity * 0.18
    + components.location_importance * 0.12
    + components.domain_diversity * 0.16
    + components.physical_observation * 0.08
    + components.anomaly * 0.06;
  return { score: Number(clamp(score).toFixed(4)), components, methodology: "signal-priority-v1" };
}
