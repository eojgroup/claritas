import assert from "node:assert/strict";
import test from "node:test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("cold readers return an explicit warming state without starting database aggregation", async () => {
  const { readIntelligenceOverviewSnapshot } = await import("./overview-snapshot");
  const { normalizeOverviewOptions } = await import("./overview-model");
  const statements: string[] = [];
  const result = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), async (sql) => { statements.push(sql); return { rows: [] }; });
  assert.equal(result.snapshot.status, "warming");
  assert.equal(result.snapshot.generated_at, null);
  assert.equal(result.events.length, 0);
  assert.equal(result.buckets.length, 12);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /intelligence_overview_state/);
  assert.doesNotMatch(statements[0], /intelligence_event_feed|intelligence_event_evidence/);
});

test("snapshot freshness distinguishes saved results from background refresh delay", async () => {
  const { snapshotFreshness } = await import("./overview-snapshot");
  const now = new Date("2026-11-10T12:00:00Z");
  assert.deepEqual(snapshotFreshness("2026-11-10T11:59:30Z", now), { status: "fresh", generated_at: "2026-11-10T11:59:30.000Z", age_seconds: 30, pending_events: 0 });
  assert.equal(snapshotFreshness("2026-11-10T11:54:59Z", now).status, "stale");
  assert.equal(snapshotFreshness("2026-11-10T12:01:00Z", now).age_seconds, 0);
  assert.equal(snapshotFreshness("2026-11-10T11:59:30Z", now, 25).status, "stale");
});
