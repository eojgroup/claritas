import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAlertDedupeKey,
  buildEventDedupeKey,
  computeSignalPriority,
  evaluateMarketMove,
  haversineDistanceKm,
  scoreCorrelation,
} from "./correlation";

test("event dedupe keys are deterministic and normalized", () => {
  assert.equal(
    buildEventDedupeKey(["Earthquake", " USGS-123 ", "2026-08-11"]),
    buildEventDedupeKey(["earthquake", "usgs-123", "2026-08-11"]),
  );
  assert.notEqual(buildEventDedupeKey(["earthquake", "a"]), buildEventDedupeKey(["earthquake", "b"]));
});

test("correlation requires a defensible spatial, location, or entity anchor", () => {
  const base = { eventType: "wildfire", observedAt: new Date("2026-08-11T12:00:00Z") };
  const strong = scoreCorrelation(
    { ...base, latitude: 25, longitude: 55, locationId: "asset-1", countryIso2: "AE" },
    { ...base, observedAt: new Date("2026-08-11T13:00:00Z"), latitude: 25.03, longitude: 55.02, locationId: "asset-1", countryIso2: "AE" },
  );
  const unanchored = scoreCorrelation(base, { ...base, observedAt: new Date("2026-08-11T13:00:00Z") });
  assert.equal(strong.accepted, true);
  assert.ok(strong.score > unanchored.score);
  assert.equal(unanchored.accepted, false);
  assert.ok(haversineDistanceKm(25, 55, 25.03, 55.02) < 5);
});

test("signal priority exposes deterministic score components", () => {
  const priority = computeSignalPriority({
    sourceReliability: 0.95,
    sourceDiversity: 4,
    freshnessHours: 1,
    severity: "critical",
    locationImportance: 1,
    domainCount: 4,
    physicalObservationAvailable: true,
    anomalyMagnitude: 0.8,
  });
  assert.ok(priority.score > 0.8);
  assert.equal(priority.methodology, "signal-priority-v1");
  assert.equal(priority.components.physical_observation, 1);
});

test("alert candidates dedupe within an activity hour and separate later updates", () => {
  const eventId = "38f27f92-4257-4f28-abf6-913f85d71416";
  assert.equal(
    buildAlertDedupeKey(eventId, new Date("2026-08-11T12:04:00Z")),
    buildAlertDedupeKey(eventId, new Date("2026-08-11T12:59:59Z")),
  );
  assert.notEqual(
    buildAlertDedupeKey(eventId, new Date("2026-08-11T12:59:59Z")),
    buildAlertDedupeKey(eventId, new Date("2026-08-11T13:00:00Z")),
  );
});

test("market movements emit only above the governed threshold", () => {
  assert.equal(evaluateMarketMove(103, 100, 0.05), null);
  assert.equal(evaluateMarketMove(105, 100, 0.05)?.severity, "medium");
  assert.equal(evaluateMarketMove(112, 100, 0.05)?.severity, "high");
  assert.equal(evaluateMarketMove(1, 0, 0.05), null);
});
