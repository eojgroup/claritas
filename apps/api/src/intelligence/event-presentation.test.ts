import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventUnderstanding,
  buildGdeltEventPresentation,
  buildLinkedNewsPresentation,
  gdeltActionLabel,
  humanizeGdeltActor,
} from "./event-presentation";

test("GDELT presentation explains action, actors, location, and evidence limits", () => {
  const result = buildGdeltEventPresentation({
    eventCode: "043",
    eventRootCode: "04",
    actor1: "SPECIAL ENVOY",
    actor2: "VLADIMIR PUTIN",
    location: "Russia",
    sourceCount: 3,
    articleCount: 5,
    mentionCount: 8,
  });
  assert.equal(result.title, "Reported consultation: Special Envoy / Vladimir Putin — Russia");
  assert.match(result.summary, /3 sources, 5 articles, 8 mentions/);
  assert.match(result.summary, /structured coverage signal/);
  assert.equal(gdeltActionLabel("190"), "armed conflict");
  assert.equal(humanizeGdeltActor("NATO / EU"), "NATO / EU");
});

test("event understanding answers what, where, and why without claiming causation", () => {
  const result = buildEventUnderstanding({
    title: "M6.1 earthquake",
    summary: "USGS observed an earthquake.",
    location_name: "Example City",
    severity: "high",
    relevance_score: 0.82,
    domain_count: 3,
    evidence_count: 4,
  }, [
    { domain: "news", relationship: "reported", source_record_type: "item" },
    { domain: "earth_observation", relationship: "observed", source_record_type: "earth_observation" },
  ]);
  assert.equal(result.what_happened, "USGS observed an earthquake.");
  assert.equal(result.where, "Example City");
  assert.match(result.why_interesting, /82\/100 relevance/);
  assert.match(result.why_interesting, /does not establish causation/);
  assert.equal(result.linked_news_count, 1);
  assert.equal(result.physical_observation_count, 1);
});

test("generic geography yields to a known country and labels defensible coordinates", () => {
  const result = buildEventUnderstanding({
    title: "M7.4 earthquake",
    location_name: "Global",
    primary_country_iso2: "CO",
    location_type: "city",
    latitude: 4.12345,
    longitude: -73.98765,
    metadata: { exact_geography: true },
  }, []);
  assert.equal(result.where, "Colombia");
  assert.equal(result.location_basis, "source_observed");
  assert.equal(result.coordinates?.label, "4.1235° N, 73.9877° W");
});

test("missing coordinates never become a synthetic Null Island location", () => {
  const result = buildEventUnderstanding({
    title: "Location unresolved",
    location_name: "Global",
    latitude: null,
    longitude: null,
  }, []);
  assert.equal(result.where, "Location not yet resolved");
  assert.equal(result.location_basis, "unresolved");
  assert.equal(result.coordinates, null);
});

test("linked reporting preserves publication time separately from evidence receipt time", () => {
  const result = buildLinkedNewsPresentation({
    id: "evidence-1",
    evidence_type: "article",
    relationship: "reported",
    source_title: "Port restrictions announced",
    source_summary: "Authorities published a navigation notice.",
    source_url: "https://publisher.test/report",
    attribution: "Example Publisher",
    published_at: "2026-08-11T08:05:00.000Z",
    observed_at: "2026-08-11T09:37:18.000Z",
    confidence: 0.84,
  });
  assert.equal(result.published_at, "2026-08-11T08:05:00.000Z");
  assert.equal(result.observed_at, "2026-08-11T09:37:18.000Z");
  assert.notEqual(result.published_at, result.observed_at);
});
