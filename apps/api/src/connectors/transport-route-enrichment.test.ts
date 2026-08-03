import assert from "node:assert/strict";
import test from "node:test";
import {
  prioritizeAdsbRouteLookups,
  type AdsbRouteLookup,
} from "./transport-route-enrichment";

function lookups(scope: string, count: number): AdsbRouteLookup[] {
  return Array.from({ length: count }, (_, index) => ({
    callsign: `${scope}${index.toString().padStart(3, "0")}`,
    latitude: 0,
    longitude: 0,
    scope,
  }));
}

test("route lookup selection preserves proportional country coverage", () => {
  const selected = prioritizeAdsbRouteLookups(
    [...lookups("US", 80), ...lookups("DE", 20)],
    50,
    1,
  );

  assert.equal(selected.length, 50);
  assert.equal(selected.filter((lookup) => lookup.scope === "US").length, 40);
  assert.equal(selected.filter((lookup) => lookup.scope === "DE").length, 10);
});

test("route lookup selection is independent of polling-area insertion order", () => {
  const input = [
    ...lookups("US", 120),
    ...lookups("DE", 40),
    ...lookups("JP", 40),
  ];
  const selected = prioritizeAdsbRouteLookups(input, 20, 2);

  assert.equal(selected.filter((lookup) => lookup.scope === "US").length, 12);
  assert.equal(selected.filter((lookup) => lookup.scope === "DE").length, 4);
  assert.equal(selected.filter((lookup) => lookup.scope === "JP").length, 4);
});
