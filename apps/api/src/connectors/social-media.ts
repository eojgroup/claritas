import { query } from "../db";

export const SOCIAL_SIGNAL_WARNING =
  "Unverified social-media claim. Account attribution and platform verification do not establish factual accuracy.";

export type SocialPlatform = "x" | "reddit" | "youtube" | "bluesky";

export type SocialEngagement = {
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  views?: number;
  score?: number;
  comments?: number;
  upvote_ratio?: number;
};

export type SocialMediaAsset = {
  type: "image" | "video" | "thumbnail" | "external";
  url: string;
  preview_url?: string | null;
  alt_text?: string | null;
};

export type NormalizedSocialSignal = {
  platform: SocialPlatform;
  externalId: string;
  text: string;
  title: string | null;
  url: string;
  postedAt: string;
  languageCode: string | null;
  countryIso2: string | null;
  countryAttribution: Record<string, unknown>;
  author: {
    accountId: string;
    handle: string | null;
    displayName: string | null;
    profileUrl: string | null;
    avatarUrl: string | null;
    platformVerified: boolean | null;
  };
  responsibleParty: {
    name: string;
    accountId: string;
    type: "account_holder";
    attributionBasis: "platform_account";
  };
  engagement: SocialEngagement;
  media: SocialMediaAsset[];
  providerMetadata: Record<string, unknown>;
};

export type SocialProviderStatus = {
  id: SocialPlatform;
  label: string;
  enabled: boolean;
  configured: boolean;
  available: boolean;
  authentication: "none" | "bearer_token" | "oauth_client_credentials" | "api_key";
  required_environment: string[];
  access_note: string;
};

export type SocialIngestOptions = {
  queries: string[];
  maxResultsPerQuery?: number;
  lookbackHours?: number;
};

export type SocialIngestResult = {
  provider: SocialPlatform;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  requests: number;
  successful_queries: number;
  failed_queries: number;
  http_failures: number;
  db_errors: number;
  latest_posted_at: string | null;
  retention_days: number;
  content_classification: "unverified_social_claim";
};

const BLUESKY_APPVIEW_ORIGINS = [
  "https://public.api.bsky.app",
  "https://api.bsky.app",
] as const;

const BLUESKY_SENSITIVE_LABELS = new Set([
  "adult",
  "graphic-media",
  "nudity",
  "porn",
  "sexual",
]);

type PersistedSocialSignalRow = {
  id: number;
  linked_events?: Array<{ id: string; title: string; country_iso2: string | null; rationale: string }>;
  platform: SocialPlatform;
  content_type: "social_post";
  signal_nature: "claim";
  verification_status: "unverified" | "corroborated" | "disputed";
  content_text: string;
  title: string | null;
  url: string;
  language_code: string | null;
  country_iso2: string | null;
  country_attribution: Record<string, unknown> | null;
  posted_at: string | Date;
  acquired_at: string | Date;
  author_account_id: string;
  author_handle: string | null;
  author_display_name: string | null;
  author_profile_url: string | null;
  author_avatar_url: string | null;
  author_platform_verified: boolean | null;
  responsible_party_name: string;
  responsible_party_account_id: string;
  responsible_party_type: "account_holder";
  responsibility_basis: "platform_account";
  engagement: SocialEngagement | null;
  media: SocialMediaAsset[] | null;
  topics: string[] | null;
  payload: Record<string, unknown> | null;
};

const PROVIDER_DETAILS: Record<SocialPlatform, Omit<SocialProviderStatus, "enabled" | "configured" | "available">> = {
  x: {
    id: "x",
    label: "X",
    authentication: "bearer_token",
    required_environment: ["X_BEARER_TOKEN"],
    access_note: "Requires an approved X developer app and an API plan that includes recent search.",
  },
  reddit: {
    id: "reddit",
    label: "Reddit",
    authentication: "oauth_client_credentials",
    required_environment: [
      "REDDIT_CLIENT_ID",
      "REDDIT_CLIENT_SECRET",
      "REDDIT_USER_AGENT",
      "REDDIT_API_APPROVED=true",
    ],
    access_note: "Commercial use requires Reddit approval and a contract; the connector is hard-gated until approval is recorded.",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    authentication: "api_key",
    required_environment: ["YOUTUBE_API_KEY"],
    access_note: "Uses YouTube Data API v3 search and video metadata; search consumes project quota.",
  },
  bluesky: {
    id: "bluesky",
    label: "Bluesky",
    authentication: "none",
    required_environment: [],
    access_note: "Uses the public Bluesky AppView search endpoint; no API key is required.",
  },
};

const SOURCE_DETAILS: Record<SocialPlatform, {
  name: string;
  baseUrl: string;
  authType: string;
  homepage: string;
}> = {
  x: { name: "x_social", baseUrl: "https://api.x.com/2", authType: "bearer_token", homepage: "https://x.com" },
  reddit: { name: "reddit_social", baseUrl: "https://oauth.reddit.com", authType: "oauth2", homepage: "https://www.reddit.com" },
  youtube: { name: "youtube_social", baseUrl: "https://www.googleapis.com/youtube/v3", authType: "api_key", homepage: "https://www.youtube.com" },
  bluesky: { name: "bluesky_social", baseUrl: "https://public.api.bsky.app", authType: "none", homepage: "https://bsky.app" },
};

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), min), max) : fallback;
}

function enabledByEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(raw);
}

function explicitlyApprovedByEnv(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function configuredRedditUserAgent(): string | null {
  const value = process.env.REDDIT_USER_AGENT?.trim();
  if (
    !value
    || /(?:replace[- _]?with|replace[- _]?me|change[- _]?me|approved[- _]?operator|placeholder|your[- _]?(?:username|user|email|company))/i.test(value)
  ) return null;
  return value;
}

function cleanText(value: unknown, maxLength = 20_000): string | null {
  if (typeof value !== "string") return null;
  const decoded = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const normalized = decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength).trim() : null;
}

function safeHttpsUrl(value: unknown, allowedHosts?: string[]): string | null {
  const raw = cleanText(value, 4_000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    if (allowedHosts && !allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const millis = typeof value === "number" ? value * 1_000 : Date.parse(value);
  if (!Number.isFinite(millis) || millis <= 0 || millis > Date.now() + 5 * 60_000) return null;
  return new Date(millis).toISOString();
}

function finiteCount(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.trunc(parsed);
}

function finiteRatio(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function normalizedLanguage(value: unknown): string | null {
  const raw = cleanText(value, 32)?.toLowerCase().replace(/_/g, "-") ?? null;
  return raw && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(raw) ? raw : null;
}

function normalizedCountry(value: unknown): string | null {
  const raw = cleanText(value, 2)?.toUpperCase() ?? null;
  return raw && /^[A-Z]{2}$/.test(raw) ? raw : null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function records(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.map(record).filter((entry) => Object.keys(entry).length > 0) : [];
}

function responsibility(author: NormalizedSocialSignal["author"]): NormalizedSocialSignal["responsibleParty"] {
  return {
    name: author.displayName || author.handle || author.accountId,
    accountId: author.accountId,
    type: "account_holder",
    attributionBasis: "platform_account",
  };
}

export function getSocialProviderStatuses(): SocialProviderStatus[] {
  const xConfigured = Boolean(process.env.X_BEARER_TOKEN?.trim());
  const redditApproved = explicitlyApprovedByEnv("REDDIT_API_APPROVED");
  const redditCredentials = Boolean(
    process.env.REDDIT_CLIENT_ID?.trim()
      && process.env.REDDIT_CLIENT_SECRET?.trim()
      && configuredRedditUserAgent(),
  );
  const youtubeConfigured = Boolean(process.env.YOUTUBE_API_KEY?.trim());
  const state: Record<SocialPlatform, { enabled: boolean; configured: boolean }> = {
    x: { enabled: enabledByEnv("SOCIAL_X_ENABLED", true), configured: xConfigured },
    reddit: {
      enabled: enabledByEnv("SOCIAL_REDDIT_ENABLED", false),
      configured: redditApproved && redditCredentials,
    },
    youtube: { enabled: enabledByEnv("SOCIAL_YOUTUBE_ENABLED", true), configured: youtubeConfigured },
    bluesky: { enabled: enabledByEnv("SOCIAL_BLUESKY_ENABLED", true), configured: true },
  };
  return (["x", "reddit", "youtube", "bluesky"] as const).map((platform) => ({
    ...PROVIDER_DETAILS[platform],
    ...state[platform],
    available: state[platform].enabled && state[platform].configured,
  }));
}

export function configuredSocialQueries(): string[] {
  const raw = process.env.SOCIAL_DISCOVERY_QUERIES?.trim();
  if (!raw) return ["geopolitics", "security", "markets", "transport disruption", "extreme weather"];
  let values: unknown[];
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed : [];
  } catch {
    values = raw.split(/[|,\n]/g);
  }
  return Array.from(new Set(
    values
      .map((value) => cleanText(value, 512))
      .filter((value): value is string => Boolean(value)),
  )).slice(0, 10);
}

export function buildXSearchUrl(searchQuery: string, maxResults: number): string {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  const queryText = cleanText(searchQuery, 480) || "geopolitics";
  url.searchParams.set("query", `${queryText} -is:retweet`);
  url.searchParams.set("max_results", String(boundedInt(maxResults, 10, 100, 25)));
  url.searchParams.set("tweet.fields", "author_id,created_at,lang,public_metrics,possibly_sensitive,conversation_id,entities,geo");
  url.searchParams.set("expansions", "author_id,geo.place_id,attachments.media_keys");
  url.searchParams.set("user.fields", "id,name,username,profile_image_url,verified,verified_type");
  url.searchParams.set("place.fields", "id,name,full_name,country,country_code,geo");
  url.searchParams.set("media.fields", "media_key,type,url,preview_image_url,alt_text,width,height");
  return url.toString();
}

export function normalizeXPost(rawPost: unknown, rawIncludes: unknown): NormalizedSocialSignal | null {
  const post = record(rawPost);
  const includes = record(rawIncludes);
  const id = cleanText(post.id, 128);
  const content = cleanText(post.text);
  const postedAt = isoTimestamp(post.created_at);
  const authorId = cleanText(post.author_id, 256);
  if (!id || !content || !postedAt || !authorId || post.possibly_sensitive === true) return null;
  const authorRaw = records(includes.users).find((candidate) => String(candidate.id) === authorId) ?? {};
  const username = cleanText(authorRaw.username, 100);
  const handle = username ? `@${username}` : null;
  const author: NormalizedSocialSignal["author"] = {
    accountId: authorId,
    handle,
    displayName: cleanText(authorRaw.name, 300),
    profileUrl: username ? `https://x.com/${encodeURIComponent(username)}` : null,
    avatarUrl: safeHttpsUrl(authorRaw.profile_image_url),
    platformVerified: typeof authorRaw.verified === "boolean" ? authorRaw.verified : null,
  };
  const placeId = cleanText(record(post.geo).place_id, 256);
  const place = placeId
    ? records(includes.places).find((candidate) => String(candidate.id) === placeId) ?? {}
    : {};
  const countryIso2 = normalizedCountry(place.country_code);
  const mediaByKey = new Map(records(includes.media).map((entry) => [String(entry.media_key), entry]));
  const media: SocialMediaAsset[] = [];
  const mediaKeys = Array.isArray(record(post.attachments).media_keys) ? record(post.attachments).media_keys : [];
  for (const key of mediaKeys.slice(0, 8)) {
    const entry = mediaByKey.get(String(key));
    if (!entry) continue;
    const url = safeHttpsUrl(entry.url) || safeHttpsUrl(entry.preview_image_url);
    if (!url) continue;
    media.push({
      type: entry.type === "video" || entry.type === "animated_gif" ? "video" : "image",
      url,
      preview_url: safeHttpsUrl(entry.preview_image_url),
      alt_text: cleanText(entry.alt_text, 2_000),
    });
  }
  const metrics = record(post.public_metrics);
  return {
    platform: "x",
    externalId: id,
    text: content,
    title: null,
    url: username ? `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(id)}` : `https://x.com/i/web/status/${encodeURIComponent(id)}`,
    postedAt,
    languageCode: normalizedLanguage(post.lang),
    countryIso2,
    countryAttribution: countryIso2 ? {
      method: "provider_geotag",
      place_id: placeId,
      place_name: cleanText(place.full_name ?? place.name, 500),
      country_name: cleanText(place.country, 200),
    } : {},
    author,
    responsibleParty: responsibility(author),
    engagement: {
      likes: finiteCount(metrics.like_count),
      replies: finiteCount(metrics.reply_count),
      reposts: finiteCount(metrics.retweet_count),
      quotes: finiteCount(metrics.quote_count),
    },
    media,
    providerMetadata: {
      conversation_id: cleanText(post.conversation_id, 128),
      possibly_sensitive: typeof post.possibly_sensitive === "boolean" ? post.possibly_sensitive : null,
      verified_type: cleanText(authorRaw.verified_type, 80),
    },
  };
}

function blueskyPostUrl(uri: string, handleOrDid: string): string | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  return match
    ? `https://bsky.app/profile/${encodeURIComponent(handleOrDid || match[1])}/post/${encodeURIComponent(match[2])}`
    : null;
}

export function buildBlueskySearchUrl(
  searchQuery: string,
  maxResults: number,
  origin: string = BLUESKY_APPVIEW_ORIGINS[0],
): string {
  if (!(BLUESKY_APPVIEW_ORIGINS as readonly string[]).includes(origin)) {
    throw new Error("Unsupported Bluesky AppView origin.");
  }
  const url = new URL("/xrpc/app.bsky.feed.searchPosts", origin);
  url.searchParams.set("q", cleanText(searchQuery, 512) || "geopolitics");
  url.searchParams.set("sort", "latest");
  url.searchParams.set("limit", String(boundedInt(maxResults, 1, 100, 25)));
  return url.toString();
}

export function normalizeBlueskyPost(rawPost: unknown): NormalizedSocialSignal | null {
  const post = record(rawPost);
  const postRecord = record(post.record);
  const authorRaw = record(post.author);
  const uri = cleanText(post.uri, 1_000);
  const content = cleanText(postRecord.text);
  // `record.createdAt` is supplied by the posting client. `indexedAt` is the
  // AppView-observed timestamp and therefore the defensible chronology anchor.
  const postedAt = isoTimestamp(post.indexedAt);
  const did = cleanText(authorRaw.did, 256);
  const username = cleanText(authorRaw.handle, 253);
  const url = uri && did ? blueskyPostUrl(uri, username || did) : null;
  const labels = [...records(post.labels), ...records(authorRaw.labels)];
  const isSensitive = labels.some((label) => {
    const value = cleanText(label.val, 80)?.toLowerCase();
    return value ? BLUESKY_SENSITIVE_LABELS.has(value) : false;
  });
  if (!uri || !content || !postedAt || !did || !url || isSensitive) return null;
  const handle = username ? `@${username}` : null;
  const verification = record(authorRaw.verification);
  const verifiedStatus = cleanText(verification.verifiedStatus, 80);
  const author: NormalizedSocialSignal["author"] = {
    accountId: did,
    handle,
    displayName: cleanText(authorRaw.displayName, 300),
    profileUrl: `https://bsky.app/profile/${encodeURIComponent(username || did)}`,
    avatarUrl: safeHttpsUrl(authorRaw.avatar),
    platformVerified: verifiedStatus ? verifiedStatus === "valid" : null,
  };
  const media: SocialMediaAsset[] = [];
  const embed = record(post.embed);
  for (const image of records(embed.images).slice(0, 8)) {
    const imageUrl = safeHttpsUrl(image.fullsize) || safeHttpsUrl(image.thumb);
    if (imageUrl) media.push({
      type: "image",
      url: imageUrl,
      preview_url: safeHttpsUrl(image.thumb),
      alt_text: cleanText(image.alt, 2_000),
    });
  }
  const external = record(embed.external);
  const externalUrl = safeHttpsUrl(external.uri);
  if (externalUrl) media.push({
    type: "external",
    url: externalUrl,
    preview_url: safeHttpsUrl(external.thumb),
    alt_text: cleanText(external.title, 500),
  });
  return {
    platform: "bluesky",
    externalId: uri,
    text: content,
    title: null,
    url,
    postedAt,
    languageCode: normalizedLanguage(Array.isArray(postRecord.langs) ? postRecord.langs[0] : null),
    countryIso2: null,
    countryAttribution: {},
    author,
    responsibleParty: responsibility(author),
    engagement: {
      likes: finiteCount(post.likeCount),
      replies: finiteCount(post.replyCount),
      reposts: finiteCount(post.repostCount),
      quotes: finiteCount(post.quoteCount),
    },
    media,
    providerMetadata: {
      cid: cleanText(post.cid, 256),
      indexed_at: isoTimestamp(post.indexedAt),
      authored_at: isoTimestamp(postRecord.createdAt),
      verified_status: verifiedStatus,
    },
  };
}

export function buildYouTubeSearchUrl(searchQuery: string, maxResults: number, publishedAfter: string): string {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error("YouTube selected but YOUTUBE_API_KEY is not configured.");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "date");
  url.searchParams.set("q", cleanText(searchQuery, 512) || "geopolitics");
  url.searchParams.set("maxResults", String(boundedInt(maxResults, 1, 50, 25)));
  url.searchParams.set("publishedAfter", publishedAfter);
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("key", apiKey);
  return url.toString();
}

export function normalizeYouTubeVideo(rawVideo: unknown): NormalizedSocialSignal | null {
  const video = record(rawVideo);
  const snippet = record(video.snippet);
  const statistics = record(video.statistics);
  const id = cleanText(video.id, 128);
  const title = cleanText(snippet.title, 2_000);
  const description = cleanText(snippet.description);
  const postedAt = isoTimestamp(snippet.publishedAt);
  const channelId = cleanText(snippet.channelId, 256);
  const channelTitle = cleanText(snippet.channelTitle, 500);
  if (!id || !title || !postedAt || !channelId) return null;
  const author: NormalizedSocialSignal["author"] = {
    accountId: channelId,
    handle: null,
    displayName: channelTitle,
    profileUrl: `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`,
    avatarUrl: null,
    // YouTube Data API does not expose a general channel verification flag.
    platformVerified: null,
  };
  const thumbnails = record(snippet.thumbnails);
  const thumbnail = record(thumbnails.maxres ?? thumbnails.high ?? thumbnails.medium ?? thumbnails.default);
  const thumbnailUrl = safeHttpsUrl(thumbnail.url, ["ytimg.com", "ggpht.com"]);
  return {
    platform: "youtube",
    externalId: id,
    text: description || title,
    title,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    postedAt,
    languageCode: normalizedLanguage(snippet.defaultLanguage ?? snippet.defaultAudioLanguage),
    countryIso2: null,
    countryAttribution: {},
    author,
    responsibleParty: responsibility(author),
    engagement: {
      likes: finiteCount(statistics.likeCount),
      comments: finiteCount(statistics.commentCount),
      views: finiteCount(statistics.viewCount),
    },
    media: thumbnailUrl ? [{ type: "thumbnail", url: thumbnailUrl }] : [],
    providerMetadata: {
      format: "video",
      category_id: cleanText(snippet.categoryId, 64),
      live_broadcast_content: cleanText(snippet.liveBroadcastContent, 80),
    },
  };
}

export function buildRedditSearchUrl(searchQuery: string, maxResults: number, lookbackHours: number): string {
  const url = new URL("https://oauth.reddit.com/search");
  url.searchParams.set("q", cleanText(searchQuery, 512) || "geopolitics");
  url.searchParams.set("sort", "new");
  url.searchParams.set("type", "link");
  url.searchParams.set("limit", String(boundedInt(maxResults, 1, 100, 25)));
  url.searchParams.set("t", boundedInt(lookbackHours, 1, 168, 24) <= 24 ? "day" : "week");
  url.searchParams.set("raw_json", "1");
  return url.toString();
}

export function normalizeRedditPost(rawPost: unknown): NormalizedSocialSignal | null {
  const post = record(rawPost);
  const id = cleanText(post.id, 128);
  const title = cleanText(post.title, 2_000);
  const body = cleanText(post.selftext);
  const authorName = cleanText(post.author, 100);
  const authorId = cleanText(post.author_fullname, 256) || authorName;
  const postedAt = isoTimestamp(post.created_utc);
  const permalink = cleanText(post.permalink, 2_000);
  if (
    !id
    || !title
    || !authorName
    || authorName === "[deleted]"
    || !authorId
    || !postedAt
    || !permalink
    || post.over_18 === true
    || !permalink.startsWith("/")
    || permalink.startsWith("//")
  ) {
    return null;
  }
  let postUrl: string;
  try {
    const resolved = new URL(permalink, "https://www.reddit.com");
    // WHATWG treats backslashes as path separators for special schemes, so a
    // value such as `/\\evil.example` can otherwise escape the expected host.
    if (resolved.protocol !== "https:" || resolved.hostname !== "www.reddit.com") return null;
    postUrl = resolved.toString();
  } catch {
    return null;
  }
  const author: NormalizedSocialSignal["author"] = {
    accountId: authorId,
    handle: `u/${authorName}`,
    displayName: authorName,
    profileUrl: `https://www.reddit.com/user/${encodeURIComponent(authorName)}`,
    avatarUrl: null,
    platformVerified: null,
  };
  const thumbnail = safeHttpsUrl(post.thumbnail);
  return {
    platform: "reddit",
    externalId: id,
    text: body || title,
    title,
    url: postUrl,
    postedAt,
    languageCode: null,
    countryIso2: null,
    countryAttribution: {},
    author,
    responsibleParty: responsibility(author),
    engagement: {
      score: finiteCount(post.score),
      comments: finiteCount(post.num_comments),
      upvote_ratio: finiteRatio(post.upvote_ratio),
    },
    media: thumbnail ? [{ type: "thumbnail", url: thumbnail }] : [],
    providerMetadata: {
      community: cleanText(post.subreddit_name_prefixed, 300) || (cleanText(post.subreddit, 300) ? `r/${cleanText(post.subreddit, 300)}` : null),
      is_self: typeof post.is_self === "boolean" ? post.is_self : null,
      over_18: typeof post.over_18 === "boolean" ? post.over_18 : null,
      outbound_url: safeHttpsUrl(post.url),
    },
  };
}

async function fetchJson(url: string, init: RequestInit, provider: string): Promise<Record<string, any>> {
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch {
      if (attempt === 2) {
        // Do not propagate the request URL: YouTube authenticates with a query
        // parameter, so a raw network error could otherwise disclose its key.
        throw new Error(`${provider} request failed after bounded retries.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    const body = await response.text();
    if (response.ok) {
      try {
        return record(JSON.parse(body));
      } catch {
        throw new Error(`${provider} returned invalid JSON.`);
      }
    }
    lastStatus = response.status;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    const retrySeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const waitMs = Number.isFinite(retrySeconds) ? Math.min(retrySeconds * 1_000, 10_000) : 500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  // Upstream response bodies are intentionally omitted from durable run logs.
  // They are not part of our API contract and may echo provider credentials.
  throw new Error(`${provider} HTTP ${lastStatus ?? "unknown"}.`);
}

async function ensureSocialSource(platform: SocialPlatform): Promise<number> {
  const source = SOURCE_DETAILS[platform];
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (name) DO UPDATE SET
       api_base_url=EXCLUDED.api_base_url,
       auth_type=EXCLUDED.auth_type,
       metadata=EXCLUDED.metadata
     RETURNING id`,
    [source.name, source.baseUrl, source.authType, JSON.stringify({
      provider: platform,
      source_kind: "social_signal",
      homepage: source.homepage,
      content_classification: "unverified_social_claim",
      trust_policy: "Account attribution proves only that the platform associated the message with the account; content requires independent corroboration.",
    })],
  );
  return rows[0].id;
}

function retentionDays(): number {
  return boundedInt(process.env.SOCIAL_RETENTION_DAYS, 1, 30, 7);
}

async function persistSocialSignal(
  sourceId: number,
  signal: NormalizedSocialSignal,
  discoveryQuery: string,
  retrievedAt: string,
): Promise<boolean> {
  const expiresAt = new Date(Date.parse(retrievedAt) + retentionDays() * 86_400_000).toISOString();
  const payload = {
    provider: signal.platform,
    acquisition_method: "official_api",
    discovery_query: discoveryQuery,
    retrieved_at: retrievedAt,
    provider_metadata: signal.providerMetadata,
    classification: {
      content_type: "social_post",
      signal_nature: "claim",
      verification_status: "unverified",
      is_fact: false,
    },
  };
  const { rows } = await query<{ inserted: boolean }>(
    `INSERT INTO social_signal (
       source_id,external_id,platform,content_type,signal_nature,verification_status,
       content_text,title,url,language_code,country_iso2,country_attribution,
       posted_at,acquired_at,author_account_id,author_handle,author_display_name,
       author_profile_url,author_avatar_url,author_platform_verified,
       responsible_party_name,responsible_party_account_id,responsible_party_type,
       responsibility_basis,engagement,media,topics,payload,expires_at
     ) VALUES (
       $1,$2,$3,'social_post','claim','unverified',$4,$5,$6,$7,
       (SELECT iso2 FROM country WHERE iso2=$8::char(2)),$9::jsonb,
       $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'account_holder',
       'platform_account',$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24
     )
     ON CONFLICT (source_id,external_id) DO UPDATE SET
       content_text=EXCLUDED.content_text,title=EXCLUDED.title,url=EXCLUDED.url,
       language_code=EXCLUDED.language_code,country_iso2=EXCLUDED.country_iso2,
       country_attribution=EXCLUDED.country_attribution,posted_at=EXCLUDED.posted_at,
       acquired_at=EXCLUDED.acquired_at,author_account_id=EXCLUDED.author_account_id,
       author_handle=EXCLUDED.author_handle,author_display_name=EXCLUDED.author_display_name,
       author_profile_url=EXCLUDED.author_profile_url,author_avatar_url=EXCLUDED.author_avatar_url,
       author_platform_verified=EXCLUDED.author_platform_verified,
       responsible_party_name=EXCLUDED.responsible_party_name,
       responsible_party_account_id=EXCLUDED.responsible_party_account_id,
       engagement=EXCLUDED.engagement,media=EXCLUDED.media,
       topics=(
         SELECT COALESCE(jsonb_agg(topic ORDER BY topic),'[]'::jsonb)
         FROM (
           SELECT DISTINCT jsonb_array_elements_text(social_signal.topics||EXCLUDED.topics) AS topic
         ) distinct_topics
       ),
       payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,updated_at=now()
     RETURNING (xmax=0) AS inserted`,
    [
      sourceId, signal.externalId, signal.platform, signal.text, signal.title, signal.url,
      signal.languageCode, signal.countryIso2, JSON.stringify(signal.countryAttribution),
      signal.postedAt, retrievedAt, signal.author.accountId, signal.author.handle,
      signal.author.displayName, signal.author.profileUrl, signal.author.avatarUrl,
      signal.author.platformVerified, signal.responsibleParty.name,
      signal.responsibleParty.accountId, JSON.stringify(signal.engagement),
      JSON.stringify(signal.media), JSON.stringify([discoveryQuery]), JSON.stringify(payload), expiresAt,
    ],
  );
  return Boolean(rows[0]?.inserted);
}

async function pruneExpiredSocialSignals(): Promise<number> {
  const { rows } = await query<{ deleted: number }>(
    `WITH deleted AS (
       DELETE FROM social_signal WHERE expires_at <= now() RETURNING 1
     ) SELECT COUNT(*)::int AS deleted FROM deleted`,
  );
  return Number(rows[0]?.deleted ?? 0);
}

async function xSignals(searchQuery: string, maxResults: number): Promise<NormalizedSocialSignal[]> {
  const bearer = process.env.X_BEARER_TOKEN?.trim();
  if (!bearer) throw new Error("X selected but X_BEARER_TOKEN is not configured.");
  const response = await fetchJson(buildXSearchUrl(searchQuery, maxResults), {
    headers: { authorization: `Bearer ${bearer}`, accept: "application/json" },
  }, "X recent search");
  return (Array.isArray(response.data) ? response.data : [])
    .map((post) => normalizeXPost(post, response.includes))
    .filter((post): post is NormalizedSocialSignal => Boolean(post))
    .slice(0, maxResults);
}

export async function fetchBlueskySignals(
  searchQuery: string,
  maxResults: number,
): Promise<{ signals: NormalizedSocialSignal[]; requests: number }> {
  let requests = 0;
  let lastError: unknown = null;
  for (const origin of BLUESKY_APPVIEW_ORIGINS) {
    requests += 1;
    try {
      const response = await fetchJson(buildBlueskySearchUrl(searchQuery, maxResults, origin), {
        headers: { accept: "application/json", "user-agent": process.env.SOCIAL_USER_AGENT?.trim() || "Claritas/1.0 (+https://app.claritas.info)" },
      }, `Bluesky AppView (${new URL(origin).hostname})`);
      return {
        signals: (Array.isArray(response.posts) ? response.posts : [])
          .map(normalizeBlueskyPost)
          .filter((post): post is NormalizedSocialSignal => Boolean(post)),
        requests,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Bluesky AppView request failed through all allowlisted origins.");
}

async function youtubeSignals(searchQuery: string, maxResults: number, publishedAfter: string): Promise<NormalizedSocialSignal[]> {
  const search = await fetchJson(buildYouTubeSearchUrl(searchQuery, maxResults, publishedAfter), {
    headers: { accept: "application/json" },
  }, "YouTube search");
  const videoIds = records(search.items)
    .map((item) => cleanText(record(item.id).videoId, 128))
    .filter((id): id is string => Boolean(id));
  if (videoIds.length === 0) return [];
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error("YouTube selected but YOUTUBE_API_KEY is not configured.");
  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "snippet,statistics,status");
  detailsUrl.searchParams.set("id", videoIds.join(","));
  detailsUrl.searchParams.set("key", apiKey);
  const details = await fetchJson(detailsUrl.toString(), { headers: { accept: "application/json" } }, "YouTube videos");
  return records(details.items)
    .filter((video) => record(video.status).privacyStatus !== "private")
    .map(normalizeYouTubeVideo)
    .filter((post): post is NormalizedSocialSignal => Boolean(post));
}

let redditTokenCache: { token: string; expiresAt: number } | null = null;

async function redditAccessToken(): Promise<string> {
  if (redditTokenCache && redditTokenCache.expiresAt > Date.now() + 60_000) return redditTokenCache.token;
  if (!explicitlyApprovedByEnv("REDDIT_API_APPROVED")) {
    throw new Error("Reddit selected but REDDIT_API_APPROVED=true is not configured; explicit approval is required.");
  }
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = configuredRedditUserAgent();
  if (!clientId || !clientSecret || !userAgent) {
    throw new Error("Reddit selected but REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT are not configured.");
  }
  const response = await fetchJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body: "grant_type=client_credentials",
  }, "Reddit OAuth");
  const token = cleanText(response.access_token, 4_000);
  if (!token) throw new Error("Reddit OAuth response did not include an access token.");
  const expiresIn = boundedInt(response.expires_in, 60, 86_400, 3_600);
  redditTokenCache = { token, expiresAt: Date.now() + expiresIn * 1_000 };
  return token;
}

async function redditSignals(searchQuery: string, maxResults: number, lookbackHours: number): Promise<NormalizedSocialSignal[]> {
  const token = await redditAccessToken();
  const userAgent = configuredRedditUserAgent();
  if (!userAgent) throw new Error("Reddit selected but REDDIT_USER_AGENT is not explicitly configured.");
  const response = await fetchJson(buildRedditSearchUrl(searchQuery, maxResults, lookbackHours), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": userAgent },
  }, "Reddit search");
  return records(record(response.data).children)
    .map((child) => normalizeRedditPost(child.data))
    .filter((post): post is NormalizedSocialSignal => Boolean(post));
}

export async function ingestSocialProvider(
  platform: SocialPlatform,
  options: SocialIngestOptions,
): Promise<SocialIngestResult> {
  const provider = getSocialProviderStatuses().find((candidate) => candidate.id === platform);
  if (!provider?.enabled) throw new Error(`${PROVIDER_DETAILS[platform].label} social ingestion is disabled.`);
  if (!provider.configured) {
    throw new Error(`${PROVIDER_DETAILS[platform].label} social ingestion is not configured: ${provider.required_environment.join(", ") || "provider access unavailable"}.`);
  }
  const queries = Array.from(new Set(options.queries.map((value) => cleanText(value, 512)).filter((value): value is string => Boolean(value)))).slice(0, 10);
  if (queries.length === 0) throw new Error("At least one social discovery query is required.");
  const maxResults = boundedInt(options.maxResultsPerQuery, 1, 100, 25);
  const lookbackHours = boundedInt(options.lookbackHours, 1, 168, 24);
  const cutoffMs = Date.now() - lookbackHours * 3_600_000;
  const publishedAfter = new Date(cutoffMs).toISOString();
  const sourceId = await ensureSocialSource(platform);
  const retrievedAt = new Date().toISOString();
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let requests = 0;
  let successfulQueries = 0;
  let failedQueries = 0;
  let httpFailures = 0;
  let dbErrors = 0;
  let latestPostedAt: string | null = null;

  for (const discoveryQuery of queries) {
    let signals: NormalizedSocialSignal[];
    let queryRequests = 0;
    try {
      if (platform === "x") {
        queryRequests = 1;
        signals = await xSignals(discoveryQuery, maxResults);
      } else if (platform === "reddit") {
        queryRequests = 1;
        signals = await redditSignals(discoveryQuery, maxResults, lookbackHours);
      } else if (platform === "youtube") {
        queryRequests = 1;
        signals = await youtubeSignals(discoveryQuery, maxResults, publishedAfter);
        queryRequests = signals.length > 0 ? 2 : 1;
      } else {
        const result = await fetchBlueskySignals(discoveryQuery, maxResults);
        signals = result.signals;
        queryRequests = result.requests;
      }
      requests += queryRequests;
      successfulQueries += 1;
    } catch {
      requests += queryRequests || (platform === "bluesky" ? BLUESKY_APPVIEW_ORIGINS.length : 1);
      failedQueries += 1;
      httpFailures += 1;
      continue;
    }
    fetched += signals.length;
    for (const signal of signals) {
      if (Date.parse(signal.postedAt) < cutoffMs) {
        skipped += 1;
        continue;
      }
      try {
        const wasInserted = await persistSocialSignal(sourceId, signal, discoveryQuery, retrievedAt);
        if (wasInserted) inserted += 1; else updated += 1;
      } catch {
        dbErrors += 1;
        skipped += 1;
        continue;
      }
      if (!latestPostedAt || signal.postedAt > latestPostedAt) latestPostedAt = signal.postedAt;
    }
  }
  await pruneExpiredSocialSignals();
  return {
    provider: platform,
    fetched,
    inserted,
    updated,
    skipped,
    requests,
    successful_queries: successfulQueries,
    failed_queries: failedQueries,
    http_failures: httpFailures,
    db_errors: dbErrors,
    latest_posted_at: latestPostedAt,
    retention_days: retentionDays(),
    content_classification: "unverified_social_claim",
  };
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function presentSocialSignal(row: PersistedSocialSignalRow) {
  const payload = record(row.payload);
  return {
    id: Number(row.id),
    linked_events: row.linked_events ?? [],
    platform: row.platform,
    content_type: row.content_type,
    signal_nature: row.signal_nature,
    verification_status: row.verification_status,
    is_fact: false,
    text: row.content_text,
    title: row.title,
    url: row.url,
    posted_at: timestamp(row.posted_at),
    acquired_at: timestamp(row.acquired_at),
    language_code: row.language_code,
    country_iso2: row.country_iso2?.trim() || null,
    country_attribution: row.country_attribution ?? {},
    engagement: row.engagement ?? {},
    media: Array.isArray(row.media) ? row.media : [],
    topics: Array.isArray(row.topics) ? row.topics : [],
    posted_by: {
      account_id: row.author_account_id,
      handle: row.author_handle,
      display_name: row.author_display_name,
      profile_url: row.author_profile_url,
      avatar_url: row.author_avatar_url,
      platform_verified: row.author_platform_verified === true,
    },
    responsible_party: {
      name: row.responsible_party_name,
      account_id: row.responsible_party_account_id,
      type: row.responsible_party_type,
      attribution_basis: row.responsibility_basis,
      caveat: "The platform account is responsible for publishing this message; Claritas has not established the real-world controller of the account.",
    },
    credibility: {
      tier: "unverified_social",
      score: null,
      platform_verified_account: row.author_platform_verified === true,
      rationale: "Social posts are signals and claims. They require independent corroboration before factual use.",
    },
    warning: SOCIAL_SIGNAL_WARNING,
    payload_metadata: {
      acquisition_method: payload.acquisition_method ?? "official_api",
      discovery_query: payload.discovery_query ?? null,
      provider_metadata: record(payload.provider_metadata),
    },
  };
}

export async function listSocialSignals(options: {
  eventId?: string;
  platform?: string;
  country?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const platform = cleanText(options.platform, 32)?.toLowerCase() ?? "";
  if (platform && !(["x", "reddit", "youtube", "bluesky"] as string[]).includes(platform)) {
    throw new Error("platform must be x, reddit, youtube, or bluesky.");
  }
  const country = normalizedCountry(options.country) ?? "";
  if (options.country && !country) throw new Error("country must be a two-letter ISO 3166-1 code.");
  const eventId = options.eventId ?? "";
  if (eventId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) throw new Error("eventId must be a UUID.");
  const search = cleanText(options.q, 300) ?? "";
  const limit = boundedInt(options.limit, 1, 200, 50);
  const offset = boundedInt(options.offset, 0, 100_000, 0);
  const { rows } = await query<PersistedSocialSignalRow & { total_count: number }>(
    `SELECT ss.*, COUNT(*) OVER()::int AS total_count,
       COALESCE((SELECT jsonb_agg(linked ORDER BY linked.title) FROM (
         SELECT event.id,event.title,event.primary_country_iso2 AS country_iso2,
           'Shared topic and event timing; unverified context, not corroboration.' AS rationale
         FROM social_event_context link JOIN intelligence_event event ON event.id=link.event_id
         WHERE link.signal_id=ss.id ORDER BY event.last_activity_time DESC LIMIT 5
       ) linked),'[]'::jsonb) AS linked_events
     FROM social_signal ss
     WHERE ss.expires_at > now()
       AND ($1::text='' OR ss.platform=$1)
       AND ($2::text='' OR ss.country_iso2=$2::char(2) OR EXISTS (
         SELECT 1 FROM social_event_context link JOIN intelligence_event event ON event.id=link.event_id
         WHERE link.signal_id=ss.id AND event.primary_country_iso2=$2::char(2)))
       AND ($6::text='' OR EXISTS (SELECT 1 FROM social_event_context link
         WHERE link.signal_id=ss.id AND link.event_id=NULLIF($6,'')::uuid))
       AND ($3::text='' OR ss.content_text ILIKE '%'||$3||'%' OR COALESCE(ss.title,'') ILIKE '%'||$3||'%' OR COALESCE(ss.author_handle,'') ILIKE '%'||$3||'%' OR COALESCE(ss.author_display_name,'') ILIKE '%'||$3||'%')
     ORDER BY ss.posted_at DESC,ss.id DESC
     LIMIT $4 OFFSET $5`,
    [platform, country, search, limit, offset, eventId],
  );
  return {
    items: rows.map(presentSocialSignal),
    page: { limit, offset, total: Number(rows[0]?.total_count ?? 0) },
  };
}

export async function getSocialCoverage(daysInput?: number) {
  const days = boundedInt(daysInput, 1, 30, 7);
  const { rows } = await query<{
    platform: SocialPlatform;
    signal_count: number;
    account_count: number;
    latest_posted_at: string | Date | null;
    latest_acquired_at: string | Date | null;
  }>(
    `SELECT platform,COUNT(*)::int AS signal_count,
            COUNT(DISTINCT author_account_id)::int AS account_count,
            MAX(posted_at) AS latest_posted_at,MAX(acquired_at) AS latest_acquired_at
     FROM social_signal
     WHERE expires_at > now() AND posted_at >= now()-make_interval(days=>$1::int)
     GROUP BY platform ORDER BY signal_count DESC,platform ASC`,
    [days],
  );
  const { rows: collection } = await query<{ enabled: boolean; schedule_enabled: boolean; next_scheduled_at: string | null; last_status: string | null; last_run_at: string | null }>(
    `SELECT rule.enabled,rule.schedule_enabled,rule.next_scheduled_at,
       (SELECT CASE WHEN stats->>'health'='degraded' THEN 'partial coverage' ELSE status END FROM ingestion_run WHERE pipeline='social' ORDER BY id DESC LIMIT 1) AS last_status,
       (SELECT started_at FROM ingestion_run WHERE pipeline='social' ORDER BY id DESC LIMIT 1) AS last_run_at
     FROM ingestion_automation_rule rule WHERE pipeline='social'`,
  );
  return {
    collection: collection[0] ?? { enabled: false, schedule_enabled: false, next_scheduled_at: null, last_status: null, last_run_at: null },
    window_days: days,
    coverage: rows.map((row) => ({
      ...row,
      signal_count: Number(row.signal_count),
      account_count: Number(row.account_count),
      latest_posted_at: row.latest_posted_at ? timestamp(row.latest_posted_at) : null,
      latest_acquired_at: row.latest_acquired_at ? timestamp(row.latest_acquired_at) : null,
    })),
  };
}
