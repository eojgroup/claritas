import { describe, expect, it } from "vitest";
import {
  describeNewsEmptyState,
  describeNewsFreshness,
  mergeNewsTranslationIntoItems,
  resolveNewsCoverageSelection,
  sliceNewsTrendForExport,
} from "./newsWorkspacePresentation";

describe("news workspace presentation", () => {
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
