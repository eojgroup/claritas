import type { NewsItem, NewsTranslation } from "../lib/api";

export function mergeNewsTranslationIntoItems(
  items: NewsItem[],
  itemId: number,
  translation: NewsTranslation,
): NewsItem[] {
  return items.map((entry) => entry.id === itemId
    ? {
        ...entry,
        translated_title: translation.translated_title ?? entry.translated_title ?? null,
        ai_summary: translation.generated_summary ?? null,
        translation: {
          ...translation,
          headline_kind: "ai_translation",
          summary_kind: translation.summary_status === "generated" ? "ai_generated" : null,
        },
      }
    : entry);
}

export type NewsCoverageSelection =
  | { action: "select"; country: string }
  | { action: "clear"; country: null }
  | { action: "unavailable"; country: null };

export function resolveNewsCoverageSelection(
  requestedCountry: string,
  activeCountry: string | null,
): NewsCoverageSelection {
  const requested = requestedCountry.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(requested)) return { action: "unavailable", country: null };
  if (activeCountry?.toUpperCase() === requested) return { action: "clear", country: null };
  return { action: "select", country: requested };
}

export type NewsTrendRange = {
  startIndex?: number;
  endIndex?: number;
};

export function sliceNewsTrendForExport<T>(
  rows: readonly T[],
  range: NewsTrendRange,
): T[] {
  if (rows.length === 0) return [];
  const lastIndex = rows.length - 1;
  const requestedStart = Math.max(0, Math.min(range.startIndex ?? 0, lastIndex));
  const requestedEnd = Math.max(0, Math.min(range.endIndex ?? lastIndex, lastIndex));
  const startIndex = Math.min(requestedStart, requestedEnd);
  const endIndex = Math.max(requestedStart, requestedEnd);
  return rows.slice(startIndex, endIndex + 1);
}

export function describeNewsFreshness(
  latestTimestamp: string | null | undefined,
  now = Date.now(),
): { label: string; tone: "fresh" | "aging" | "stale" | "unknown" } {
  if (!latestTimestamp) return { label: "No publication time available", tone: "unknown" };
  const timestamp = Date.parse(latestTimestamp);
  if (!Number.isFinite(timestamp)) return { label: "Publication time unavailable", tone: "unknown" };
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000);
  if (ageHours < 1) return { label: "Latest story less than 1 hour old", tone: "fresh" };
  if (ageHours < 24) {
    const hours = Math.max(1, Math.floor(ageHours));
    return { label: `Latest story ${hours} ${hours === 1 ? "hour" : "hours"} old`, tone: "fresh" };
  }
  const days = Math.max(1, Math.floor(ageHours / 24));
  return {
    label: `Latest story ${days} ${days === 1 ? "day" : "days"} old`,
    tone: days >= 3 ? "stale" : "aging",
  };
}

export function describeNewsEmptyState(input: {
  loading: boolean;
  loadError?: string | null;
  country?: string | null;
  region?: string | null;
  hasFilters: boolean;
  rawItemCount: number;
}): { title: string; detail: string; action: "none" | "retry" | "clear-filters" | "clear-country" | "reset-scope" } {
  if (input.loading) {
    return {
      title: "Loading quality-checked reporting…",
      detail: "Claritas is requesting the selected story scope.",
      action: "none",
    };
  }
  if (input.loadError) {
    return {
      title: "Reporting could not be loaded",
      detail: input.loadError,
      action: "retry",
    };
  }
  if (input.country) {
    return {
      title: `No stories returned for ${input.country.toUpperCase()}`,
      detail: "The country remains an explicit scope, but no quality-checked story matched the current source, language, image, and search filters.",
      action: input.hasFilters ? "clear-filters" : "clear-country",
    };
  }
  if (input.hasFilters) {
    return {
      title: "No stories match the active filters",
      detail: "Clear the workspace filters to return to the global reporting overview.",
      action: "clear-filters",
    };
  }
  if (input.region) {
    return {
      title: `No stories returned for ${input.region}`,
      detail: "The regional scope remains active. Reset to global news to inspect reporting outside this region.",
      action: "reset-scope",
    };
  }
  if (input.rawItemCount === 0) {
    return {
      title: "No recent reporting is available",
      detail: "The service returned no quality-checked recent stories. Retry the feed or inspect the archive.",
      action: "retry",
    };
  }
  return {
    title: "No stories in this view",
    detail: "Change the current scope to inspect other reporting.",
    action: "clear-filters",
  };
}
