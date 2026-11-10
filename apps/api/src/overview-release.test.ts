import assert from "node:assert/strict";
import test from "node:test";
const { waitForOverviewSnapshot } = require("../../../infra/scripts/wait-for-overview-snapshot.cjs");

test("release waits for all six complete fresh snapshots and rejects incomplete or stale generations", async () => {
  let now = Date.parse("2026-11-10T12:00:00Z");
  let calls = 0;
  await waitForOverviewSnapshot({ now: () => now, pollMs: 10, timeoutMs: 100,
    sleep: async (ms: number) => { now += ms; }, log: () => {}, read: async () => {
      calls++;
      return { rows: [calls === 1 ? { snapshots: 5, generated_at: new Date(now).toISOString() }
        : calls === 2 ? { snapshots: 6, generated_at: "2026-11-09T12:00:00Z" }
          : calls === 3 ? { snapshots: 6, generated_at: new Date(now).toISOString(), pending_events: 25 }
          : { snapshots: 6, generated_at: new Date(now).toISOString() }] };
    } });
  assert.equal(calls, 4);
  await assert.rejects(waitForOverviewSnapshot({ now: () => now, pollMs: 10, timeoutMs: 20,
    sleep: async (ms: number) => { now += ms; }, log: () => {}, read: async () => ({ rows: [{ snapshots: 0, scanned_events: 1000 }] }) }), /release deadline/);
});

test("release retries a temporary unavailable database but fails on missing snapshot schema", async () => {
  let now = Date.parse("2026-11-10T12:00:00Z");
  let calls = 0;
  await waitForOverviewSnapshot({ now: () => now, timeoutMs: 30, pollMs: 10,
    sleep: async (ms: number) => { now += ms; }, log: () => {}, read: async () => {
      if (++calls === 1) throw new Error("temporary connection timeout");
      return { rows: [{ snapshots: 6, generated_at: new Date(now).toISOString() }] };
    } });
  assert.equal(calls, 2);
  await assert.rejects(waitForOverviewSnapshot({ read: async () => { throw Object.assign(new Error("missing relation"), { code: "42P01" }); } }), /missing relation/);
});
