import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const translation = import("../news-translation");

test("news language codes normalize without assuming a fixed interface language", async () => {
  const { normalizeNewsLanguageCode } = await translation;
  assert.equal(normalizeNewsLanguageCode(" PT_BR "), "pt-br");
  assert.equal(normalizeNewsLanguageCode("zh-Hant"), "zh-hant");
  assert.equal(normalizeNewsLanguageCode("english"), null);
  assert.equal(normalizeNewsLanguageCode("../../en"), null);
});

test("news translation skips matching base languages and translates other languages", async () => {
  const { newsLanguageMatchesTarget } = await translation;
  assert.equal(newsLanguageMatchesTarget("en-GB", "en-US"), true);
  assert.equal(newsLanguageMatchesTarget("pt-BR", "pt-PT"), true);
  assert.equal(newsLanguageMatchesTarget("fr", "en"), false);
  assert.equal(newsLanguageMatchesTarget(null, "en"), false);
});
