import { eventFamilyTypes, haversineDistanceKm } from "./correlation";
import type { CorrelationCandidate, IntelligenceDomain } from "./types";

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export type ContextualLinkagePolicy = {
  beforeHours: number;
  afterHours: number;
  maxDistanceKm: number;
  threshold: number;
};

export type ContextualLinkageResult = {
  accepted: boolean;
  score: number;
  factors: Record<string, unknown> & {
    decision: "attached" | "rejected";
    association_type: "contextual";
    signal_domain: IntelligenceDomain;
    temporal: number;
    spatial: number;
    location: number;
    country: number;
    entity: number;
    event_type: number;
    source_reliability: number;
  };
  rationale: string;
};

const EARTHQUAKE_CONTEXT_POLICIES: Partial<Record<IntelligenceDomain, ContextualLinkagePolicy>> = {
  news: { beforeHours: 6, afterHours: 72, maxDistanceKm: 450, threshold: 0.44 },
  weather: { beforeHours: 12, afterHours: 48, maxDistanceKm: 250, threshold: 0.42 },
  transport: { beforeHours: 24, afterHours: 72, maxDistanceKm: 450, threshold: 0.42 },
  podcast: { beforeHours: 24, afterHours: 168, maxDistanceKm: 450, threshold: 0.48 },
};

/**
 * Cross-domain context is deliberately narrower than canonical event merging.
 * For now only a major, precisely located earthquake opens these windows. The
 * linked signal remains independently labelled and never becomes proof of
 * damage, disruption, or causation.
 */
export function contextualLinkagePolicy(
  anchorEventType: string,
  domain: IntelligenceDomain,
): ContextualLinkagePolicy | null {
  return eventFamilyTypes(anchorEventType)[0] === "earthquake"
    ? EARTHQUAKE_CONTEXT_POLICIES[domain] ?? null
    : null;
}

function normalizedEntities(values: string[] | undefined) {
  return new Set((values ?? [])
    .map((value) => value.trim().toLocaleLowerCase().replace(/\s+/g, " "))
    .filter(Boolean));
}

function entityOverlap(left: string[] | undefined, right: string[] | undefined) {
  const leftSet = normalizedEntities(left);
  const rightSet = normalizedEntities(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  const shared = [...leftSet].filter((value) => rightSet.has(value)).length;
  return shared / union.size;
}

function finiteCoordinates(candidate: CorrelationCandidate) {
  return typeof candidate.latitude === "number" && Number.isFinite(candidate.latitude)
    && typeof candidate.longitude === "number" && Number.isFinite(candidate.longitude);
}

function hourLabel(value: number) {
  if (value < 1 / 60) return "at effectively the same time";
  const rounded = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} hours`;
}

export function scoreContextualLinkage(input: {
  anchor: CorrelationCandidate;
  signal: CorrelationCandidate;
  domain: IntelligenceDomain;
  policy?: ContextualLinkagePolicy;
  uniqueCountryCandidate?: boolean;
}): ContextualLinkageResult {
  const policy = input.policy ?? contextualLinkagePolicy(input.anchor.eventType, input.domain);
  if (!policy) {
    const rationale = "No governed cross-domain context policy exists for this event family and signal domain.";
    return {
      accepted: false,
      score: 0,
      factors: {
        decision: "rejected", association_type: "contextual", signal_domain: input.domain,
        temporal: 0, spatial: 0, location: 0, country: 0, entity: 0,
        event_type: 0, source_reliability: 0,
        rationale,
        causality_notice: "No causal relationship was assessed.",
      },
      rationale,
    };
  }

  const deltaHours = (input.signal.observedAt.getTime() - input.anchor.observedAt.getTime()) / 3_600_000;
  const timeWithinWindow = deltaHours >= -policy.beforeHours && deltaHours <= policy.afterHours;
  const applicableWindow = deltaHours < 0 ? policy.beforeHours : policy.afterHours;
  const temporal = timeWithinWindow
    ? clamp(1 - Math.abs(deltaHours) / Math.max(1, applicableWindow))
    : 0;
  const hasCoordinates = finiteCoordinates(input.anchor) && finiteCoordinates(input.signal);
  const distanceKm = hasCoordinates
    ? haversineDistanceKm(
        input.anchor.latitude as number,
        input.anchor.longitude as number,
        input.signal.latitude as number,
        input.signal.longitude as number,
      )
    : null;
  // Leave a visible, non-zero spatial factor at the governed boundary so the
  // UI can explain why a bounded nearby sample was included.
  const spatial = distanceKm == null
    ? 0
    : clamp(1 - distanceKm / (policy.maxDistanceKm * 1.25));
  const withinDistance = distanceKm != null && distanceKm <= policy.maxDistanceKm;
  const location = input.anchor.locationId && input.signal.locationId
    && input.anchor.locationId === input.signal.locationId ? 1 : 0;
  const country = input.anchor.countryIso2 && input.signal.countryIso2
    && input.anchor.countryIso2.toUpperCase() === input.signal.countryIso2.toUpperCase() ? 1 : 0;
  const entity = entityOverlap(input.anchor.entityKeys, input.signal.entityKeys);
  const sameFamily = eventFamilyTypes(input.anchor.eventType)[0]
    === eventFamilyTypes(input.signal.eventType)[0] ? 1 : 0;
  const sourceReliability = clamp(input.signal.sourceReliability ?? 0.7);
  // Major-event follow-up reporting often arrives the next publication day.
  // Give the narrowly governed, unambiguous same-country seismic fallback an
  // explicit score component for up to 48 hours; country coincidence by
  // itself still contributes nothing and weather/transport remain excluded.
  const uniqueCountryNewsFallback = input.domain === "news"
    && country === 1
    && sameFamily === 1
    && input.uniqueCountryCandidate === true
    && deltaHours >= -policy.beforeHours
    && deltaHours <= Math.min(policy.afterHours, 48);
  const uniqueMajorEvent = uniqueCountryNewsFallback ? 1 : 0;

  const score = clamp(
    temporal * 0.22
      + spatial * 0.30
      + location * 0.14
      + country * 0.08
      + entity * 0.12
      + sameFamily * 0.08
      + uniqueMajorEvent * 0.12
      + sourceReliability * 0.06,
  );
  const concreteAnchor = withinDistance || location === 1 || entity >= 0.25;
  // A country-only fallback is allowed only for reporting that is explicitly
  // in the same event family, close in time, and has exactly one major event
  // candidate in that country/window. It is never available to weather or
  // transport signals and therefore cannot turn national conditions into an
  // asserted earthquake impact.
  const anchoredThresholdPassed = concreteAnchor && score >= policy.threshold;
  const uniqueCountryThresholdPassed = uniqueCountryNewsFallback
    && score >= Math.max(0.35, policy.threshold - 0.08);
  const accepted = timeWithinWindow
    && (anchoredThresholdPassed || uniqueCountryThresholdPassed);

  const relation = deltaHours < -1 / 60 ? "before" : deltaHours > 1 / 60 ? "after" : "same_time";
  const supports = [
    withinDistance && distanceKm != null
      ? `${Math.round(distanceKm)} km spatial separation (maximum ${policy.maxDistanceKm} km)`
      : null,
    location === 1 ? "the same specific mapped location" : null,
    entity >= 0.25 ? "shared named-place or entity anchors" : null,
    uniqueCountryNewsFallback ? "the only major same-family event in the country and time window" : null,
  ].filter((value): value is string => Boolean(value));
  const timing = deltaHours < -1 / 60
    ? `${hourLabel(Math.abs(deltaHours))} before the event`
    : deltaHours > 1 / 60
      ? `${hourLabel(deltaHours)} after the event`
      : hourLabel(0);
  const rationale = accepted
    ? `Included as contextual ${input.domain} evidence because it was observed ${timing} and matched ${supports.join(" and ")}. This association does not establish that the earthquake caused the signal, that the signal confirms impact, or that the sources describe the same phenomenon.`
    : `Not attached: the ${input.domain} signal did not meet the governed time/space/entity threshold for this major event.`;

  return {
    accepted,
    score: Number(score.toFixed(4)),
    factors: {
      decision: accepted ? "attached" : "rejected",
      association_type: "contextual",
      signal_domain: input.domain,
      temporal: Number(temporal.toFixed(4)),
      spatial: Number(spatial.toFixed(4)),
      location,
      country,
      entity: Number(entity.toFixed(4)),
      event_type: sameFamily,
      source_reliability: Number(sourceReliability.toFixed(4)),
      temporal_relation: relation,
      time_delta_hours: Number(deltaHours.toFixed(3)),
      window_before_hours: policy.beforeHours,
      window_after_hours: policy.afterHours,
      distance_km: distanceKm == null ? null : Number(distanceKm.toFixed(2)),
      max_distance_km: policy.maxDistanceKm,
      unique_country_candidate: input.uniqueCountryCandidate === true,
      unique_major_event: uniqueMajorEvent,
      rationale,
      causality_notice: "Contextual association only; no causal relationship or impact confirmation is asserted.",
      methodology: "major-event-context-v1",
    },
    rationale,
  };
}

export function assessTransportActivityComparison(input: {
  beforeEntities: number;
  afterEntities: number;
  beforeSamples: number;
  afterSamples: number;
  windowHours: number;
}) {
  const beforeEntities = Math.max(0, Math.trunc(input.beforeEntities));
  const afterEntities = Math.max(0, Math.trunc(input.afterEntities));
  const beforeSamples = Math.max(0, Math.trunc(input.beforeSamples));
  const afterSamples = Math.max(0, Math.trunc(input.afterSamples));
  const windowHours = Math.max(0, input.windowHours);
  const coverageEntities = beforeEntities + afterEntities;
  const confidence = coverageEntities >= 20 ? 0.8
    : coverageEntities >= 5 ? 0.65
      : coverageEntities > 0 ? 0.5 : 0.35;
  const percentChange = beforeEntities > 0
    ? (afterEntities - beforeEntities) / beforeEntities
    : null;
  const isComparable = beforeEntities >= 5 && afterEntities >= 1;
  const materialChange = isComparable && percentChange != null && Math.abs(percentChange) >= 0.3;
  const classification = coverageEntities === 0
    ? "no_nearby_coverage"
    : !isComparable
      ? "insufficient_comparable_coverage"
      : materialChange
        ? percentChange! < 0 ? "lower_activity_observed" : "higher_activity_observed"
        : "no_material_change_detected";
  const formattedWindow = windowHours < 10 ? windowHours.toFixed(1) : Math.round(windowHours).toString();
  let summary: string;
  if (classification === "no_nearby_coverage") {
    summary = `No transport track points were available near the event in the ${formattedWindow}-hour before/after comparison. Claritas therefore cannot infer whether activity changed.`;
  } else if (classification === "insufficient_comparable_coverage") {
    summary = `Nearby transport telemetry covered ${beforeEntities} tracked entities before and ${afterEntities} after the event, but the baseline is too small for a reliable change assessment.`;
  } else if (classification === "no_material_change_detected") {
    summary = `Nearby transport telemetry covered ${beforeEntities} tracked entities before and ${afterEntities} after the event; no change of at least 30% was detected in this bounded comparison.`;
  } else {
    summary = `Nearby tracked-entity activity was ${Math.abs(percentChange! * 100).toFixed(0)}% ${percentChange! < 0 ? "lower" : "higher"} after the event (${beforeEntities} before; ${afterEntities} after). This is an observed association in Claritas telemetry, not proof that the earthquake caused the change.`;
  }
  return {
    beforeEntities,
    afterEntities,
    beforeSamples,
    afterSamples,
    windowHours: Number(windowHours.toFixed(2)),
    percentChange: percentChange == null ? null : Number(percentChange.toFixed(4)),
    classification,
    confidence,
    summary,
    methodology: "symmetric-event-area-transport-v1",
  };
}
