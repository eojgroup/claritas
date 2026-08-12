import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransportRuntimeHealth,
  isLoopbackAddress,
  transportRetentionBudgetAvailable,
} from "./transport-runtime-health";

const now = Date.parse("2026-08-12T12:00:00.000Z");
const retention = {
  running: false,
  last_pass_at: null,
  duration_ms: null,
  deleted_rows: 0,
  batches: 0,
  backlog: false,
  backlog_tables: [],
  oldest_expired_at: null,
  budget_exhausted: false,
  error: false,
};

function health(
  overrides: Partial<Parameters<typeof buildTransportRuntimeHealth>[0]> = {},
) {
  return buildTransportRuntimeHealth({
    now,
    freshnessMilliseconds: 10 * 60_000,
    workerStarted: true,
    workerLeader: true,
    primaryConfigured: true,
    primaryConnected: true,
    primaryLastMessageAt: now - 30_000,
    primaryLastSnapshotAt: now - 45_000,
    primaryLastStoredAt: now - 60_000,
    primaryError: false,
    fallbackConfigured: true,
    fallbackLastRefreshAt: now - 20_000,
    fallbackLastSnapshotAt: now - 30_000,
    fallbackLastStoredAt: now - 40_000,
    fallbackError: false,
    retention,
    ...overrides,
  });
}

test("reports a current AISstream source as live primary", () => {
  const result = health();
  assert.equal(result.ready, true);
  assert.equal(result.degraded, false);
  assert.equal(result.state, "live_primary");
  assert.equal(result.primary.traffic_current, true);
});

test("does not treat current websocket frames without accepted stored traffic as live primary", () => {
  const result = health({
    primaryLastMessageAt: now - 10_000,
    primaryLastSnapshotAt: null,
    primaryLastStoredAt: null,
    fallbackLastRefreshAt: now - 20 * 60_000,
    fallbackLastSnapshotAt: null,
    fallbackLastStoredAt: null,
  });
  assert.equal(result.ready, false);
  assert.equal(result.state, "unavailable");
  assert.equal(result.primary.last_state_at, new Date(now - 10_000).toISOString());
  assert.equal(result.primary.traffic_current, false);
});

test("accepts a current regional fallback but labels global coverage degraded", () => {
  const result = health({
    primaryConnected: false,
    primaryLastMessageAt: now - 20 * 60_000,
    primaryLastSnapshotAt: now - 20 * 60_000,
    primaryLastStoredAt: now - 20 * 60_000,
    primaryError: true,
  });
  assert.equal(result.ready, true);
  assert.equal(result.degraded, true);
  assert.equal(result.state, "regional_fallback");
  assert.equal(result.fallback.global, false);
});

test("a successful fallback poll proves provider state without inventing traffic", () => {
  const result = health({
    primaryConfigured: false,
    primaryConnected: false,
    primaryLastMessageAt: null,
    primaryLastSnapshotAt: null,
    primaryLastStoredAt: null,
    fallbackLastSnapshotAt: null,
    fallbackLastStoredAt: null,
  });
  assert.equal(result.ready, true);
  assert.equal(result.state, "regional_fallback");
  assert.equal(result.fallback.current, true);
  assert.equal(result.fallback.traffic_current, false);
});

test("fails readiness when neither provider has current state", () => {
  const result = health({
    primaryLastMessageAt: now - 11 * 60_000,
    primaryLastSnapshotAt: now - 11 * 60_000,
    primaryLastStoredAt: now - 11 * 60_000,
    fallbackLastRefreshAt: now - 11 * 60_000,
    fallbackLastSnapshotAt: now - 11 * 60_000,
    fallbackLastStoredAt: now - 11 * 60_000,
  });
  assert.equal(result.ready, false);
  assert.equal(result.degraded, false);
  assert.equal(result.state, "unavailable");
});

test("does not report a recent provider with an active error as current", () => {
  const result = health({
    primaryError: true,
    fallbackError: true,
  });
  assert.equal(result.ready, false);
  assert.equal(result.state, "unavailable");
});

test("standby replicas do not claim ingestion health", () => {
  const result = health({ workerLeader: false });
  assert.equal(result.ready, false);
  assert.equal(result.state, "standby");
});

test("internal runtime health only recognizes literal loopback peers", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1%lo"), true);
  assert.equal(isLoopbackAddress("10.24.0.9"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test("retention budget stops at either its deadline or global batch cap", () => {
  assert.equal(
    transportRetentionBudgetAvailable({
      now,
      deadline: now + 1,
      batches: 9,
      maximumBatches: 10,
    }),
    true,
  );
  assert.equal(
    transportRetentionBudgetAvailable({
      now: now + 1,
      deadline: now + 1,
      batches: 9,
      maximumBatches: 10,
    }),
    false,
  );
  assert.equal(
    transportRetentionBudgetAvailable({
      now,
      deadline: now + 1,
      batches: 10,
      maximumBatches: 10,
    }),
    false,
  );
});
