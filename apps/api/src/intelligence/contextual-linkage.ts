import { eventFamilyTypes, haversineDistanceKm } from "./correlation";
import type { CorrelationCandidate, IntelligenceDomain } from "./types";

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export function pendingEarthquakeContextRefreshDue(input: {
  lastRunAt: number;
  now: number;
  minimumIntervalMinutes?: number;
}) {
  const intervalMinutes = Math.min(60, Math.max(
    5,
    input.minimumIntervalMinutes ?? 15,
  ));
  return Number.isFinite(input.now)
    && (!Number.isFinite(input.lastRunAt)
      || input.lastRunAt <= 0
      || input.now - input.lastRunAt >= intervalMinutes * 60_000);
}

export function transportContextRefreshMilestone(input: {
  elapsedHours: number;
  windowHours: number;
  maximumWindowHours?: number;
}) {
  const elapsedHours = Math.max(0, Number(input.elapsedHours) || 0);
  const windowHours = Math.max(0, Number(input.windowHours) || 0);
  const maximumWindowHours = Math.min(24, Math.max(1, Number(input.maximumWindowHours) || 24));
  const milestones = Array.from(new Set([maximumWindowHours, 6, 1]
    .filter((milestone) => milestone <= maximumWindowHours)))
    .sort((left, right) => right - left);
  return milestones.find((milestone) => elapsedHours >= milestone && windowHours < milestone) ?? null;
}

export type ContextualLinkagePolicy = {
  beforeHours: number;
  afterHours: number;
  maxDistanceKm: number;
  threshold: number;
  contextTier?: EarthquakeContextTier;
  policyVersion?: "significant-earthquake-context-v2";
};

export type EarthquakeContextTier = "significant_moderate" | "major";

export type EarthquakeContextAttributes = {
  magnitude?: unknown;
  significance?: unknown;
  tsunami?: unknown;
  alertLevel?: unknown;
  felt?: unknown;
  severity?: unknown;
};

export type EarthquakeContextEligibility = {
  eligible: boolean;
  tier: EarthquakeContextTier | null;
  magnitude: number | null;
  significance: number | null;
  tsunami: boolean;
  alertLevel: string | null;
  felt: number | null;
  reasons: string[];
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

const EARTHQUAKE_CONTEXT_POLICY_RANGES: Partial<Record<IntelligenceDomain, {
  minimum: ContextualLinkagePolicy;
  maximum: ContextualLinkagePolicy;
}>> = {
  news: {
    minimum: { beforeHours: 6, afterHours: 48, maxDistanceKm: 350, threshold: 0.44 },
    maximum: { beforeHours: 6, afterHours: 72, maxDistanceKm: 650, threshold: 0.44 },
  },
  weather: {
    minimum: { beforeHours: 12, afterHours: 36, maxDistanceKm: 200, threshold: 0.42 },
    maximum: { beforeHours: 12, afterHours: 48, maxDistanceKm: 350, threshold: 0.42 },
  },
  transport: {
    minimum: { beforeHours: 18, afterHours: 48, maxDistanceKm: 300, threshold: 0.42 },
    maximum: { beforeHours: 24, afterHours: 72, maxDistanceKm: 600, threshold: 0.42 },
  },
  podcast: {
    minimum: { beforeHours: 24, afterHours: 120, maxDistanceKm: 350, threshold: 0.48 },
    maximum: { beforeHours: 24, afterHours: 168, maxDistanceKm: 650, threshold: 0.48 },
  },
};

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

/**
 * Selects earthquakes that merit cross-signal investigation without turning
 * every routine seismic observation into an expanded incident. M7+ events
 * remain eligible, while M5.5-M6.9 events require a materiality indicator.
 * M5.8+ is itself treated as a strong-moderate indicator because those events
 * can be widely felt even when PAGER/significance fields arrive later.
 */
export function earthquakeContextEligibility(
  attributes: EarthquakeContextAttributes,
): EarthquakeContextEligibility {
  const magnitude = finiteNumber(attributes.magnitude);
  const significance = finiteNumber(attributes.significance);
  const felt = finiteNumber(attributes.felt);
  const tsunami = normalizedBoolean(attributes.tsunami);
  const alertValue = String(attributes.alertLevel ?? "").trim().toLowerCase();
  const alertLevel = ["green", "yellow", "orange", "red"].includes(alertValue)
    ? alertValue : null;
  const severity = String(attributes.severity ?? "").trim().toLowerCase();
  const major = (magnitude != null && magnitude >= 7)
    || ["high", "critical"].includes(severity)
    || alertLevel === "orange" || alertLevel === "red";
  const moderateMagnitude = magnitude != null && magnitude >= 5.5;
  const reasons = [
    magnitude != null && magnitude >= 7 ? "magnitude_at_least_7" : null,
    moderateMagnitude && magnitude! >= 5.8 ? "strong_moderate_magnitude" : null,
    significance != null && significance >= 450 ? "usgs_significance_at_least_450" : null,
    tsunami ? "source_tsunami_flag" : null,
    alertLevel ? `pager_alert_${alertLevel}` : null,
    felt != null && felt >= 10 ? "felt_reports_at_least_10" : null,
    ["high", "critical"].includes(severity) ? `canonical_severity_${severity}` : null,
  ].filter((value): value is string => Boolean(value));
  const materiallySignificantModerate = moderateMagnitude && (
    magnitude! >= 5.8
    || (significance != null && significance >= 450)
    || tsunami
    || alertLevel === "yellow"
    || alertLevel === "orange"
    || alertLevel === "red"
    || (felt != null && felt >= 10)
  );
  const eligible = major || materiallySignificantModerate;
  return {
    eligible,
    tier: eligible ? major ? "major" : "significant_moderate" : null,
    magnitude,
    significance,
    tsunami,
    alertLevel,
    felt,
    reasons,
  };
}

const lerp = (minimum: number, maximum: number, ratio: number) =>
  minimum + (maximum - minimum) * ratio;

function scaledEarthquakeContextPolicy(
  domain: IntelligenceDomain,
  eligibility: EarthquakeContextEligibility,
) {
  const range = EARTHQUAKE_CONTEXT_POLICY_RANGES[domain];
  if (!range || !eligibility.eligible || !eligibility.tier) return null;
  const magnitudeRatio = eligibility.tier === "major"
    ? 1
    : clamp(((eligibility.magnitude ?? 5.5) - 5.5) / 1.5);
  return {
    beforeHours: Number(lerp(range.minimum.beforeHours, range.maximum.beforeHours, magnitudeRatio).toFixed(2)),
    afterHours: Number(lerp(range.minimum.afterHours, range.maximum.afterHours, magnitudeRatio).toFixed(2)),
    maxDistanceKm: Math.round(lerp(range.minimum.maxDistanceKm, range.maximum.maxDistanceKm, magnitudeRatio)),
    threshold: range.maximum.threshold,
    contextTier: eligibility.tier,
    policyVersion: "significant-earthquake-context-v2" as const,
  };
}

/**
 * Cross-domain context is deliberately narrower than canonical event merging.
 * A precisely located earthquake must also pass `earthquakeContextEligibility`.
 * Supplying no attributes returns the maximum search envelope; callers must
 * then apply the per-candidate eligibility/policy before attaching anything.
 * The linked signal remains independently labelled and never becomes proof of
 * damage, disruption, or causation.
 */
export function contextualLinkagePolicy(
  anchorEventType: string,
  domain: IntelligenceDomain,
  attributes?: EarthquakeContextAttributes,
): ContextualLinkagePolicy | null {
  if (eventFamilyTypes(anchorEventType)[0] !== "earthquake") return null;
  const range = EARTHQUAKE_CONTEXT_POLICY_RANGES[domain];
  if (!range) return null;
  if (attributes === undefined) {
    return {
      ...range.maximum,
      contextTier: "major",
      policyVersion: "significant-earthquake-context-v2",
    };
  }
  return scaledEarthquakeContextPolicy(domain, earthquakeContextEligibility(attributes));
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
  // Significant-event follow-up reporting often arrives the next publication day.
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
  // in the same event family, close in time, and has exactly one eligible event
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
    uniqueCountryNewsFallback ? "the only eligible same-family event in the country and time window" : null,
  ].filter((value): value is string => Boolean(value));
  const timing = deltaHours < -1 / 60
    ? `${hourLabel(Math.abs(deltaHours))} before the event`
    : deltaHours > 1 / 60
      ? `${hourLabel(deltaHours)} after the event`
      : hourLabel(0);
  const rationale = accepted
    ? `Included as contextual ${input.domain} evidence because it was observed ${timing} and matched ${supports.join(" and ")}. This association does not establish that the earthquake caused the signal, that the signal confirms impact, or that the sources describe the same phenomenon.`
    : `Not attached: the ${input.domain} signal did not meet the governed time/space/entity threshold for this eligible earthquake.`;

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
      earthquake_context_tier: policy.contextTier ?? null,
      unique_country_candidate: input.uniqueCountryCandidate === true,
      unique_eligible_event: uniqueMajorEvent,
      // Retained for readers of v1 audit records.
      unique_major_event: uniqueMajorEvent,
      rationale,
      causality_notice: "Contextual association only; no causal relationship or impact confirmation is asserted.",
      methodology: policy.policyVersion ?? "significant-earthquake-context-v2",
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
