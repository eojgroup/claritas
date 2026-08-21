import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNews } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("fetchNews", () => {
  it("requests server-ranked category results and preserves ranking evidence", async () => {
    const story = {
      id: 17,
      kind: "news_article",
      title: "Port closure affects regional freight",
      summary: "Authorities temporarily restricted vessel movements.",
      url: "https://example.test/story",
      country_iso2: "SG",
      event_time: "2026-08-21T10:00:00Z",
      primary_category: "transport",
      categories: ["transport", "markets"],
      tags: [{ code: "port", label: "Port disruption", kind: "event" }],
      importance: {
        score: 78,
        tier: "high",
        confidence: 0.88,
        reasons: [{ code: "linked_event", label: "High-severity linked event" }],
        methodology: "news_importance_v1",
        calculated_at: "2026-08-21T10:05:00Z",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        items: [story],
        facets: { categories: [{ category: "transport", count: 47 }] },
        ranking: {
          methodology: "trader-news-priority-v1",
          sort: "newest",
          category: "transport",
          archive: true,
          assessed_at: "2026-08-21T10:05:00Z",
          unassessed_count: 2,
          selected_unassessed_count: 1,
          diversification: "none",
        },
        page: { limit: 3, offset: 0, total: 47, metadata_included: true },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchNews({
      limit: 3,
      country: "SG",
      category: "transport",
      sort: "newest",
      archive: true,
    });

    const requested = new URL(String(fetchMock.mock.calls[0][0]), "https://claritas.test");
    expect(requested.pathname).toBe("/api/news");
    expect(requested.searchParams.get("country")).toBe("SG");
    expect(requested.searchParams.get("category")).toBe("transport");
    expect(requested.searchParams.get("sort")).toBe("newest");
    expect(requested.searchParams.get("limit")).toBe("3");
    expect(requested.searchParams.get("archive")).toBe("true");
    expect(requested.searchParams.has("include_metadata")).toBe(false);
    expect(result.items[0]).toMatchObject({
      primary_category: "transport",
      tags: [{ code: "port", label: "Port disruption", kind: "event" }],
      importance: {
        tier: "high",
        reasons: [{ code: "linked_event", label: "High-severity linked event" }],
      },
    });
    expect(result.facets.categories).toEqual([{ category: "transport", count: 47 }]);
    expect(result.ranking).toMatchObject({
      methodology: "trader-news-priority-v1",
      category: "transport",
      archive: true,
      unassessed_count: 2,
      selected_unassessed_count: 1,
    });
    expect(result.page).toEqual({ limit: 3, offset: 0, total: 47, metadata_included: true });
  });

  it("defaults to newest and omits an all-category filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchNews({ limit: 3 });

    const requested = new URL(String(fetchMock.mock.calls[0][0]), "https://claritas.test");
    expect(requested.searchParams.get("sort")).toBe("newest");
    expect(requested.searchParams.has("category")).toBe(false);
    expect(requested.searchParams.has("archive")).toBe(false);
    expect(requested.searchParams.has("include_metadata")).toBe(false);
    expect(result).toMatchObject({
      items: [],
      facets: { categories: [] },
      ranking: {
        sort: "newest",
        archive: false,
        unassessed_count: null,
        selected_unassessed_count: null,
      },
      page: { limit: 3, offset: 0, total: null, metadata_included: false },
    });
  });

  it("preserves nullable metadata on later archive pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        items: [],
        facets: { categories: [] },
        ranking: {
          methodology: "trader-news-priority-v1",
          sort: "importance",
          category: null,
          archive: true,
          assessed_at: null,
          unassessed_count: null,
          selected_unassessed_count: null,
          diversification: "bounded-publisher-penalty-v1",
        },
        page: { limit: 200, offset: 200, total: null, metadata_included: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchNews({
      limit: 200,
      offset: 200,
      archive: true,
      includeMetadata: false,
    });

    const requested = new URL(String(fetchMock.mock.calls[0][0]), "https://claritas.test");
    expect(requested.searchParams.get("archive")).toBe("true");
    expect(requested.searchParams.get("include_metadata")).toBe("false");
    expect(result.ranking.unassessed_count).toBeNull();
    expect(result.ranking.selected_unassessed_count).toBeNull();
    expect(result.page).toEqual({
      limit: 200,
      offset: 200,
      total: null,
      metadata_included: false,
    });
  });
});
