import { fetchNews, type NewsFeedResponse } from "../lib/api";

type FeedParams = NonNullable<Parameters<typeof fetchNews>[0]>;
type Session = {
  controller: AbortController;
  params: FeedParams;
  response: NewsFeedResponse | null;
  nextOffset: number;
  hasMore: boolean;
  loadingMore: boolean;
};

/** One bounded page per reader action, with scope cancellation and stable metadata. */
export class NewsFeedPager {
  private session: Session | null = null;

  constructor(private readonly pageSize = 120, readonly maxItems = 1_000) {}

  get canLoadMore() {
    return Boolean(this.session?.response && this.session.hasMore
      && this.session.response.items.length < this.maxItems);
  }

  get atLimit() {
    return Boolean(this.session?.response && this.session.hasMore
      && this.session.response.items.length >= this.maxItems);
  }

  cancel() {
    this.session?.controller.abort();
    this.session = null;
  }

  async load(params: FeedParams): Promise<NewsFeedResponse | null> {
    this.cancel();
    const session: Session = {
      controller: new AbortController(), params, response: null,
      nextOffset: 0, hasMore: false, loadingMore: false,
    };
    this.session = session;
    const response = await fetchNews({ ...params, limit: this.pageSize, offset: 0 }, session.controller.signal);
    if (this.session !== session || session.controller.signal.aborted) return null;
    session.response = response;
    session.nextOffset = response.page.offset + response.items.length;
    session.hasMore = this.hasNextPage(session, response, this.pageSize);
    return response;
  }

  async loadMore(): Promise<NewsFeedResponse | null> {
    const session = this.session;
    if (!session?.response || !this.canLoadMore || session.loadingMore) return null;
    session.loadingMore = true;
    try {
      const limit = Math.min(this.pageSize, this.maxItems - session.response.items.length);
      const page = await fetchNews({
        ...session.params, limit, offset: session.nextOffset, includeMetadata: false,
      }, session.controller.signal);
      if (this.session !== session || session.controller.signal.aborted) return null;
      session.nextOffset = page.page.offset + page.items.length;
      session.hasMore = this.hasNextPage(session, page, limit);
      const ids = new Set(session.response.items.map((item) => item.id));
      const additions = page.items.filter((item) => {
        if (ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
      });
      session.response = { ...session.response, items: [...session.response.items, ...additions].slice(0, this.maxItems) };
      return session.response;
    } finally {
      session.loadingMore = false;
    }
  }

  private hasNextPage(session: Session, page: NewsFeedResponse, limit: number) {
    const total = session.response?.page.total ?? page.page.total;
    return page.items.length > 0 && (total != null
      ? session.nextOffset < total
      : page.items.length >= limit);
  }
}
