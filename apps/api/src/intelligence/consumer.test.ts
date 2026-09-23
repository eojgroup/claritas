import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const consumer = import("./consumer");
const majorEventContext = import("./major-event-context");
const intelligenceService = import("./service");

test("legacy GDELT articles stay hidden until the publisher-date quality check accepts them", async () => {
  const { isAcceptedNewsQuality } = await consumer;
  assert.equal(isAcceptedNewsQuality({}, "gdelt"), false);
  assert.equal(isAcceptedNewsQuality(null, "GDELT"), false);
  assert.equal(isAcceptedNewsQuality({ quality_status: "rejected" }, "gdelt"), false);
  assert.equal(isAcceptedNewsQuality({ quality_status: "accepted" }, "gdelt"), true);
  assert.equal(isAcceptedNewsQuality({
    quality_status: "accepted",
    canonical_alias_of_item_id: 42,
  }, "gdelt"), false);
  assert.equal(isAcceptedNewsQuality({}, "institutional_rss"), true);
});

test("podcast context requires a transcript-backed, confident concrete finding", async () => {
  const { podcastSignalQualifiesForEventContext } = await consumer;
  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "event",
    confidence: 0.72,
    evidenceCount: 2,
    entities: ["Port of Singapore"],
  }), true);

  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "topic",
    confidence: 1,
    evidenceCount: 2,
    entities: ["Port of Singapore"],
  }), false);
  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "claim",
    confidence: 0.72,
    evidenceCount: 0,
    entities: ["Port of Singapore"],
  }), false);
  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "risk",
    confidence: 0.72,
    evidenceCount: 1,
    entities: [],
  }), false);
});

test("seismic language, offshore place country, and local aliases survive normalization", async () => {
  const { classifyEventType, earthquakeCountryFromPlace, earthquakePlaceEntityKeys } = await consumer;
  assert.equal(classifyEventType("Tsunami warning after M7.7 quake near Ende"), "earthquake");
  assert.equal(classifyEventType("Strong aftershock reported near the epicentre"), "earthquake");
  assert.equal(classifyEventType("青海发生5.9级地震"), "earthquake");
  assert.equal(classifyEventType(`M5.9 earthquake near Yanglong ${"context ".repeat(180)}`), "earthquake");
  assert.equal(earthquakeCountryFromPlace("68 km NNW of Ende, Indonesia"), "ID");
  const keys = earthquakePlaceEntityKeys("68 km NNW of Ende, Indonesia", "us6000-test");
  assert.ok(keys.includes("Ende"));
  assert.ok(keys.includes("Indonesia"));
  assert.ok(keys.includes("us6000-test"));
});

test("significant-moderate earthquake replay is bounded, versioned, and idempotent", () => {
  const migration = readFileSync(resolve(
    __dirname,
    "../../../../infra/gcp/sql/V49__significant_earthquake_context_replay.sql",
  ), "utf8");
  assert.match(migration, /magnitude >= 5\.5/);
  assert.match(migration, /significance,0\) >= 450/);
  assert.match(migration, /context\.recheck:v2:/);
  assert.match(migration, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.doesNotMatch(migration, /disaster\.earthquake\.observed/);
});

test("targeted event-signature discovery accepts the 0.76 contract and resolves only exact identity", async () => {
  const {
    targetedEarthquakeDiscoveryDecision,
    targetedEarthquakeEntityKeys,
    targetedEarthquakeIdentityMatches,
    newsEventTypeForTargetedDiscovery,
  } = await consumer;
  const earthquakeObservationId = "123e4567-e89b-42d3-a456-426614174000";
  const observedAt = "2026-08-19T02:15:00.000Z";
  const decision = targetedEarthquakeDiscoveryDecision({
    targeted_discovery: {
      method: "deterministic_gdelt_doc_event_query_v1",
      event_type: "earthquake",
      earthquake_observation_id: earthquakeObservationId,
      usgs_event_id: "us7000yanglong",
      place: "270 km WSW of Yanglong, China",
      observed_at: observedAt,
      match: {
        link_eligible: true,
        confidence: 0.76,
        scope: "event_signature",
        factors: ["headline contains earthquake terminology", "headline magnitude matches at one-decimal precision"],
        rationale: "The headline shares the event family, magnitude, and a non-conflicting event signature.",
        assessment_boundary: "Likely contextual reporting only; this does not prove impact or causation.",
      },
    },
  });
  assert.equal(decision.present, true);
  assert.equal(decision.linkEligible, true);
  assert.equal(newsEventTypeForTargetedDiscovery("青海发生5.9级地震", decision), "earthquake");
  assert.equal(newsEventTypeForTargetedDiscovery("本地发布最新消息", decision), "earthquake");
  assert.equal(decision.audit?.scope, "event_signature");
  const recoveryKeys = targetedEarthquakeEntityKeys(decision);
  assert.ok(recoveryKeys.includes("Yanglong"));
  assert.ok(recoveryKeys.includes("us7000yanglong"));
  assert.ok(recoveryKeys.includes(earthquakeObservationId));
  assert.equal(targetedEarthquakeIdentityMatches(decision, {
    id: earthquakeObservationId,
    usgsEventId: "us7000yanglong",
    place: "270  km WSW of Yanglong, China",
    observedAt: new Date(observedAt),
  }), true);
  assert.equal(targetedEarthquakeIdentityMatches(decision, {
    id: "223e4567-e89b-42d3-a456-426614174000",
    usgsEventId: "us7000other-china-quake",
    place: "270 km WSW of Yanglong, China",
    observedAt: new Date(observedAt),
  }), false);

  const { targetedEarthquakeAuditMatchesAnchor } = await majorEventContext;
  assert.equal(targetedEarthquakeAuditMatchesAnchor(decision.audit, {
    earthquakeObservationId,
    usgsEventId: "us7000yanglong",
    place: "270  km WSW of Yanglong, China",
  }), true);
  assert.equal(targetedEarthquakeAuditMatchesAnchor(decision.audit, {
    earthquakeObservationId,
    usgsEventId: "us7000different",
    place: "270 km WSW of Yanglong, China",
  }), false);

  const { pendingEarthquakeContextRefreshDomains } = await majorEventContext;
  assert.deepEqual(pendingEarthquakeContextRefreshDomains({
    hasWeatherContext: false,
    hasTransportContext: true,
  }), ["news", "weather", "transport"]);
  assert.deepEqual(pendingEarthquakeContextRefreshDomains({
    hasWeatherContext: true,
    hasTransportContext: true,
  }), ["transport"]);
});

test("targeted country-only and malformed candidates remain review-only routing boundaries", async () => {
  const { newsEventTypeForTargetedDiscovery, targetedEarthquakeDiscoveryDecision } = await consumer;
  const base = {
    method: "deterministic_gdelt_doc_event_query_v1",
    event_type: "earthquake",
    earthquake_observation_id: "123e4567-e89b-42d3-a456-426614174000",
    usgs_event_id: "us7000yanglong",
    place: "270 km WSW of Yanglong, China",
    observed_at: "2026-08-19T02:15:00.000Z",
  };
  const reviewOnly = targetedEarthquakeDiscoveryDecision({
    targeted_discovery: {
      ...base,
      match: {
        link_eligible: false,
        confidence: 0.68,
        scope: "country",
        factors: ["headline names the event country"],
        rationale: "Only country overlap was available.",
        assessment_boundary: "Review candidate only.",
      },
    },
  });
  assert.equal(reviewOnly.present, true);
  assert.equal(reviewOnly.linkEligible, false);
  assert.equal(reviewOnly.audit, null);
  assert.equal(newsEventTypeForTargetedDiscovery("本地发布最新消息", reviewOnly), "reported_development");

  const forgedCountryLink = targetedEarthquakeDiscoveryDecision({
    targeted_discovery: {
      ...base,
      match: {
        link_eligible: true,
        confidence: 0.95,
        scope: "country",
        factors: ["country only"],
        rationale: "This must not be enough to attach to a local earthquake.",
        assessment_boundary: "Country identity is not local event identity.",
      },
    },
  });
  assert.equal(forgedCountryLink.present, true);
  assert.equal(forgedCountryLink.linkEligible, false);
  assert.equal(forgedCountryLink.rejectionReason, "invalid_link_eligible_target_contract");

  const malformed = targetedEarthquakeDiscoveryDecision({ targeted_discovery: null });
  assert.equal(malformed.present, true);
  assert.equal(malformed.linkEligible, false);
  assert.equal(newsEventTypeForTargetedDiscovery("本地发布最新消息", malformed), "reported_development");
});

test("coverage assessments do not make the canonical event newly active", async () => {
  const { contextualEvidenceLastActivity } = await intelligenceService;
  const candidateLastActivity = new Date("2026-08-19T02:00:00Z");
  const evidenceObservedAt = new Date("2026-08-20T02:00:00Z");
  assert.equal(contextualEvidenceLastActivity({
    candidateLastActivity,
    evidenceObservedAt,
    relationship: "assessment",
  }).toISOString(), candidateLastActivity.toISOString());
  assert.equal(contextualEvidenceLastActivity({
    candidateLastActivity,
    evidenceObservedAt,
    relationship: "context",
  }).toISOString(), evidenceObservedAt.toISOString());
});

test("airport reporting is aviation, not the port substring", async () => {
  const { classifyEventType } = await consumer;
  assert.equal(classifyEventType("Bristol Airport flights cancelled or delayed - updates"), "aviation_disruption");
  for (const airport of ["Heathrow", "Dubai International", "Singapore Changi", "Frankfurt"]) {
    assert.equal(classifyEventType(`${airport} Airport flights cancelled or delayed`), "aviation_disruption");
  }
  assert.equal(classifyEventType("Report on elections"), "reported_development");
  assert.equal(classifyEventType("Port closure delays tankers"), "transport_disruption");
});

test("transport company news is not evidence of an operational disruption", async () => {
  const { classifyEventType, newsReaderSummary } = await consumer;
  for (const title of [
    "DHL Supply Chain anuncia la adquisición estratégica de Open Market en Colombia",
    "Shipping company acquires Colombia logistics business",
    "Airline announces record earnings and new flights",
    "Port of Rotterdam publishes annual report",
    "Airport operator strikes a deal with investors",
  ]) assert.equal(classifyEventType(title), "reported_development", title);
  assert.equal(classifyEventType("Freight transport disrupted after roads blocked in Colombia"), "transport_disruption");
  assert.equal(classifyEventType("DHL acquires Colombian logistics firm GDELT themes: TRANSPORT_DISRUPTION, ARMEDCONFLICT"), "reported_development");
  assert.equal(newsReaderSummary(" GDELT themes: TAX_FNCACT_RETAILER, EPU_POLICY "), null);
  assert.equal(newsReaderSummary("  A publisher reports a logistics acquisition.  "), "A publisher reports a logistics acquisition.");
});

test("only transcript-backed event findings originate podcast investigations", async () => {
  const { podcastSignalQualifiesForEventOrigin } = await consumer;
  const eligible = { signalType: "event", confidence: 0.74, evidenceCount: 1, entities: ["DHL"] };
  assert.equal(podcastSignalQualifiesForEventOrigin(eligible), true);
  assert.equal(podcastSignalQualifiesForEventOrigin({ ...eligible, signalType: "risk" }), false);
  assert.equal(podcastSignalQualifiesForEventOrigin({ ...eligible, signalType: "claim" }), false);
  assert.equal(podcastSignalQualifiesForEventOrigin({ ...eligible, evidenceCount: 0 }), false);
  assert.equal(podcastSignalQualifiesForEventOrigin({ ...eligible, entities: [] }), false);
  assert.equal(podcastSignalQualifiesForEventOrigin({ ...eligible, confidence: 0.69 }), false);
});

test("social event origins require an actual content anchor and described development", async () => {
  const { socialSignalQualifiesForEventOrigin } = await consumer;
  assert.equal(socialSignalQualifiesForEventOrigin({
    text: "The airport flights were cancelled following the overnight closure in Bristol.", hasPlaceAnchor: true,
  }), true);
  assert.equal(socialSignalQualifiesForEventOrigin({
    text: "$ACME announced earnings today with shares falling after the company missed expectations.", hasPlaceAnchor: false,
  }), true);
  assert.equal(socialSignalQualifiesForEventOrigin({
    text: "The airport flights were cancelled following the overnight closure.", hasPlaceAnchor: false,
  }), false);
  assert.equal(socialSignalQualifiesForEventOrigin({
    text: "Enjoying a lovely morning visiting the beautiful airport in Bristol today.", hasPlaceAnchor: true,
  }), false);
});

test("invalid source review requests cannot issue database queries or promote arbitrary records", async () => {
  const { promoteSourceToInvestigation } = await consumer;
  assert.equal(await promoteSourceToInvestigation({ domain: "news", sourceRecordType: "item", sourceRecordId: "-1" }), null);
  assert.equal(await promoteSourceToInvestigation({ domain: "news", sourceRecordType: "global_event", sourceRecordId: "1" }), null);
  assert.equal(await promoteSourceToInvestigation({ domain: "imagery", sourceRecordType: "earth_observation", sourceRecordId: "not-a-uuid" }), null);
});

test("transport baselines require the current day and compare matched elapsed hours", async () => {
  const { transportComparisonWindow } = await consumer;
  const history = Array.from({ length: 7 }, (_, index) => ({
    bucket: `2026-09-${String(index + 16).padStart(2, "0")}T00:00:00Z`, total: 30,
  }));
  const now = new Date("2026-09-23T06:30:00Z");
  assert.equal(transportComparisonWindow(history, now), null, "No current telemetry must not masquerade as zero traffic");
  const window = transportComparisonWindow([...history, { bucket: "2026-09-23T00:00:00Z", total: 30 }], now);
  assert.deepEqual(window, { current: 30, previousEquivalent: 30, sevenDayMedian: 30, twentyEightDayMedian: 30, sampleHours: 42 });
  assert.equal(transportComparisonWindow(history, new Date("2026-09-23T00:30:00Z")), null, "No complete UTC hour at midnight");
});
