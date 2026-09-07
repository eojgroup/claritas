import { describe, expect, it } from "vitest";
import {
  describeNewsEmptyState,
  describeNewsFreshness,
  mergeNewsTranslationIntoItems,
  latestNewsTimestamp,
  newsChronology,
  newsDailyTrend,
  newestNewsFirst,
  resolveNewsCoverageSelection,
  sliceNewsTrendForExport,
} from "./newsWorkspacePresentation";

describe("news workspace presentation", () => {
  it("counts empty calendar days in seven-day reporting averages", () => {
    const series = newsDailyTrend([
      { event_time: "2026-08-01T12:00:00Z" },
      { event_time: "2026-08-08T12:00:00Z" },
      { event_time: "2026-08-08T18:00:00Z" },
      { event_time: "not-a-date" },
    ]);
    expect(series).toHaveLength(8);
    expect(series[1]).toMatchObject({ dateKey: "2026-08-02", count: 0, rollingAvg: 0.5 });
    expect(series[7]).toMatchObject({ dateKey: "2026-08-08", count: 2, rollingAvg: 0.29 });
    expect(series.reduce((total, day) => total + day.count, 0)).toBe(3);
  });

  it("keeps timeline buckets and labels in UTC across offsets and daylight-saving changes", () => {
    const series = newsDailyTrend([
      { event_time: "2026-03-07T23:30:00-08:00" },
      { event_time: "2026-03-10T00:30:00+01:00" },
    ]);
    expect(series.map((day) => [day.dateKey, day.label])).toEqual([
      ["2026-03-08", "Mar 8"],
      ["2026-03-09", "Mar 9"],
    ]);
  });

  it("bounds chart work when a stored timestamp is far outside the reporting period", () => {
    const series = newsDailyTrend([{ event_time: "0001-01-01T00:00:00Z" }, { event_time: "2026-09-07T00:00:00Z" }]);
    expect(series).toHaveLength(3_660);
    expect(series[series.length - 1]).toMatchObject({ dateKey: "2026-09-07", count: 1 });
    expect(series.every((day) => day.rollingAvg >= 0)).toBe(true);
  });

  it("allows direct inspection without positive coverage and toggles an active country off", () => {
    expect(resolveNewsCoverageSelection("US", null)).toEqual({ action: "select", country: "US" });
    expect(resolveNewsCoverageSelection("US", "US")).toEqual({ action: "clear", country: null });
    expect(resolveNewsCoverageSelection("CN", null)).toEqual({ action: "select", country: "CN" });
    expect(resolveNewsCoverageSelection("not-a-country", null)).toEqual({ action: "unavailable", country: null });
  });

  it("exports only the news-workspace brush range and safely clamps stale indices", () => {
    const rows = ["Aug 14", "Aug 15", "Aug 16"];
    expect(sliceNewsTrendForExport(rows, { startIndex: 1, endIndex: 1 })).toEqual(["Aug 15"]);
    expect(sliceNewsTrendForExport(rows, { startIndex: 99, endIndex: 1 })).toEqual(["Aug 15", "Aug 16"]);
    expect(sliceNewsTrendForExport([], { startIndex: 1, endIndex: 2 })).toEqual([]);
  });

  it("calls out aging and stale feeds instead of presenting them as live", () => {
    const now = Date.parse("2026-08-16T12:00:00Z");
    expect(describeNewsFreshness("2026-08-16T10:00:00Z", now)).toEqual({
      label: "Latest story 2 hours old",
      tone: "fresh",
    });
    expect(describeNewsFreshness("2026-08-14T10:00:00Z", now)).toEqual({
      label: "Latest story 2 days old",
      tone: "aging",
    });
    expect(describeNewsFreshness("2026-08-10T10:00:00Z", now).tone).toBe("stale");
  });

  it("presents browse feeds newest-first without mutating the response", () => {
    const responseItems = [
      { id: 1, event_time: "2026-08-18T20:00:00Z" },
      { id: 2, event_time: null },
      { id: 3, event_time: "2026-08-21T09:15:00Z" },
      { id: 4, event_time: "not-a-date" },
      { id: 5, event_time: "2026-08-20T17:30:00Z" },
    ];

    expect(newestNewsFirst(responseItems).map((item) => item.id)).toEqual([3, 5, 1, 2, 4]);
    expect(responseItems.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("orders absolute instants rather than lexically comparing ISO spellings", () => {
    const responseItems = [
      { id: 1, event_time: "2026-09-07T10:30:00+02:00", payload: null, time: null },
      { id: 2, event_time: "2026-09-07T09:00:00Z", payload: null, time: null },
      { id: 3, event_time: "2026-09-07T08:45:00.500Z", payload: null, time: null },
    ];

    expect(newestNewsFirst(responseItems).map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it("keeps publisher publication and provider discovery chronology semantically distinct", () => {
    const published = newsChronology({
      event_time: "2026-09-07T08:00:00Z",
      payload: null,
      time: {
        basis: "publisher_published_verified",
        is_publisher_verified: true,
        timeline_at: "2026-09-07T08:00:00Z",
        published_at: "2026-09-07T08:00:00Z",
        discovered_at: "2026-09-07T09:00:00Z",
      },
    });
    const discovered = newsChronology({
      event_time: "2026-09-07T09:00:00Z",
      payload: null,
      time: {
        basis: "provider_first_seen",
        is_publisher_verified: false,
        timeline_at: "2026-09-07T09:00:00Z",
        published_at: null,
        discovered_at: "2026-09-07T09:00:00Z",
      },
    });

    expect(published).toMatchObject({ label: "Published", basis: "publication" });
    expect(discovered).toMatchObject({ label: "First seen", basis: "discovery" });
    expect(discovered.timestamp).toBe("2026-09-07T09:00:00Z");
  });

  it("uses provenance-specific timestamps for cached responses predating timeline_at", () => {
    expect(newsChronology({
      event_time: "2026-09-07T11:00:00Z",
      payload: null,
      time: {
        basis: "publisher_published_verified",
        is_publisher_verified: true,
        published_at: "2026-09-07T08:00:00Z",
        discovered_at: "2026-09-07T11:00:00Z",
      },
    }).timestamp).toBe("2026-09-07T08:00:00Z");
  });

  it("finds freshness by instant when timestamp offsets use different spellings", () => {
    expect(latestNewsTimestamp([
      { event_time: "2026-09-07T10:30:00+02:00" },
      { event_time: "2026-09-07T09:00:00Z" },
    ])).toBe("2026-09-07T09:00:00Z");
  });

  it("explains an empty country result rather than silently rendering a blank panel", () => {
    expect(describeNewsEmptyState({
      loading: false,
      country: "CN",
      hasFilters: false,
      rawItemCount: 0,
    })).toMatchObject({
      title: "No stories returned for CN",
      action: "clear-country",
    });
    expect(describeNewsEmptyState({
      loading: false,
      country: "CN",
      hasFilters: true,
      rawItemCount: 4,
    }).action).toBe("clear-filters");
    expect(describeNewsEmptyState({
      loading: false,
      region: "Asia",
      hasFilters: false,
      rawItemCount: 8,
    })).toMatchObject({
      title: "No stories returned for Asia",
      action: "reset-scope",
    });
  });

  it("merges generated translations into whichever news store is visible", () => {
    const original = [{
      id: 42,
      kind: "news_article",
      title: "Título original",
      summary: "Resumen original",
      url: "https://example.test/story",
      country_iso2: "MX",
      event_time: "2026-08-16T10:00:00Z",
    }];
    const translated = mergeNewsTranslationIntoItems(original, 42, {
      target_language_code: "en",
      translated_title: "Translated title",
      generated_summary: "Generated summary",
      summary_status: "generated",
      provider: "openrouter",
    });

    expect(translated[0]).toMatchObject({
      translated_title: "Translated title",
      ai_summary: "Generated summary",
      translation: {
        headline_kind: "ai_translation",
        summary_kind: "ai_generated",
      },
    });
    expect(original[0]).not.toHaveProperty("translated_title");
  });
});
