import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocationAlias } from "./location-normalization";

test("location aliases normalize punctuation and diacritics consistently", () => {
  assert.equal(normalizeLocationAlias("  Strait-of-Hormuz! "), "strait of hormuz");
  assert.equal(normalizeLocationAlias("Bosphörus"), "bosphorus");
});

test("country abbreviations only match complete words in news", async () => {
  const { locationAliasTextPredicateSql } = await import("./location-normalization");
  const matches = (alias: string, text: string) => (` ${normalizeLocationAlias(text)} `).includes(` ${normalizeLocationAlias(alias)} `);
  assert.equal(matches("CAN", "Bristol Airport flights cancelled or delayed - updates"), false);
  assert.equal(matches("Bristol Airport", "Bristol Airport flights cancelled or delayed - updates"), true);
  assert.equal(matches("Iran", "viral news"), false);
  assert.match(locationAliasTextPredicateSql(), /' ' \|\| alias.normalized_alias \|\| ' '/);
});
