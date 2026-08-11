import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAlertDedupeKey,
  buildEventDedupeKey,
  computeSignalPriority,
  eventFamilyTypes,
  evaluateMarketMove,
  haversineDistanceKm,
  qualifiedRelatedCorrelationCandidates,
  rankCorrelationCandidates,
  resolveSignalCoordinates,
  scoreCorrelation,
  selectCorrelationOutcome,
  shouldReplaceCanonicalSignal,
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

test("cross-domain signals at one specific location converge within an event family", () => {
  const signal = {
    eventType: "transport_disruption",
    observedAt: new Date("2026-08-11T12:00:00Z"),
    locationId: "port-singapore",
    countryIso2: "SG",
    latitude: 1.264,
    longitude: 103.84,
    sourceReliability: 0.82,
  };
  const ranked = rankCorrelationCandidates(signal, [{
    eventType: "aviation_disruption",
    observedAt: new Date("2026-08-11T14:00:00Z"),
    locationId: "port-singapore",
    countryIso2: "SG",
    latitude: 1.27,
    longitude: 103.85,
    sourceReliability: 0.9,
  }], { threshold: 0.58, maxHours: 96, maxDistanceKm: 100 });
  assert.deepEqual(eventFamilyTypes("aviation_disruption"), ["transport_disruption", "aviation_disruption"]);
  assert.equal(ranked[0].correlation.accepted, true);
  assert.equal(ranked[0].correlation.components.event_type, 1);
  assert.equal(ranked[0].correlation.components.location, 1);
});

test("same-country generic news does not merge without a specific location or entity anchor", () => {
  const observedAt = new Date("2026-08-11T12:00:00Z");
  const ranked = rankCorrelationCandidates(
    { eventType: "reported_development", observedAt, countryIso2: "US", sourceReliability: 0.8 },
    [{
      eventType: "reported_development",
      observedAt: new Date("2026-08-11T12:30:00Z"),
      countryIso2: "US",
      sourceReliability: 0.8,
    }],
    { threshold: 0.58, maxHours: 24, maxDistanceKm: 50 },
  );
  assert.equal(ranked[0].correlation.components.country, 1);
  assert.equal(ranked[0].correlation.components.location, 0);
  assert.equal(ranked[0].correlation.components.entity, 0);
  assert.equal(ranked[0].correlation.accepted, false);
});

test("country centroids are not spatial anchors while independent exact coordinates survive", () => {
  assert.equal(resolveSignalCoordinates({
    latitude: 38,
    longitude: -97,
    locationType: "country",
    coordinatesAreExact: false,
  }), null);
  assert.deepEqual(resolveSignalCoordinates({
    latitude: 38.25,
    longitude: -97.4,
    locationType: "country",
    coordinatesAreExact: true,
  }), { latitude: 38.25, longitude: -97.4 });
  assert.equal(resolveSignalCoordinates({
    latitude: 91,
    longitude: 10,
    locationType: "city",
    coordinatesAreExact: true,
  }), null);
});

test("audit selection follows the strongest accepted candidate rather than a stronger near miss", () => {
  const observedAt = new Date("2026-08-11T12:00:00Z");
  const entityKeys = Array.from({ length: 100 }, (_, index) => `entity-${index}`);
  const ranked = rankCorrelationCandidates({
    eventType: "wildfire",
    observedAt,
    latitude: 0,
    longitude: 0,
    locationId: "exact-location",
    countryIso2: "AA",
    entityKeys,
    sourceReliability: 1,
  }, [{
    eventType: "wildfire",
    observedAt,
    latitude: 0,
    longitude: 0.5035,
    countryIso2: "AA",
    entityKeys: entityKeys.slice(0, 49),
    sourceReliability: 1,
    id: "near-miss",
  }, {
    eventType: "wildfire",
    observedAt: new Date(observedAt.getTime() + 40 * 3_600_000),
    locationId: "exact-location",
    countryIso2: "AA",
    sourceReliability: 1,
    id: "accepted",
  }], { threshold: 0.58, maxHours: 72, maxDistanceKm: 100 });

  const outcome = selectCorrelationOutcome(ranked);
  assert.equal(outcome.strongest?.candidate.id, "near-miss");
  assert.equal(outcome.strongest?.correlation.accepted, false);
  assert.equal(outcome.accepted?.candidate.id, "accepted");
  assert.equal(outcome.decisionSubject?.candidate.id, "accepted");
  assert.equal(outcome.decisionSubject?.correlation, outcome.accepted?.correlation);
});

test("only the canonical provenance or materially stronger evidence replaces canonical copy", () => {
  const base = {
    eventExists: true,
    existingCanonicalEvidenceKey: "disaster:earthquake_observation:official-1",
    existingCanonicalRank: 0.9,
  };
  assert.equal(shouldReplaceCanonicalSignal({
    ...base,
    incomingEvidenceKey: "news:item:weak-follow-up",
    incomingCanonicalRank: 0.5,
  }), false);
  assert.equal(shouldReplaceCanonicalSignal({
    ...base,
    incomingEvidenceKey: "disaster:earthquake_observation:official-1",
    incomingCanonicalRank: 0.5,
  }), true);
  assert.equal(shouldReplaceCanonicalSignal({
    ...base,
    incomingEvidenceKey: "earth_observation:scene:new-physical-source",
    incomingCanonicalRank: 0.93,
  }), true);
});

test("related candidates require a concrete anchor and exclude the selected event", () => {
  const selected = { id: "selected", eventType: "wildfire", observedAt: new Date() };
  const spatial = { id: "spatial", eventType: "wildfire", observedAt: new Date() };
  const entity = { id: "entity", eventType: "wildfire", observedAt: new Date() };
  const generic = { id: "generic", eventType: "wildfire", observedAt: new Date() };
  const ranked = [
    { candidate: selected, correlation: { score: 0.8, accepted: true, methodology: "test", components: { temporal: 1, spatial: 1, location: 1, country: 1, entity: 0, event_type: 1, source_reliability: 1 } } },
    { candidate: generic, correlation: { score: 0.7, accepted: false, methodology: "test", components: { temporal: 1, spatial: 0, location: 0, country: 1, entity: 0, event_type: 1, source_reliability: 1 } } },
    { candidate: spatial, correlation: { score: 0.57, accepted: false, methodology: "test", components: { temporal: 0.9, spatial: 0.3, location: 0, country: 1, entity: 0, event_type: 1, source_reliability: 0.8 } } },
    { candidate: entity, correlation: { score: 0.56, accepted: false, methodology: "test", components: { temporal: 0.9, spatial: 0, location: 0, country: 1, entity: 0.3, event_type: 1, source_reliability: 0.8 } } },
  ];
  assert.deepEqual(
    qualifiedRelatedCorrelationCandidates(ranked, selected.id, 0.62).map(({ candidate }) => candidate.id),
    [spatial.id, entity.id],
  );
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
