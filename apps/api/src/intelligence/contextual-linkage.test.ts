import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTransportActivityComparison,
  contextualLinkagePolicy,
  earthquakeContextEligibility,
  pendingEarthquakeContextRefreshDue,
  scoreContextualLinkage,
  transportContextRefreshMilestone,
} from "./contextual-linkage";

const quake = {
  eventType: "earthquake",
  observedAt: new Date("2026-08-14T21:58:21Z"),
  latitude: -8.3101,
  longitude: 121.3517,
  countryIso2: "ID",
  entityKeys: ["ende", "indonesia"],
  sourceReliability: 0.98,
};

test("materially significant moderate earthquakes qualify without opening every M5.5 event", () => {
  const yanglong = earthquakeContextEligibility({
    magnitude: 5.9,
    significance: 650,
    alertLevel: "yellow",
    felt: 18,
    severity: "medium",
  });
  assert.equal(yanglong.eligible, true);
  assert.equal(yanglong.tier, "significant_moderate");
  assert.ok(yanglong.reasons.includes("strong_moderate_magnitude"));
  assert.ok(yanglong.reasons.includes("usgs_significance_at_least_450"));

  assert.equal(earthquakeContextEligibility({
    magnitude: 5.5,
    significance: 120,
    felt: 0,
    alertLevel: "green",
    severity: "medium",
  }).eligible, false);
  assert.equal(earthquakeContextEligibility({
    magnitude: 5.5,
    significance: 480,
    severity: "medium",
  }).eligible, true);
  assert.equal(earthquakeContextEligibility({
    magnitude: 7.2,
    severity: "high",
  }).tier, "major");
});

test("pending transport context refresh is bounded to a fifteen-minute cadence", () => {
  const now = Date.parse("2026-08-19T03:00:00Z");
  assert.equal(pendingEarthquakeContextRefreshDue({ lastRunAt: 0, now }), true);
  assert.equal(pendingEarthquakeContextRefreshDue({ lastRunAt: now - 14 * 60_000, now }), false);
  assert.equal(pendingEarthquakeContextRefreshDue({ lastRunAt: now - 15 * 60_000, now }), true);
  assert.equal(transportContextRefreshMilestone({ elapsedHours: 1.2, windowHours: 0 }), 1);
  assert.equal(transportContextRefreshMilestone({ elapsedHours: 7, windowHours: 1 }), 6);
  assert.equal(transportContextRefreshMilestone({ elapsedHours: 26, windowHours: 7 }), 24);
  assert.equal(transportContextRefreshMilestone({ elapsedHours: 48, windowHours: 24 }), null);
  assert.equal(transportContextRefreshMilestone({
    elapsedHours: 20, windowHours: 6, maximumWindowHours: 19,
  }), 19);
  assert.equal(transportContextRefreshMilestone({
    elapsedHours: 24, windowHours: 19, maximumWindowHours: 19,
  }), null);
  assert.equal(transportContextRefreshMilestone({
    elapsedHours: 8, windowHours: 2, maximumWindowHours: 2,
  }), null);
});

test("context windows and radii scale from significant moderate to major earthquakes", () => {
  const moderateNews = contextualLinkagePolicy("earthquake", "news", {
    magnitude: 5.9, significance: 536, severity: "medium",
  });
  const moderateTransport = contextualLinkagePolicy("earthquake", "transport", {
    magnitude: 5.9, significance: 536, severity: "medium",
  });
  const majorNews = contextualLinkagePolicy("earthquake", "news", {
    magnitude: 7.7, significance: 900, severity: "high",
  });
  assert.ok(moderateNews);
  assert.ok(moderateTransport);
  assert.ok(majorNews);
  assert.ok(moderateNews.maxDistanceKm >= 400);
  assert.ok(moderateTransport.maxDistanceKm >= 350);
  assert.ok(moderateNews.maxDistanceKm < majorNews.maxDistanceKm);
  assert.ok(moderateNews.afterHours < majorNews.afterHours);
  assert.equal(moderateNews.contextTier, "significant_moderate");
  assert.equal(majorNews.contextTier, "major");
  assert.equal(contextualLinkagePolicy("earthquake", "news", {
    magnitude: 5.5, significance: 100, severity: "medium",
  }), null);
});

test("precisely located earthquake reporting links inside the governed window", () => {
  const result = scoreContextualLinkage({
    anchor: quake,
    signal: {
      eventType: "earthquake",
      observedAt: new Date("2026-08-15T01:00:00Z"),
      latitude: -8.45,
      longitude: 121.52,
      countryIso2: "ID",
      entityKeys: ["ende"],
      sourceReliability: 0.72,
    },
    domain: "news",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.factors.decision, "attached");
  assert.equal(result.factors.temporal_relation, "after");
  assert.ok(Number(result.factors.distance_km) < 30);
  assert.match(result.rationale, /does not establish/i);
});

test("nearby weather and transport are context even though their event families differ", () => {
  for (const domain of ["weather", "transport"] as const) {
    const result = scoreContextualLinkage({
      anchor: quake,
      signal: {
        eventType: domain === "weather" ? "weather_conditions" : "transport_activity_change",
        observedAt: new Date("2026-08-15T09:58:21Z"),
        latitude: -7.9,
        longitude: 121.1,
        countryIso2: "ID",
        sourceReliability: 0.78,
      },
      domain,
    });
    assert.equal(result.accepted, true, domain);
    assert.equal(result.factors.event_type, 0);
    assert.equal(result.factors.temporal_relation, "after");
  }
});

test("distant or late signals do not link to a major earthquake", () => {
  const distant = scoreContextualLinkage({
    anchor: quake,
    signal: {
      eventType: "earthquake", observedAt: new Date("2026-08-15T01:00:00Z"),
      latitude: -6.2, longitude: 106.8, countryIso2: "ID", sourceReliability: 0.8,
    },
    domain: "news",
  });
  const late = scoreContextualLinkage({
    anchor: quake,
    signal: {
      eventType: "earthquake", observedAt: new Date("2026-08-19T01:00:00Z"),
      latitude: -8.32, longitude: 121.36, countryIso2: "ID", sourceReliability: 0.8,
    },
    domain: "news",
  });
  assert.equal(distant.accepted, false);
  assert.equal(late.accepted, false);
});

test("unique same-country fallback is news-only and requires matching event semantics", () => {
  const countryOnly = {
    eventType: "earthquake",
    observedAt: new Date("2026-08-15T01:00:00Z"),
    countryIso2: "ID",
    sourceReliability: 0.75,
  };
  assert.equal(scoreContextualLinkage({
    anchor: quake, signal: countryOnly, domain: "news", uniqueCountryCandidate: true,
  }).accepted, true);
  assert.equal(scoreContextualLinkage({
    anchor: quake, signal: { ...countryOnly, eventType: "weather_conditions" },
    domain: "weather", uniqueCountryCandidate: true,
  }).accepted, false);
  assert.equal(scoreContextualLinkage({
    anchor: quake, signal: countryOnly, domain: "news", uniqueCountryCandidate: false,
  }).accepted, false);

  const nextDayFollowUp = scoreContextualLinkage({
    anchor: quake,
    signal: { ...countryOnly, observedAt: new Date("2026-08-16T09:58:21Z") },
    domain: "news",
    uniqueCountryCandidate: true,
  });
  assert.equal(nextDayFollowUp.accepted, true);
  assert.equal(nextDayFollowUp.factors.unique_major_event, 1);

  assert.equal(scoreContextualLinkage({
    anchor: quake,
    signal: { ...countryOnly, observedAt: new Date("2026-08-17T03:58:21Z") },
    domain: "news",
    uniqueCountryCandidate: true,
  }).accepted, false);
});

test("transport comparison distinguishes an observed shift from thin or absent coverage", () => {
  const lower = assessTransportActivityComparison({
    beforeEntities: 20, afterEntities: 9, beforeSamples: 180, afterSamples: 70, windowHours: 24,
  });
  assert.equal(lower.classification, "lower_activity_observed");
  assert.equal(lower.percentChange, -0.55);
  assert.match(lower.summary, /not proof/i);

  const thin = assessTransportActivityComparison({
    beforeEntities: 2, afterEntities: 1, beforeSamples: 4, afterSamples: 2, windowHours: 12,
  });
  assert.equal(thin.classification, "insufficient_comparable_coverage");

  const absent = assessTransportActivityComparison({
    beforeEntities: 0, afterEntities: 0, beforeSamples: 0, afterSamples: 0, windowHours: 24,
  });
  assert.equal(absent.classification, "no_nearby_coverage");
  assert.match(absent.summary, /cannot infer/i);
});
