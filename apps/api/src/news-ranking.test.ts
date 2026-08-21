import assert from "node:assert/strict";
import test from "node:test";
import { enrichAndRankNews } from "./news-ranking";

test("ranks corroborated severe market news above a routine newer item", () => {
  const ranked = enrichAndRankNews([
    { title: "Routine ministry notice", event_time: "2026-08-21T11:00:00Z", source_name: "feed" },
    { title: "Bond market hit by central bank shock", event_time: "2026-08-21T09:00:00Z", publisher: "Reuters", linked_events: [{ severity: "high", relevance_score: .9, domain_count: 3 }] },
  ], new Date("2026-08-21T12:00:00Z"));
  assert.equal(ranked[0].category, "markets");
  assert.ok(ranked[0].importance_score > ranked[1].importance_score);
  assert.deepEqual(ranked[0].tags, ["Markets", "HIGH", "Developing", "Corroborated"]);
});

test("uses source category context when headline is ambiguous", () => {
  const [story] = enrichAndRankNews([{ title: "Supply outlook revised", payload: { category: "energy" } }]);
  assert.equal(story.category, "energy");
});
