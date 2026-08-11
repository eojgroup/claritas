import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventUnderstanding,
  buildGdeltEventPresentation,
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
