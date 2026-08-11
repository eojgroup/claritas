import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocationAlias } from "./location-normalization";

test("location aliases normalize punctuation and diacritics consistently", () => {
  assert.equal(normalizeLocationAlias("  Strait-of-Hormuz! "), "strait of hormuz");
  assert.equal(normalizeLocationAlias("Bosphörus"), "bosphorus");
});
