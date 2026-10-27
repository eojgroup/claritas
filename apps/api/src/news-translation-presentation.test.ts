import assert from "node:assert/strict";
import test from "node:test";
import { attachTranslationAvailability, needsTranslationAvailability } from "./news-translation-presentation";

test("free-quota status accompanies the original headline without hiding source text", () => {
  const items = [{ id: 1, title: "Noticias del puerto", language_code: "es", translated_title: null }];
  const result = attachTranslationAvailability(items, "en", {
    status: "quota_limited", reason: "Free translation quota reached.", retry_after: "2026-10-28T00:00:00Z",
  });
  assert.equal(result[0].title, items[0].title);
  assert.equal(result[0].translation_availability?.status, "quota_limited");
  assert.equal("translation_availability" in items[0], false, "cached source data must remain unchanged");
});

test("translated and matching-language headlines do not display a false pending state", () => {
  assert.equal(needsTranslationAvailability({ language_code: "en-GB" }, "en-US"), false);
  assert.equal(needsTranslationAvailability({ language_code: "es", translated_title: "Port news" }, "en"), false);
  assert.equal(needsTranslationAvailability({ language_code: "und" }, "en"), true);
  assert.equal(needsTranslationAvailability({ language_code: "zh" }, "en"), true);
});

test("archive stories outside the automatic window do not claim to be queued", () => {
  const result = attachTranslationAvailability([
    { title: "Noticias del puerto", language_code: "es", event_time: "2020-01-01T00:00:00Z" },
  ], "en", { status: "available", reason: "Queued automatically." });
  assert.equal(result[0].translation_availability?.status, "unavailable");
  assert.match(result[0].translation_availability?.reason ?? "", /recent reporting/);
});
