import type { NewsItem, NewsTranslation } from "../lib/api";

export type NewsTopic = { code: string; label: string; count: number };

/** Counts each tagged story once; facets describe the loaded feed, not the entire archive. */
export function newsTopicFacets(items: readonly Pick<NewsItem, "id" | "tags">[]): NewsTopic[] {
  const topics = new Map<string, { label: string; ids: Set<number> }>();
  for (const item of items) {
    for (const tag of item.tags ?? []) {
      const code = tag.code.trim().toLocaleLowerCase();
      const label = tag.label.trim();
      if (tag.kind !== "topic" || !code || !label) continue;
      const topic = topics.get(code) ?? { label, ids: new Set<number>() };
      topic.ids.add(item.id);
      topics.set(code, topic);
    }
  }
  return [...topics].map(([code, { label, ids }]) => ({ code, label, count: ids.size }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function filterNewsByTopic<T extends Pick<NewsItem, "tags">>(items: readonly T[], code: string | null): T[] {
  const normalized = code?.trim().toLocaleLowerCase();
  return items.filter((item) => !normalized || item.tags?.some((tag) => (
    tag.kind === "topic" && tag.code.trim().toLocaleLowerCase() === normalized
  )));
}

type NewsChronologyItem = Pick<NewsItem, "event_time" | "payload" | "time"> & { id?: number };

export type NewsChronology = {
  timestamp: string | null;
  milliseconds: number | null;
  label: "Published" | "First seen" | "Source time" | "Reported";
  basis: "publication" | "discovery" | "mixed" | "unknown";
};

function parseTimestamp(value: string | null | undefined): { timestamp: string; milliseconds: number } | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? { timestamp: value, milliseconds } : null;
}

function legacyNewsTimeBasis(item: NewsChronologyItem): string {
  if (item.time?.basis?.trim()) return item.time.basis.trim();
  if (!item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return "";
  const value = (item.payload as Record<string, unknown>).time_basis;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves the one instant used to place a story on the reader timeline while
 * retaining what that instant means. New API responses explicitly provide
 * `timeline_at`; the provenance-specific fallbacks keep older cached responses
 * honest instead of relabelling provider discovery as publication.
 */
export function newsChronology(item: NewsChronologyItem): NewsChronology {
  const rawBasis = legacyNewsTimeBasis(item);
  const publisherVerified = item.time?.is_publisher_verified === true
    || rawBasis.startsWith("publisher_");
  const basis: NewsChronology["basis"] = rawBasis === "provider_first_seen"
    ? "discovery"
    : rawBasis === "publisher_published_or_provider_discovered"
      ? "mixed"
      : publisherVerified
        ? "publication"
        : "unknown";
  const label: NewsChronology["label"] = basis === "publication"
    ? "Published"
    : basis === "discovery"
      ? "First seen"
      : basis === "mixed"
        ? "Source time"
        : "Reported";

  const explicitTimeline = parseTimestamp(item.time?.timeline_at);
  const provenanceTimestamp = basis === "publication"
    ? parseTimestamp(item.time?.published_at)
    : basis === "discovery"
      ? parseTimestamp(item.time?.discovered_at)
      : null;
  const resolved = explicitTimeline ?? provenanceTimestamp ?? parseTimestamp(item.event_time);
  return {
    timestamp: resolved?.timestamp ?? null,
    milliseconds: resolved?.milliseconds ?? null,
    label,
    basis,
  };
}

export function compareNewsNewest(
  left: NewsChronologyItem,
  right: NewsChronologyItem,
): number {
  const leftTime = newsChronology(left).milliseconds;
  const rightTime = newsChronology(right).milliseconds;
  if (leftTime != null && rightTime != null) return rightTime - leftTime;
  if (leftTime != null) return -1;
  if (rightTime != null) return 1;
  return 0;
}

export function latestNewsTimestamp<T extends NewsChronologyItem>(items: readonly T[]): string | null {
  let latest: { timestamp: string; milliseconds: number } | null = null;
  for (const item of items) {
    const chronology = newsChronology(item);
    if (chronology.timestamp == null || chronology.milliseconds == null) continue;
    if (!latest || chronology.milliseconds > latest.milliseconds) {
      latest = {
        timestamp: chronology.timestamp,
        milliseconds: chronology.milliseconds,
      };
    }
  }
  return latest?.timestamp ?? null;
}

/**
 * Keeps browse-feed chronology deterministic without mutating the response.
 * Dated stories are newest first; undated/invalid stories remain at the end. IDs break ties consistently
 * with the API and Apple clients.
 */
export function newestNewsFirst<T extends NewsChronologyItem>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => {
      return {
        item,
        index,
        timestamp: newsChronology(item).milliseconds,
      };
    })
    .sort((left, right) => {
      if (left.timestamp != null && right.timestamp != null) {
        return right.timestamp - left.timestamp || (right.item.id ?? 0) - (left.item.id ?? 0) || left.index - right.index;
      }
      if (left.timestamp != null) return -1;
      if (right.timestamp != null) return 1;
      return (right.item.id ?? 0) - (left.item.id ?? 0) || left.index - right.index;
    })
    .map(({ item }) => item);
}

export type NewsDailyTrendPoint = {
  dateKey: string;
  label: string;
  count: number;
  rollingAvg: number;
};

/** Calendar days in the loaded reporting scope, bounded to ten years of daily points. */
export function newsDailyTrend(items: readonly NewsChronologyItem[]): NewsDailyTrendPoint[] {
  const counts = new Map<number, number>();
  const dayMilliseconds = 86_400_000;
  for (const item of items) {
    const timestamp = newsChronology(item).milliseconds;
    if (timestamp == null) continue;
    const day = Math.floor(timestamp / dayMilliseconds) * dayMilliseconds;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.keys()].sort((left, right) => left - right);
  if (days.length === 0) return [];
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const points: NewsDailyTrendPoint[] = [];
  const lastDay = days[days.length - 1];
  const firstDay = Math.max(days[0], lastDay - 3_659 * dayMilliseconds);
  let rollingCount = 0;
  for (let day = firstDay; day <= lastDay; day += dayMilliseconds) {
    const count = counts.get(day) ?? 0;
    rollingCount += count - (points.length >= 7 ? counts.get(day - 7 * dayMilliseconds) ?? 0 : 0);
    points.push({
      dateKey: new Date(day).toISOString().slice(0, 10),
      label: formatter.format(new Date(day)),
      count,
      rollingAvg: Number((rollingCount / Math.min(points.length + 1, 7)).toFixed(2)),
    });
  }
  return points;
}

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
