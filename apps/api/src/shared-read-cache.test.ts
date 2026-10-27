import assert from "node:assert/strict";
import test from "node:test";
import { SharedReadCache } from "./shared-read-cache";

test("simultaneous workspace reads run one loader and expire after completion", async () => {
  let now = 0;
  let calls = 0;
  let complete!: (value: string[]) => void;
  const cache = new SharedReadCache({ ttlMs: 15, maxEntries: 2, maxBytes: 1000, now: () => now });
  const load = () => { calls++; return new Promise<string[]>((resolve) => { complete = resolve; }); };
  const first = cache.get("news:US", load);
  const second = cache.get("news:US", load);
  await Promise.resolve();
  assert.equal(calls, 1);
  now = 100;
  complete(["headline"]);
  assert.deepEqual(await Promise.all([first, second]), [["headline"], ["headline"]]);
  now = 114;
  assert.deepEqual(await cache.get("news:US", async () => ["unexpected"]), ["headline"]);
  now = 115;
  assert.deepEqual(await cache.get("news:US", async () => ["fresh"]), ["fresh"]);
});

test("failed reads fan out the error, are not cached, and can retry", async () => {
  const cache = new SharedReadCache({ ttlMs: 100, maxEntries: 2, maxBytes: 1000 });
  let calls = 0;
  const load = async () => { calls++; throw new Error("database unavailable"); };
  const failed = await Promise.allSettled([cache.get("events", load), cache.get("events", load)]);
  assert.equal(calls, 1);
  assert.ok(failed.every((result) => result.status === "rejected"));
  assert.deepEqual(await cache.get("events", async () => []), []);
});

test("scopes remain separate and successful empty / null results are cached", async () => {
  const cache = new SharedReadCache({ ttlMs: 100, maxEntries: 4, maxBytes: 1000 });
  assert.deepEqual(await cache.get("news:US:en", async () => []), []);
  assert.equal(await cache.get("event:missing", async () => null), null);
  assert.deepEqual(await cache.get("news:SE:sv", async () => ["svensk"]), ["svensk"]);
  const unexpected = async () => { throw new Error("should use cached value"); };
  assert.deepEqual(await cache.get("news:US:en", unexpected), []);
  assert.equal(await cache.get("event:missing", unexpected), null);
});

test("least recently used entries are evicted at the entry bound", async () => {
  const cache = new SharedReadCache({ ttlMs: 1000, maxEntries: 2, maxBytes: 1000 });
  await cache.get("a", async () => "A");
  await cache.get("b", async () => "B");
  await cache.get("a", async () => "unexpected");
  await cache.get("c", async () => "C");
  assert.equal(await cache.get("a", async () => "unexpected"), "A");
  assert.equal(await cache.get("b", async () => "reloaded"), "reloaded");
});

test("byte budget counts UTF-8 and oversize responses are not retained", async () => {
  // Each entry is 1 key byte + 2 quote bytes + 8 UTF-8 bytes = 11 bytes.
  const cache = new SharedReadCache({ ttlMs: 1000, maxEntries: 10, maxBytes: 15 });
  await cache.get("a", async () => "🌍🌍");
  await cache.get("b", async () => "🌍🌍");
  assert.equal(await cache.get("a", async () => "new"), "new");
  let calls = 0;
  const oversize = async () => { calls++; return "x".repeat(100); };
  await cache.get("big", oversize);
  await cache.get("big", oversize);
  assert.equal(calls, 2);
});

test("expired entries are removed when other scopes load", async () => {
  let now = 0;
  const cache = new SharedReadCache({ ttlMs: 10, maxEntries: 2, maxBytes: 1000, now: () => now });
  await cache.get("old", async () => "old");
  now = 10;
  await cache.get("current", async () => "current");
  assert.equal(await cache.get("old", async () => "fresh"), "fresh");
});
