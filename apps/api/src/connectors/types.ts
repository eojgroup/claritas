export type NormalizedItem = {
  kind: string; // e.g., 'news_article'
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  country_iso2?: string | null;
  event_time?: string | null; // ISO string
  payload: any; // provider-agnostic normalized payload
  external_id?: string | null; // provider id or canonical url
  dedupe_hash?: string | null;
};

export type SourceRow = {
  id: number;
  name: string;
};

export type FeedRow = {
  id: number;
  source_id: number;
  feed_key: string;
  params: any | null;
  cursor: any | null;
};

