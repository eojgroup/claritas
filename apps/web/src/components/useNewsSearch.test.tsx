// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNews, type NewsFeedResponse } from "../lib/api";
import useNewsSearch from "./useNewsSearch";

vi.mock("../lib/api", () => ({ fetchNews: vi.fn() }));
const fetchMock = vi.mocked(fetchNews);
const response = (id: number): NewsFeedResponse => ({
  items: [{ id, kind: "news", title: `Story ${id}`, summary: null, url: `https://example.com/${id}`, country_iso2: null, event_time: null }],
  page: { limit: 200, offset: 0, total: 1, metadata_included: true },
  ranking: { methodology: "news_importance_v1", sort: "newest", category: null, archive: false, assessed_at: null, unassessed_count: null, selected_unassessed_count: null, diversification: null },
  facets: { categories: [] },
});

beforeEach(() => { vi.useFakeTimers(); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("stored reporting search", () => {
  it("debounces typing and sends the complete research scope to the server", async () => {
    fetchMock.mockResolvedValue(response(77));
    const scope = { country: "GB", category: "markets" as const, language: "fr", sort: "importance" as const, archive: true };
    const { result, rerender } = renderHook(({ q }) => useNewsSearch({ ...scope, q }, true), { initialProps: { q: "" } });
    expect(result.current.loading).toBe(false);
    rerender({ q: "port" });
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender({ q: '"port closure" -exercise' });
    expect(result.current.loading).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ ...scope, q: '"port closure" -exercise', limit: 200 }, expect.any(AbortSignal));
    // Matches may come from stored translations/provenance beyond the loaded headline.
    expect(result.current.response?.items[0].id).toBe(77);
    expect(result.current.loading).toBe(false);
  });

  it("aborts superseded requests and never relabels old results as a new country scope", async () => {
    let resolveOld!: (value: NewsFeedResponse) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    fetchMock.mockResolvedValueOnce(response(2));
    const { result, rerender } = renderHook(({ country }) => useNewsSearch({ q: "energy", country }, true), { initialProps: { country: "US" } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    const oldSignal = fetchMock.mock.calls[0][1];
    rerender({ country: "GB" });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.response).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.response?.items[0].id).toBe(2);
    await act(async () => { resolveOld(response(1)); });
    expect(result.current.response?.items[0].id).toBe(2);
  });

  it("shows service validation errors and can retry without silently treating failure as no matches", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Close the quoted phrase before searching."));
    fetchMock.mockResolvedValueOnce(response(3));
    const { result, rerender } = renderHook(({ enabled }) => useNewsSearch({ q: '"energy' }, enabled), { initialProps: { enabled: true } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.error).toBe("Close the quoted phrase before searching.");
    expect(result.current.loading).toBe(false);
    act(() => result.current.retry());
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.error).toBeNull();
    expect(result.current.response?.items[0].id).toBe(3);
    act(() => result.current.updateItems((items) => items.map((item) => ({ ...item, translated_title: "Translated reporting" }))));
    expect(result.current.response?.items[0].translated_title).toBe("Translated reporting");
    rerender({ enabled: false });
    expect(result.current.response).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchMock.mock.calls[1][1]?.aborted).toBe(true);
  });

  it("pages beyond the first response, deduplicates moving results and retains query metadata", async () => {
    const first = response(1);
    first.items.push(response(2).items[0]);
    first.page.total = 4;
    const second = response(2);
    second.items.push(response(3).items[0]);
    second.page = { ...second.page, offset: 2, total: null, metadata_included: false };
    fetchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { result } = renderHook(() => useNewsSearch({ q: "shipping", archive: true }, true));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.canLoadMore).toBe(true);
    await act(() => result.current.loadMore());
    expect(fetchMock.mock.calls[1][0]).toEqual({ q: "shipping", archive: true, limit: 200, offset: 2, includeMetadata: false });
    expect(result.current.response?.items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(result.current.response?.page.total).toBe(4);
    expect(result.current.canLoadMore).toBe(false);
  });

  it("aborts archive pagination when the reader changes the search query", async () => {
    const first = response(1);
    first.page.total = 400;
    let resolvePage!: (value: NewsFeedResponse) => void;
    fetchMock.mockResolvedValueOnce(first)
      .mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }))
      .mockResolvedValueOnce(response(9));
    const { result, rerender } = renderHook(({ q }) => useNewsSearch({ q }, true), { initialProps: { q: "shipping" } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    let paging!: Promise<void>;
    act(() => { paging = result.current.loadMore(); });
    expect(result.current.loadingMore).toBe(true);
    rerender({ q: "weather" });
    expect(fetchMock.mock.calls[1][1]?.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(300));
    await act(async () => { resolvePage(response(2)); await paging; });
    expect(result.current.response?.items.map((item) => item.id)).toEqual([9]);
  });

  it("bounds accumulated reporting to one thousand stories", async () => {
    for (let page = 0; page < 5; page += 1) {
      const batch = response(page * 200);
      batch.items = Array.from({ length: 200 }, (_, index) => response(page * 200 + index).items[0]);
      batch.page = { ...batch.page, offset: page * 200, total: 2_000 };
      fetchMock.mockResolvedValueOnce(batch);
    }
    const { result } = renderHook(() => useNewsSearch({ q: "energy" }, true));
    await act(() => vi.advanceTimersByTimeAsync(300));
    for (let page = 1; page < 5; page += 1) await act(() => result.current.loadMore());
    expect(result.current.response?.items).toHaveLength(1_000);
    expect(result.current.canLoadMore).toBe(false);
    expect(result.current.atLimit).toBe(true);
    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
