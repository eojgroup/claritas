import assert from "node:assert/strict";
import test from "node:test";
import { presentTranslatedSource, translateEventPresentation, translateEvidencePresentation, headlineTranslationFields,
  type TranslationSourceRow, type TranslationContext } from "./translation-presentation-model";
import { buildLinkedNewsPresentation } from "./event-presentation";

const source: TranslationSourceRow = { event_id: "event", item_id: "42", title: "El puerto cierra por la tormenta", summary: "Las autoridades anunciaron el cierre.",
  language_code: "es", translated_title: "Port closes because of storm", generated_summary: null, summary_status: "not_requested",
  provider: "openrouter", model: "free-model", target_language_code: "en", title_generated_at: "2026-11-04T10:00:00Z", summary_generated_at: null };
const context = (row: TranslationSourceRow = source): TranslationContext => ({ events: new Map([["event", row]]), items: new Map([["42", row]]), targetLanguage: "en", availability: null });

test("cached headline display preserves publisher originals, language and model provenance without inventing a translated summary", () => {
  const display = presentTranslatedSource(source, "en");
  assert.equal(display.title, "Port closes because of storm");
  assert.equal(display.original_title, source.title);
  assert.equal(display.summary, source.summary);
  assert.equal(display.original_summary, source.summary);
  assert.equal(display.translation_status, "translated");
  assert.equal(display.summary_translation_status, "pending");
  assert.equal(display.translation?.provider, "openrouter");
  assert.equal(display.translation?.title_generated_at, "2026-11-04T10:00:00.000Z");
  assert.equal(display.translation?.article_body_used, false);
  assert.match(display.translation_notice!, /source excerpt remains/);
});

test("missing or wrong-target cache keeps original text and exposes queued, quota or unavailable states", () => {
  const missing = { ...source, translated_title: null, target_language_code: null };
  assert.equal(presentTranslatedSource(missing, "en").translation_status, "pending");
  const limited = presentTranslatedSource(missing, "en", { status: "quota_limited", reason: "Free allowance reached", retry_after: "2026-11-05T00:00:00Z" });
  assert.equal(limited.title, source.title);
  assert.equal(limited.translation_availability?.status, "quota_limited");
  assert.equal(limited.translation_status, "pending");
  assert.equal(presentTranslatedSource(missing, "en", { status: "disabled", reason: "Disabled" }).translation_status, "unavailable");
  assert.equal(presentTranslatedSource({ ...source, target_language_code: "fr" }, "en").title, source.title);
  assert.equal(presentTranslatedSource({ ...missing, event_time: "2001-01-01T00:00:00Z" }, "en").translation_status, "unavailable");
});

test("existing target-language reporting needs no automatic translation", () => {
  const english = presentTranslatedSource({ ...source, language_code: "en-GB", translated_title: null }, "en");
  assert.equal(english.translation_status, "not_required");
  assert.equal(english.translation_availability, undefined);
  assert.equal(english.translation, null);
});

test("canonical source translation never overwrites an analyst headline or a different investigation description", () => {
  const translated = translateEventPresentation({ id: "event", title: source.title!, summary: source.summary }, context());
  assert.equal(translated.title, source.translated_title);
  assert.equal(translated.summary, source.summary);
  assert.equal(translated.summary_translation_status, "pending");
  const custom = { id: "event", title: "Analyst assessment of regional disruption", summary: "Different context" };
  assert.deepEqual(translateEventPresentation(custom, context()), custom);
  const summary = translateEventPresentation({ id: "event", title: source.title!, summary: source.summary },
    context({ ...source, generated_summary: "Authorities announced the closure.", summary_status: "generated", summary_generated_at: "2026-11-04T10:00:00Z" }));
  assert.equal(summary.summary, "Authorities announced the closure.");
  assert.equal(summary.original_summary, source.summary);
  assert.equal(summary.summary_translation_status, "translated");
});

test("translated source and linked-news presentation keep timestamps and uncertainty unchanged", () => {
  const row = translateEvidencePresentation({ id: "evidence", domain: "news", source_record_type: "item", source_record_id: "42",
    source_title: source.title, source_summary: source.summary, source_url: "https://example.org/story", relationship: "reported",
    confidence: .6, observed_at: "2026-11-04T10:02:00Z", published_at: "2026-11-04T10:01:00Z" }, context());
  const linked = buildLinkedNewsPresentation(row);
  assert.equal(linked.title, source.translated_title);
  assert.equal(linked.original_title, source.title);
  assert.equal(linked.translation_status, "translated");
  assert.equal(linked.relationship, "reported");
  assert.equal(linked.confidence, .6);
  assert.equal(linked.published_at, "2026-11-04T10:01:00Z");
  assert.equal(headlineTranslationFields(row).language_code, "es");
});
