import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalCoverage, eventPriorityReasons } from "./event-priority";

test("source coverage separates imagery, sensor observations and model interpretations without duplicating socials", () => {
  const coverage = buildSignalCoverage([
    { domain: "earth_observation", source_record_type: "earth_observation", relationship: "observed" },
    { domain: "earth_observation", source_record_type: "fire_observation", relationship: "observed" },
    { domain: "earth_observation", source_record_type: "earth_observation_vision", relationship: "model_interpretation" },
    { domain: "podcast", source_record_type: "intelligence_signal", relationship: "model_interpretation" },
    { domain: "social", source_record_type: "social_signal", source_record_id: "42", relationship: "context" },
    { domain: "transport", relationship: "assessment" },
  ], [{ signal_id: 42 }, { signal_id: 43 }, { signal_id: 43 }]);
  const byDomain = Object.fromEntries(coverage.map((row) => [row.domain, row]));
  assert.equal(byDomain.imagery.count, 1);
  assert.equal(byDomain.earth_observation.count, 1);
  assert.equal(byDomain.model_interpretation.state, "context");
  assert.equal(byDomain.podcast.state, "context");
  assert.equal(byDomain.social.count, 2);
  assert.equal(byDomain.social.state, "context");
  assert.equal(byDomain.transport.state, "none");
});

test("priority explanations preserve uncertainty and exempt critical events from repetition demotion", () => {
  assert.ok(eventPriorityReasons({ origin_domain: "social" }).some((value) => /not confirmation/.test(value)));
  assert.ok(eventPriorityReasons({ news_priority: 0.8 }).includes("Material publisher reporting"));
  assert.ok(eventPriorityReasons({ severity: "medium", origin_topic_rank: 2 }).some((value) => /grouped lower/.test(value)));
  assert.ok(!eventPriorityReasons({ severity: "critical", origin_topic_rank: 2 }).some((value) => /grouped lower/.test(value)));
});
