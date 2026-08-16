import assert from "node:assert/strict";
import test from "node:test";
import { assessTransportActivityComparison, scoreContextualLinkage } from "./contextual-linkage";

const quake = {
  eventType: "earthquake",
  observedAt: new Date("2026-08-14T21:58:21Z"),
  latitude: -8.3101,
  longitude: 121.3517,
  countryIso2: "ID",
  entityKeys: ["ende", "indonesia"],
  sourceReliability: 0.98,
};

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
