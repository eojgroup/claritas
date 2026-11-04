import type { TranslationAvailability } from "../news-translation-presentation";
import { normalizeIntelligenceDisplayLanguage } from "./display-language";
const normalizeLanguage = (value: unknown) => {
  try { return normalizeIntelligenceDisplayLanguage(value); } catch { return null; }
};
const matchingLanguage = (source: unknown, target: string) => {
  const language = normalizeLanguage(source);
  return Boolean(language && language.split("-")[0] === target.split("-")[0]);
};

export type HeadlineTranslationStatus = "translated" | "pending" | "not_required" | "unavailable";
export type HeadlineTranslationPresentation = {
  original_title: string | null;
  original_summary: string | null;
  language_code: string | null;
  display_language: string;
  translated_title: string | null;
  translation_status: HeadlineTranslationStatus;
  summary_translation_status: HeadlineTranslationStatus;
  translation: null | {
    target_language_code: string; headline_kind: "ai_translation"; summary_kind: "ai_generated" | null;
    summary_status: string; provider: string; model: string | null; title_generated_at: string | null;
    summary_generated_at: string | null; source_content_preserved: true; article_body_used: false;
  };
  translation_availability?: TranslationAvailability;
  translation_notice: string | null;
};

export type TranslationSourceRow = {
  event_id: string | null; item_id: string; event_time?: string | Date | null; canonical_evidence_key?: string | null;
  title: string | null; summary: string | null; language_code: string | null;
  translated_title: string | null; generated_summary: string | null; summary_status: string | null;
  provider: string | null; model: string | null; target_language_code: string | null;
  title_generated_at: string | Date | null; summary_generated_at: string | Date | null;
};
export type TranslationContext = { events: Map<string, TranslationSourceRow>; items: Map<string, TranslationSourceRow>; targetLanguage: string; availability: TranslationAvailability | null; unavailable?: boolean };
const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();

export function presentTranslatedSource(source: TranslationSourceRow, targetLanguage: string, availability: TranslationAvailability | null = null) {
  const language = normalizeLanguage(source.language_code) ?? "und";
  const required = !matchingLanguage(language, targetLanguage);
  const translated = required && source.target_language_code === targetLanguage && Boolean(source.translated_title?.trim());
  const translatedSummary = translated && source.summary_status === "generated" && Boolean(source.generated_summary?.trim());
  const sourceTime = source.event_time == null ? Number.NaN : new Date(source.event_time).getTime();
  const missing: TranslationAvailability = Number.isFinite(sourceTime) && Date.now() - sourceTime > 48 * 3_600_000
    ? { status: "unavailable", reason: "Automatic translation covers recent reporting. Original publisher text remains available.", retry_after: null }
    : availability?.status === "available" || !availability
      ? { status: "pending", reason: "Headline translation is pending. The original publisher text is shown.", retry_after: availability?.retry_after ?? null }
      : availability;
  const status: HeadlineTranslationStatus = translated ? "translated" : !required ? "not_required"
    : ["disabled", "unavailable"].includes(missing.status) ? "unavailable" : "pending";
  const fields: HeadlineTranslationPresentation = {
    original_title: source.title, original_summary: source.summary, language_code: source.language_code,
    display_language: targetLanguage, translated_title: translated ? source.translated_title : null,
    translation_status: status, summary_translation_status: !source.summary || !required ? "not_required"
      : translatedSummary ? "translated" : status === "unavailable" ? "unavailable" : "pending",
    translation: translated ? { target_language_code: targetLanguage, headline_kind: "ai_translation",
      summary_kind: translatedSummary ? "ai_generated" : null, summary_status: source.summary_status ?? "not_requested",
      provider: source.provider ?? "unknown", model: source.model, title_generated_at: iso(source.title_generated_at),
      summary_generated_at: iso(source.summary_generated_at), source_content_preserved: true, article_body_used: false } : null,
    ...(required && !translated ? { translation_availability: missing } : {}),
    translation_notice: translated ? translatedSummary || !source.summary
      ? "Automatically translated from publisher text; original content and source attribution are preserved."
      : "Headline automatically translated; the source excerpt remains in its original language."
      : required ? missing.reason : null,
  };
  return { title: translated ? source.translated_title! : source.title,
    summary: translatedSummary ? source.generated_summary : source.summary, ...fields };
}

export function unavailableTranslationFields(title: string | null, summary: string | null, context: TranslationContext): HeadlineTranslationPresentation {
  return { original_title: title, original_summary: summary, language_code: null, display_language: context.targetLanguage,
    translated_title: null, translation_status: "unavailable", summary_translation_status: "unavailable", translation: null,
    translation_availability: context.availability ?? { status: "unavailable", reason: "Translation metadata is temporarily unavailable. Original text is shown.", retry_after: null },
    translation_notice: "Translation metadata is temporarily unavailable. Original text is shown." };
}

export function translateEventPresentation<T extends { id: string; title: string; summary?: string | null }>(event: T, context: TranslationContext): T & Partial<HeadlineTranslationPresentation> {
  const source = context.events.get(event.id);
  // A linked article is not a substitute for an analyst or another source's
  // canonical headline. Only translate the exact preserved publisher heading.
  if (!source) return context.unavailable ? { ...event, ...unavailableTranslationFields(event.title, event.summary ?? null, context) } : event;
  if (source.title?.trim() !== event.title.trim()) return event;
  const display = presentTranslatedSource(source, context.targetLanguage, context.availability);
  const sourceExcerpt = source.summary?.replace(/\s+/g, " ").trim().slice(0, 1800);
  const matchingSummary = Boolean(event.summary && sourceExcerpt && (event.summary.trim() === sourceExcerpt
    || event.summary.length === 500 && sourceExcerpt.startsWith(event.summary.trim())));
  const untranslatedDescription = event.summary && !/^Publisher reporting\. Open the source/.test(event.summary)
    && !matchingLanguage(source.language_code, context.targetLanguage);
  return { ...event, ...display, title: display.title ?? event.title,
    summary: matchingSummary ? display.summary ?? event.summary : event.summary,
    original_title: event.title, original_summary: event.summary ?? null,
    summary_translation_status: matchingSummary ? display.summary_translation_status
      : untranslatedDescription ? display.translation_status === "unavailable" ? "unavailable" : "pending" : "not_required" as const };
}

export function translateEvidencePresentation<T extends Record<string, any>>(evidence: T, context: TranslationContext): T & Partial<HeadlineTranslationPresentation> {
  if (evidence.domain !== "news" || evidence.source_record_type !== "item") return evidence;
  const source = context.items.get(String(evidence.source_record_id));
  if (!source) return context.unavailable ? { ...evidence, ...unavailableTranslationFields(evidence.source_title ?? null, evidence.source_summary ?? null, context) } : evidence;
  const { title, summary, ...fields } = presentTranslatedSource(source, context.targetLanguage, context.availability);
  return { ...evidence, ...fields, source_title: title ?? evidence.source_title, source_summary: summary ?? evidence.source_summary };
}

export function headlineTranslationFields(value: Record<string, any>): Partial<HeadlineTranslationPresentation> {
  const fields: Partial<HeadlineTranslationPresentation> = {};
  for (const key of ["original_title", "original_summary", "language_code", "display_language", "translated_title",
    "translation_status", "summary_translation_status", "translation", "translation_availability", "translation_notice"] as const) {
    if (value[key] !== undefined) (fields as Record<string, unknown>)[key] = value[key];
  }
  return fields;
}
