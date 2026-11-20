import assert from "node:assert/strict";
import test from "node:test";
import { countryAttentionScore } from "./country-attention";

test("important, unusual activity can outrank a much larger routine news market", () => {
  const routine = countryAttentionScore({ event_count: 12000, previous_event_count: 12500, high_priority_count: 200, peak_priority_score: 90 });
  const changing = countryAttentionScore({ event_count: 30, previous_event_count: 8, high_priority_count: 18, peak_priority_score: 92 });
  assert(changing > routine);
  assert(countryAttentionScore({ event_count: 1, high_priority_count: 0, peak_priority_score: 45 }) < routine);
  assert.equal(countryAttentionScore({ event_count: 0, high_priority_count: 0, peak_priority_score: 100 }), 0);
});
