import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest } from "node:http";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("publisher DNS prefers vetted IPv4 and rejects private addresses", async () => {
  const { selectPublicGdeltArticleAddress } = await import("./gdelt");
  assert.deepEqual(selectPublicGdeltArticleAddress([
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "127.0.0.1", family: 4 },
    { address: "8.8.8.8", family: 4 },
  ]), { address: "8.8.8.8", family: 4 });
  assert.throws(() => selectPublicGdeltArticleAddress([{ address: "10.0.0.1", family: 4 }]), /no public address/);
});

test("publisher socket failure is optional evidence and never an unhandled error", async () => {
  const { requestVerifiedPublisherPage } = await import("./gdelt");
  const request = new EventEmitter() as ClientRequest;
  const socket = new EventEmitter();
  request.end = (() => {
    queueMicrotask(() => {
      request.emit("socket", socket);
      socket.emit("error", Object.assign(new Error("IPv6 egress unavailable"), { code: "EADDRNOTAVAIL" }));
    });
    return request;
  }) as ClientRequest["end"];
  assert.equal(await requestVerifiedPublisherPage("https://news.example.com/world/earthquake", {
    resolveAddress: async () => ({ address: "2606:4700:4700::1111", family: 6 }),
    request: () => request,
  }), null);
  // Teardown may emit a late socket error after the caller has moved on.
  assert.doesNotThrow(() => socket.emit("error", new Error("late teardown")));
});

test("social acquisition retains totals even when independent retention would fail", async () => {
  const { pool } = await import("../db");
  const { ingestSocialProvider } = await import("./social-media");
  const originalConnect = pool.connect;
  const originalFetch = globalThis.fetch;
  const originalEnabled = process.env.SOCIAL_BLUESKY_ENABLED;
  process.env.SOCIAL_BLUESKY_ENABLED = "true";
  const statements: string[] = [];
  pool.connect = (async () => ({
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("INSERT INTO source")) return { rows: [{ id: 1 }] };
      if (sql.includes("INSERT INTO social_signal")) return { rows: [{ inserted: true }] };
      throw new Error("retention or unrelated query must not run during acquisition");
    },
    release() {},
  })) as any;
  globalThis.fetch = (async () => new Response(JSON.stringify({ posts: [{
    uri: "at://did:plc:test/app.bsky.feed.post/one",
    indexedAt: new Date().toISOString(),
    record: { text: "Port disruption" },
    author: { did: "did:plc:test", handle: "reporter.example" },
  }] }))) as typeof fetch;
  try {
    const result = await ingestSocialProvider("bluesky", { queries: ["port disruption"] });
    assert.equal(result.inserted, 1);
    assert.equal(result.successful_queries, 1);
    assert.equal(statements.some((sql) => sql.includes("DELETE")), false);
  } finally {
    pool.connect = originalConnect;
    globalThis.fetch = originalFetch;
    if (originalEnabled == null) delete process.env.SOCIAL_BLUESKY_ENABLED; else process.env.SOCIAL_BLUESKY_ENABLED = originalEnabled;
  }
});

test("blocked AppViews stop a query storm and preserve actionable failure diagnostics", async () => {
  const { pool } = await import("../db");
  const { ingestSocialProvider } = await import("./social-media");
  const originalConnect = pool.connect;
  const originalFetch = globalThis.fetch;
  pool.connect = (async () => ({ query: async () => ({ rows: [{ id: 1 }] }), release() {} })) as any;
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; return new Response("blocked", { status: 403 }); }) as typeof fetch;
  try {
    const result = await ingestSocialProvider("bluesky", { queries: ["one", "two", "three", "four", "five"] });
    assert.equal(requests, 2);
    assert.equal(result.requests, 2);
    assert.equal(result.failed_queries, 1);
    assert.equal(result.deferred_queries, 4);
    assert.match(result.failures[0].error, /Bluesky AppView.*HTTP 403/);
  } finally { pool.connect = originalConnect; globalThis.fetch = originalFetch; }
});

test("RSS conditional polls skip unchanged feeds and never acknowledge a failed write", async () => {
  const { pool } = await import("../db");
  const { ingestInstitutionalRss, INSTITUTIONAL_RSS_FEEDS } = await import("./institutional-rss");
  const originalConnect = pool.connect;
  const originalFetch = globalThis.fetch;
  const statements: string[] = [];
  pool.connect = (async () => ({
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("WITH upsert")) return { rows: [{ id: 1 }] };
      if (sql.includes("SELECT feed_key")) return { rows: INSTITUTIONAL_RSS_FEEDS.map((feed) => ({ feed_key: feed.id, cursor: { etag: "previous", last_modified: "Mon, 26 Oct 2026 09:00:00 GMT" } })) };
      if (sql.includes("INSERT INTO item")) throw Object.assign(new Error("statement timeout"), { code: "57014" });
      return { rows: [] };
    },
    release() {},
  })) as any;
  let failOneFeed = false;
  globalThis.fetch = (async (url, init) => {
    assert.equal((init?.headers as Record<string, string>)["if-none-match"], "previous");
    if (failOneFeed && String(url) === INSTITUTIONAL_RSS_FEEDS[0].url) return new Response("<rss><channel><item><title>Rate decision</title><link>https://ec.europa.eu/news/rates</link><guid>rates</guid></item></channel></rss>", { headers: { etag: "new" } });
    return new Response(null, { status: 304 });
  }) as typeof fetch;
  try {
    const unchanged = await ingestInstitutionalRss();
    assert.equal(unchanged.not_modified_feeds, INSTITUTIONAL_RSS_FEEDS.length);
    assert.equal(statements.some((sql) => sql.includes("INSERT INTO item") || sql.includes("INSERT INTO source_feed")), false);
    failOneFeed = true;
    const failed = await ingestInstitutionalRss();
    assert.equal(failed.health, "degraded");
    assert.equal(statements.some((sql) => sql.includes("INSERT INTO source_feed")), false);
  } finally { pool.connect = originalConnect; globalThis.fetch = originalFetch; }
});

test("social retention commits only a bounded unlocked batch", async () => {
  const { pool } = await import("../db");
  const { pruneExpiredSocialSignals } = await import("./social-media");
  const originalConnect = pool.connect;
  pool.connect = (async () => ({
    query: async (sql: string) => {
      assert.match(sql, /LIMIT 100 FOR UPDATE SKIP LOCKED/);
      assert.match(sql, /DELETE FROM social_signal WHERE id IN \(SELECT id FROM expired\)/);
      return { rows: [{ deleted: 2 }] };
    }, release() {},
  })) as any;
  try { assert.equal(await pruneExpiredSocialSignals(), 2); }
  finally { pool.connect = originalConnect; }
});
