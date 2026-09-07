import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const connector = import("./social-media");

test("X normalization preserves account responsibility but never promotes a post to fact", async () => {
  const { normalizeXPost } = await connector;
  const signal = normalizeXPost({
    id: "1900000000000000000",
    author_id: "42",
    text: "Unconfirmed reports of disruption at the port.",
    created_at: "2026-09-07T08:10:00Z",
    lang: "en",
    public_metrics: { like_count: 7, reply_count: 2, retweet_count: 3, quote_count: 1 },
    geo: { place_id: "place-1" },
  }, {
    users: [{ id: "42", username: "observer", name: "Field Observer", verified: true, verified_type: "blue" }],
    places: [{ id: "place-1", country_code: "DE", country: "Germany", full_name: "Hamburg, Germany" }],
  });

  assert.ok(signal);
  assert.equal(signal.platform, "x");
  assert.equal(signal.author.handle, "@observer");
  assert.equal(signal.author.platformVerified, true);
  assert.deepEqual(signal.responsibleParty, {
    name: "Field Observer",
    accountId: "42",
    type: "account_holder",
    attributionBasis: "platform_account",
  });
  assert.equal(signal.countryIso2, "DE");
  assert.equal(signal.countryAttribution.method, "provider_geotag");
  assert.equal(normalizeXPost({
    id: "sensitive",
    author_id: "42",
    text: "Sensitive post",
    created_at: "2026-09-07T08:10:00Z",
    possibly_sensitive: true,
  }, { users: [{ id: "42" }] }), null);
});

test("Bluesky normalization attributes the publishing DID and emits a stable post URL", async () => {
  const { normalizeBlueskyPost } = await connector;
  const signal = normalizeBlueskyPost({
    uri: "at://did:plc:abc/app.bsky.feed.post/3lxyz",
    cid: "bafy-test",
    indexedAt: "2026-09-07T08:12:01Z",
    author: {
      did: "did:plc:abc",
      handle: "analyst.example",
      displayName: "Analyst",
      verification: { verifiedStatus: "valid" },
    },
    record: { text: "Claim requiring corroboration", createdAt: "2026-09-07T08:12:00Z", langs: ["en"] },
    likeCount: 4,
    replyCount: 1,
    repostCount: 2,
    quoteCount: 0,
  });

  assert.ok(signal);
  assert.equal(signal.externalId, "at://did:plc:abc/app.bsky.feed.post/3lxyz");
  assert.equal(signal.url, "https://bsky.app/profile/analyst.example/post/3lxyz");
  assert.equal(signal.postedAt, "2026-09-07T08:12:01.000Z");
  assert.equal(signal.author.accountId, "did:plc:abc");
  assert.equal(signal.responsibleParty.accountId, "did:plc:abc");
  assert.equal(normalizeBlueskyPost({
    uri: "at://did:plc:abc/app.bsky.feed.post/client-time-only",
    author: { did: "did:plc:abc", handle: "analyst.example" },
    record: { text: "Client timestamp only", createdAt: "2026-09-07T08:12:59Z" },
  }), null);
  assert.equal(normalizeBlueskyPost({
    uri: "at://did:plc:abc/app.bsky.feed.post/sensitive",
    indexedAt: "2026-09-07T08:13:00Z",
    author: { did: "did:plc:abc", handle: "analyst.example" },
    record: { text: "Sensitive post", createdAt: "2026-09-07T08:12:59Z" },
    labels: [{ val: "graphic-media" }],
  }), null);
});

test("YouTube videos are represented as attributed social posts with uploader responsibility", async () => {
  const { normalizeYouTubeVideo } = await connector;
  const signal = normalizeYouTubeVideo({
    id: "video123",
    snippet: {
      title: "Port update &amp; eyewitness footage",
      description: "The uploader says traffic has stopped.",
      publishedAt: "2026-09-07T08:00:00Z",
      channelId: "UC123",
      channelTitle: "Local Observer",
      defaultLanguage: "en",
      thumbnails: { high: { url: "https://i.ytimg.com/vi/video123/hqdefault.jpg" } },
    },
    statistics: { viewCount: "1000", likeCount: "40", commentCount: "12" },
    status: { privacyStatus: "public" },
  });

  assert.ok(signal);
  assert.equal(signal.title, "Port update & eyewitness footage");
  assert.equal(signal.author.accountId, "UC123");
  assert.equal(signal.responsibleParty.name, "Local Observer");
  assert.equal(signal.engagement.views, 1000);
});

test("Reddit attribution assigns responsibility to the poster, never the community moderators", async () => {
  const { normalizeRedditPost } = await connector;
  const signal = normalizeRedditPost({
    id: "abc123",
    author: "witness_account",
    author_fullname: "t2_user123",
    subreddit: "worldnews",
    subreddit_name_prefixed: "r/worldnews",
    title: "Unverified airport report",
    selftext: "I heard that flights may be delayed.",
    permalink: "/r/worldnews/comments/abc123/unverified_airport_report/",
    created_utc: 1788768000,
    score: 15,
    num_comments: 8,
    upvote_ratio: 0.75,
  });

  assert.ok(signal);
  assert.equal(signal.author.handle, "u/witness_account");
  assert.equal(signal.responsibleParty.accountId, "t2_user123");
  assert.equal(signal.providerMetadata.community, "r/worldnews");

  assert.equal(normalizeRedditPost({
    id: "redirect",
    author: "attacker",
    title: "Protocol-relative URL",
    permalink: "//evil.example/redirect",
    created_utc: 1788768000,
  }), null);
  assert.equal(normalizeRedditPost({
    id: "backslash-redirect",
    author: "attacker",
    title: "Backslash URL",
    permalink: "/\\evil.example/redirect",
    created_utc: 1788768000,
  }), null);
  assert.equal(normalizeRedditPost({
    id: "nsfw",
    author: "attacker",
    title: "Sensitive post",
    permalink: "/r/example/comments/nsfw/sensitive/",
    created_utc: 1788768000,
    over_18: true,
  }), null);
});

test("API presentation uses a stable attribution contract and never treats an absent badge as verification", async () => {
  const { presentSocialSignal, SOCIAL_SIGNAL_WARNING } = await connector;
  const presented = presentSocialSignal({
    id: 7,
    platform: "youtube",
    content_type: "social_post",
    signal_nature: "claim",
    verification_status: "unverified",
    content_text: "Uploader claim",
    title: "Video title",
    url: "https://www.youtube.com/watch?v=video123",
    language_code: "en",
    country_iso2: null,
    country_attribution: {},
    posted_at: "2026-09-07T08:00:00Z",
    acquired_at: "2026-09-07T08:01:00Z",
    author_account_id: "UC123",
    author_handle: null,
    author_display_name: "Uploader",
    author_profile_url: "https://www.youtube.com/channel/UC123",
    author_avatar_url: null,
    author_platform_verified: null,
    responsible_party_name: "Uploader",
    responsible_party_account_id: "UC123",
    responsible_party_type: "account_holder",
    responsibility_basis: "platform_account",
    engagement: {},
    media: [],
    topics: [],
    payload: { acquisition_method: "official_api" },
  });
  assert.equal(presented.is_fact, false);
  assert.equal(presented.posted_by.platform_verified, false);
  assert.equal(presented.credibility.platform_verified_account, false);
  assert.equal(presented.responsible_party.attribution_basis, "platform_account");
  assert.equal(presented.warning, SOCIAL_SIGNAL_WARNING);
});

test("provider status exposes configuration names but never secret values", async () => {
  const { getSocialProviderStatuses } = await connector;
  const previous = {
    x: process.env.X_BEARER_TOKEN,
    redditId: process.env.REDDIT_CLIENT_ID,
    redditSecret: process.env.REDDIT_CLIENT_SECRET,
    redditAgent: process.env.REDDIT_USER_AGENT,
    redditApproved: process.env.REDDIT_API_APPROVED,
    redditEnabled: process.env.SOCIAL_REDDIT_ENABLED,
    youtube: process.env.YOUTUBE_API_KEY,
  };
  process.env.X_BEARER_TOKEN = "x-super-secret";
  process.env.REDDIT_CLIENT_ID = "reddit-id";
  process.env.REDDIT_CLIENT_SECRET = "reddit-super-secret";
  process.env.REDDIT_USER_AGENT = "Claritas test";
  process.env.REDDIT_API_APPROVED = "pending";
  process.env.YOUTUBE_API_KEY = "youtube-super-secret";
  try {
    const statuses = getSocialProviderStatuses();
    assert.equal(statuses.find((status) => status.id === "x")?.configured, true);
    assert.equal(statuses.find((status) => status.id === "youtube")?.configured, true);
    assert.equal(statuses.find((status) => status.id === "reddit")?.configured, false);
    assert.equal(statuses.find((status) => status.id === "bluesky")?.available, true);
    const serialized = JSON.stringify(statuses);
    assert.doesNotMatch(serialized, /x-super-secret|reddit-super-secret|youtube-super-secret/);
    process.env.REDDIT_API_APPROVED = "true";
    assert.equal(getSocialProviderStatuses().find((status) => status.id === "reddit")?.configured, true);

    process.env.REDDIT_API_APPROVED = "true";
    process.env.SOCIAL_REDDIT_ENABLED = "true";
    process.env.REDDIT_USER_AGENT = "web:info.claritas.app:1.0 (by /u/replace-with-approved-operator)";
    const placeholderStatus = getSocialProviderStatuses().find((status) => status.id === "reddit");
    assert.equal(placeholderStatus?.configured, false);
    assert.equal(placeholderStatus?.available, false);

    process.env.REDDIT_USER_AGENT = "change-me";
    const genericPlaceholderStatus = getSocialProviderStatuses().find((status) => status.id === "reddit");
    assert.equal(genericPlaceholderStatus?.configured, false);
    assert.equal(genericPlaceholderStatus?.available, false);

    process.env.REDDIT_USER_AGENT = "Claritas test (engineering@claritas.info)";
    const configuredStatus = getSocialProviderStatuses().find((status) => status.id === "reddit");
    assert.equal(configuredStatus?.configured, true);
    assert.equal(configuredStatus?.available, true);
  } finally {
    if (previous.x == null) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = previous.x;
    if (previous.redditId == null) delete process.env.REDDIT_CLIENT_ID; else process.env.REDDIT_CLIENT_ID = previous.redditId;
    if (previous.redditSecret == null) delete process.env.REDDIT_CLIENT_SECRET; else process.env.REDDIT_CLIENT_SECRET = previous.redditSecret;
    if (previous.redditAgent == null) delete process.env.REDDIT_USER_AGENT; else process.env.REDDIT_USER_AGENT = previous.redditAgent;
    if (previous.redditApproved == null) delete process.env.REDDIT_API_APPROVED; else process.env.REDDIT_API_APPROVED = previous.redditApproved;
    if (previous.redditEnabled == null) delete process.env.SOCIAL_REDDIT_ENABLED; else process.env.SOCIAL_REDDIT_ENABLED = previous.redditEnabled;
    if (previous.youtube == null) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = previous.youtube;
  }
});

test("provider request builders are bounded and chronological", async () => {
  const { buildXSearchUrl, buildBlueskySearchUrl, buildRedditSearchUrl } = await connector;
  const x = new URL(buildXSearchUrl("port disruption", 999));
  assert.equal(x.searchParams.get("max_results"), "100");
  assert.equal(x.searchParams.get("query"), "port disruption -is:retweet");
  const bluesky = new URL(buildBlueskySearchUrl("security", 999));
  assert.equal(bluesky.searchParams.get("sort"), "latest");
  assert.equal(bluesky.searchParams.get("limit"), "100");
  assert.throws(
    () => buildBlueskySearchUrl("security", 25, "https://evil.example"),
    /Unsupported Bluesky AppView origin/,
  );
  const reddit = new URL(buildRedditSearchUrl("markets", 999, 12));
  assert.equal(reddit.searchParams.get("sort"), "new");
  assert.equal(reddit.searchParams.get("t"), "day");
});

test("Bluesky falls back only to the secondary allowlisted AppView", async () => {
  const { fetchBlueskySignals } = await connector;
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (new URL(url).hostname === "public.api.bsky.app") {
      return new Response("<html>forbidden</html>", { status: 403 });
    }
    return new Response(JSON.stringify({
      posts: [{
        uri: "at://did:plc:fallback/app.bsky.feed.post/abc",
        indexedAt: "2026-09-07T08:20:00Z",
        author: { did: "did:plc:fallback", handle: "fallback.example" },
        record: { text: "Fallback signal", createdAt: "2026-09-07T08:19:00Z" },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await fetchBlueskySignals("security", 25);
    assert.equal(result.requests, 2);
    assert.equal(result.signals[0]?.text, "Fallback signal");
    assert.deepEqual(requested.map((url) => new URL(url).hostname), ["public.api.bsky.app", "api.bsky.app"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("database and API presentation invariants retain claim labeling and newest-first ordering", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  const migration = readFileSync(resolve(__dirname, "../../../../infra/gcp/sql/V55__governed_social_signals.sql"), "utf8");
  const implementation = readFileSync(resolve(__dirname, "social-media.ts"), "utf8");
  assert.match(migration, /CHECK \(content_type = 'social_post'\)/);
  assert.match(migration, /CHECK \(signal_nature = 'claim'\)/);
  assert.match(migration, /DEFAULT 'unverified'/);
  assert.match(migration, /author_account_id/);
  assert.match(migration, /responsible_party_account_id/);
  assert.match(implementation, /is_fact: false/);
  assert.match(implementation, /ORDER BY ss\.posted_at DESC,ss\.id DESC/);
  assert.match(implementation, /platform account is responsible for publishing/i);
  const automation = readFileSync(resolve(__dirname, "../ingestion-automation.ts"), "utf8");
  assert.match(automation, /DELETE FROM social_signal WHERE expires_at <= now\(\)/);
});
