import type { HeadlineTranslationPresentation } from "./api";

export function displayHeadline(value: HeadlineTranslationPresentation, fallback: string) {
  const target = value.translation?.target_language_code;
  return value.translation_status === "translated" && (!target || target === (value.display_language ?? "en"))
    ? value.translated_title?.trim() || fallback
    : fallback;
}

export function translationStatusLabel(value: HeadlineTranslationPresentation) {
  if (value.translation_status === "translated") return "AI translation";
  if (value.translation_status === "not_required") return null;
  if (value.translation_availability?.status === "quota_limited") return "Translation allowance reached";
  if (value.translation_status === "unavailable") return "Translation unavailable";
  return value.translation_status === "pending" ? "Translation pending" : null;
}
