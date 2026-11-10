import assert from "node:assert/strict";
import test from "node:test";
import { ReaderWorkQueue, routeReadPriority, withReadPriority, currentReadPriority } from "./reader-work";
const gate = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test("a page burst of optional reads leaves capacity for its overview and briefing", async () => {
  const queue = new ReaderWorkQueue({ concurrency: 4, optionalConcurrency: 2 });
  const blocked = gate();
  let optionalStarted = 0;
  const optional = Array.from({ length: 24 }, () => queue.run(async () => { optionalStarted++; await blocked.promise; return 1; }, "optional"));
  assert.equal(queue.stats().optional_active, 2);
  const core = await Promise.all(["overview", "briefing", "events", "auth"].map((name) => queue.run(async () => name, "core")));
  assert.deepEqual(core, ["overview", "briefing", "events", "auth"]);
  assert.equal(optionalStarted, 2, "core work must finish before optional work is released");
  blocked.resolve();
  assert.equal((await Promise.all(optional)).length, 24);
});

test("failed work releases admission and a full optional backlog admits core work", async () => {
  const queue = new ReaderWorkQueue({ concurrency: 1, optionalConcurrency: 1, maxWaiting: 1 });
  const blocked = gate();
  const first = queue.run(() => blocked.promise, "optional");
  const optional = queue.run(async () => 1, "optional");
  const displaced = assert.rejects(optional, (error: any) => error.code === "DATABASE_BUSY");
  const core = queue.run(async () => 2, "core");
  blocked.resolve();
  await first;
  assert.equal(await core, 2);
  await displaced;
  await assert.rejects(queue.run(async () => { throw new Error("query failed"); }), /query failed/);
  assert.equal(await queue.run(async () => 3), 3);
});

test("expired queued work never reaches the database", async () => {
  const queue = new ReaderWorkQueue({ concurrency: 1, optionalConcurrency: 1, waitMs: 20 });
  const blocked = gate();
  const first = queue.run(() => blocked.promise);
  let executed = false;
  await assert.rejects(queue.run(async () => { executed = true; }), /busy/);
  blocked.resolve();
  await first;
  assert.equal(executed, false);
  assert.equal(await queue.run(async () => "recovered"), "recovered");
});

test("request priorities stay isolated across async requests and surrounding context is optional", async () => {
  assert.equal(routeReadPriority("/api/intelligence/overview"), "core");
  assert.equal(routeReadPriority("/api/briefings/daily/latest"), "core");
  assert.equal(routeReadPriority("/api/intelligence/events/id", true), "optional");
  assert.equal(routeReadPriority("/api/market/countries"), "optional");
  assert.equal(routeReadPriority("/api/weather/country-latest"), "optional");
  const results = await Promise.all(["core", "optional"].map((priority) => withReadPriority(priority as "core" | "optional", async () => {
    await Promise.resolve(); return currentReadPriority();
  })));
  assert.deepEqual(results, ["core", "optional"]);
  assert.equal(currentReadPriority(), "normal");
});
