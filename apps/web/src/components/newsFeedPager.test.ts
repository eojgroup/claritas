import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNews, type NewsFeedResponse } from "../lib/api";
import { NewsFeedPager } from "./newsFeedPager";

vi.mock("../lib/api", () => ({ fetchNews: vi.fn() }));
const fetchMock = vi.mocked(fetchNews);
const response = (ids: number[], offset = 0, total: number | null = 300): NewsFeedResponse => ({
  items: ids.map((id) => ({ id, kind: "news", title: `Story ${id}`, summary: null, url: `https://example.test/${id}`, country_iso2: null, event_time: null })),
  page: { limit: 120, offset, total, metadata_included: offset === 0 },
  ranking: { methodology: "news_importance_v1", sort: "newest", category: "markets", archive: true, assessed_at: null, unassessed_count: null, selected_unassessed_count: null, diversification: null },
  facets: { categories: [{ category: "markets", count: total ?? 300 }] },
});

beforeEach(() => fetchMock.mockReset());

describe("bounded news feed paging", () => {
  it("renders one archive page immediately and only fetches another on demand", async () => {
    fetchMock.mockResolvedValueOnce(response([1, 2])).mockResolvedValueOnce(response([2, 3], 2, null));
    const pager = new NewsFeedPager();
    const scope = { country: "SG", archive: true, category: "markets" as const, sort: "newest" as const };
    expect((await pager.load(scope))?.items.map((item) => item.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith({ ...scope, limit: 120, offset: 0 }, expect.any(AbortSignal));
    expect(pager.canLoadMore).toBe(true);
    const next = await pager.loadMore();
    expect(fetchMock.mock.calls[1][0]).toEqual({ ...scope, limit: 120, offset: 2, includeMetadata: false });
    expect(next?.items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(next?.page.total).toBe(300);
    expect(next?.facets.categories).toEqual([{ category: "markets", count: 300 }]);
    // Offset follows fetched rows, including duplicates, rather than unique rows.
    fetchMock.mockResolvedValueOnce(response([4], 4, null));
    await pager.loadMore();
    expect(fetchMock.mock.calls[2][0]?.offset).toBe(4);
  });

  it("aborts an obsolete archive page and cannot append it to the next scope", async () => {
    let resolveOld!: (value: NewsFeedResponse) => void;
    fetchMock.mockResolvedValueOnce(response([1]))
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(response([9], 0, 1));
    const pager = new NewsFeedPager();
    await pager.load({ country: "US", archive: true });
    const oldPage = pager.loadMore();
    await pager.load({ country: "GB", archive: false });
    expect(fetchMock.mock.calls[1][1]?.aborted).toBe(true);
    resolveOld(response([2], 1));
    expect(await oldPage).toBeNull();
    expect(pager.canLoadMore).toBe(false);
  });

  it("retains the loaded page and offset after a failed append so retry recovers", async () => {
    fetchMock.mockResolvedValueOnce(response([1]))
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce(response([2], 1));
    const pager = new NewsFeedPager();
    await pager.load({ archive: true });
    await expect(pager.loadMore()).rejects.toThrow("temporarily unavailable");
    expect(pager.canLoadMore).toBe(true);
    expect((await pager.loadMore())?.items.map((item) => item.id)).toEqual([1, 2]);
    expect(fetchMock.mock.calls[2][0]?.offset).toBe(1);
  });

  it("does not issue concurrent append requests", async () => {
    let resolvePage!: (value: NewsFeedResponse) => void;
    fetchMock.mockResolvedValueOnce(response([1]))
      .mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    const pager = new NewsFeedPager();
    await pager.load({ archive: true });
    const pending = pager.loadMore();
    expect(await pager.loadMore()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvePage(response([2], 1));
    await pending;
  });

  it("stops on a short page without totals and never loops through an archive", async () => {
    fetchMock.mockResolvedValue(response([1], 0, null));
    const pager = new NewsFeedPager();
    await pager.load({ archive: true });
    expect(pager.canLoadMore).toBe(false);
    expect(await pager.loadMore()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds loaded rows and makes the remaining corpus available through narrower scope", async () => {
    fetchMock.mockResolvedValueOnce(response([1, 2])).mockResolvedValueOnce(response([3], 2, null));
    const pager = new NewsFeedPager(2, 3);
    await pager.load({ archive: true });
    const next = await pager.loadMore();
    expect(next?.items).toHaveLength(3);
    expect(fetchMock.mock.calls[1][0]?.limit).toBe(1);
    expect(pager.canLoadMore).toBe(false);
    expect(pager.atLimit).toBe(true);
  });
});
