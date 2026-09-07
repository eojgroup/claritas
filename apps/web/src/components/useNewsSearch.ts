import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNews, type NewsFeedResponse, type NewsItem } from "../lib/api";

type SearchParams = Pick<NonNullable<Parameters<typeof fetchNews>[0]>,
  "q" | "country" | "language" | "category" | "sort" | "archive">;

type SearchState = {
  key: string;
  response: NewsFeedResponse | null;
  loading: boolean;
  loadingMore: boolean;
  nextOffset: number;
  hasMore: boolean;
  error: string | null;
};

const PAGE_SIZE = 200;
const MAX_LOADED_STORIES = 1_000;

/** Search the stored reporting corpus without replacing the overview feed. */
export default function useNewsSearch(params: SearchParams, enabled: boolean) {
  const key = enabled && params.q?.trim() ? JSON.stringify(params) : "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState>({ key: "", response: null, loading: false, loadingMore: false, nextOffset: 0, hasMore: false, error: null });
  const activeRequestRef = useRef<{ key: string; controller: AbortController; loadingMore: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const activeRequest = { key, controller, loadingMore: false };
    activeRequestRef.current = activeRequest;
    setState((previous) => ({
      key,
      response: previous.key === key ? previous.response : null,
      loading: true,
      loadingMore: false,
      nextOffset: 0,
      hasMore: false,
      error: null,
    }));
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchNews({ ...JSON.parse(key) as SearchParams, limit: PAGE_SIZE }, controller.signal);
        const nextOffset = response.page.offset + response.items.length;
        if (!controller.signal.aborted) setState({
          key,
          response,
          nextOffset,
          hasMore: response.page.total != null ? nextOffset < response.page.total : response.items.length >= PAGE_SIZE,
          loading: false,
          loadingMore: false,
          error: null,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState((previous) => ({
            ...previous,
            key,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeRequestRef.current === activeRequest) activeRequestRef.current = null;
    };
  }, [attempt, key]);

  const loadMore = useCallback(async () => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest || activeRequest.key !== key || activeRequest.loadingMore
      || state.key !== key || !state.response || state.loading || !state.hasMore
      || state.response.items.length >= MAX_LOADED_STORIES) return;
    activeRequest.loadingMore = true;
    setState((previous) => ({ ...previous, loadingMore: true, error: null }));
    const limit = Math.min(PAGE_SIZE, MAX_LOADED_STORIES - state.response.items.length);
    try {
      const page = await fetchNews({
        ...JSON.parse(key) as SearchParams,
        limit,
        offset: state.nextOffset,
        includeMetadata: false,
      }, activeRequest.controller.signal);
      if (activeRequest.controller.signal.aborted) return;
      setState((previous) => {
        if (previous.key !== key || !previous.response) return previous;
        const ids = new Set(previous.response.items.map((item) => item.id));
        const items = [...previous.response.items];
        for (const item of page.items) {
          if (ids.has(item.id)) continue;
          ids.add(item.id);
          items.push(item);
        }
        const nextOffset = page.page.offset + page.items.length;
        return {
          ...previous,
          response: { ...previous.response, items: items.slice(0, MAX_LOADED_STORIES) },
          nextOffset,
          hasMore: page.items.length > 0 && (previous.response.page.total != null
            ? nextOffset < previous.response.page.total
            : page.items.length >= limit),
          loadingMore: false,
        };
      });
    } catch (error) {
      if (!activeRequest.controller.signal.aborted) {
        setState((previous) => ({ ...previous, loadingMore: false, error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      activeRequest.loadingMore = false;
    }
  }, [key, state]);

  const updateItems = useCallback((update: (items: NewsItem[]) => NewsItem[]) => {
    setState((previous) => previous.response
      ? { ...previous, response: { ...previous.response, items: update(previous.response.items) } }
      : previous);
  }, []);
  const retry = useCallback(() => setAttempt((previous) => previous + 1), []);
  const matchesScope = Boolean(key && state.key === key);
  return {
    response: matchesScope ? state.response : null,
    loading: Boolean(key && (!matchesScope || state.loading)),
    loadingMore: matchesScope && state.loadingMore,
    canLoadMore: matchesScope && !state.loading && state.hasMore && (state.response?.items.length ?? 0) < MAX_LOADED_STORIES,
    atLimit: matchesScope && state.hasMore && (state.response?.items.length ?? 0) >= MAX_LOADED_STORIES,
    error: matchesScope ? state.error : null,
    loadMore,
    retry,
    updateItems,
  };
}
