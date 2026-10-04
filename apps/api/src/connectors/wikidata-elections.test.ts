import test from "node:test";
import assert from "node:assert/strict";
import { normalizeElections, fetchWikidataElections, type ElectionBinding } from "./wikidata-elections";
const now = "2026-10-04T12:00:00Z";
const row: ElectionBinding = { election: { value: "http://www.wikidata.org/entity/Q123" }, electionLabel: { value: "Example presidential election" }, iso2: { value: "fr" }, date: { value: "2027-01-01T00:00:00Z" }, precision: { value: "9" } };
test("election normalization retains date precision, country and provenance without inventing results", () => {
  const elections = normalizeElections([row, row], now).get("FR")!;
  assert.equal(elections.length, 1);
  assert.equal(elections[0].date_precision, "year");
  assert.equal(elections[0].source_url, "https://www.wikidata.org/wiki/Q123");
  assert.equal(elections[0].retrieved_at, now);
  assert.equal(normalizeElections([{ ...row, precision: { value: "10" } }], now).get("FR")![0].date_precision, "month");
});
test("invalid election dates and unlabeled entities never enter the calendar", () => {
  assert.equal(normalizeElections([{ ...row, date: { value: "invalid" } }, { ...row, precision: undefined }, { ...row, electionLabel: { value: "Q123" } }], now).size, 0);
});
test("empty and failed provider responses reject instead of erasing calendars", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ results: { bindings: [] } }));
    await assert.rejects(fetchWikidataElections(), /retaining previous/);
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(fetchWikidataElections(), /503/);
  } finally { globalThis.fetch = original; }
});
