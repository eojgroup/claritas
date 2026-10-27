export type TranslationAvailability = {
  status: "available" | "pending" | "quota_limited" | "disabled" | "unavailable";
  reason: string | null;
  retry_after?: string | null;
};

const baseLanguage = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/_/g, "-").split("-")[0] : "";

export function needsTranslationAvailability(item: Record<string, unknown>, targetLanguage: string): boolean {
  const source = baseLanguage(item.language_code);
  return Boolean(source && source !== baseLanguage(targetLanguage)
    && !(typeof item.translated_title === "string" && item.translated_title.trim()));
}

export function attachTranslationAvailability<T extends Record<string, unknown>>(
  items: T[], targetLanguage: string, availability: TranslationAvailability | null, now = Date.now(),
): Array<T & { translation_availability?: TranslationAvailability }> {
  return items.map((item) => {
    if (!availability || !needsTranslationAvailability(item, targetLanguage)) return item;
    const eventMs = typeof item.event_time === "string" ? Date.parse(item.event_time) : Number.NaN;
    const state: TranslationAvailability = Number.isFinite(eventMs) && now - eventMs > 48 * 3_600_000
      ? { status: "unavailable", reason: "Automatic translation covers recent reporting. The original publisher text remains available.", retry_after: null }
      : availability;
    return { ...item, translation_availability: state };
  });
}
