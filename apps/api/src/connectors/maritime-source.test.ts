import assert from "node:assert/strict";
import test from "node:test";
import {
  maritimeStaticCacheKey,
  shouldAcceptSampledMaritimeSnapshot,
  shouldReplaceMaritimeSnapshot,
} from "./maritime-source";

test("static vessel metadata cache keys are provider scoped", () => {
  assert.notEqual(
    maritimeStaticCacheKey("aisstream", "257123456"),
    maritimeStaticCacheKey("barentswatch", "257123456"),
  );
  assert.equal(
    maritimeStaticCacheKey("barentswatch", "257123456"),
    "barentswatch:257123456",
  );
});

test("newer maritime observations win regardless of provider", () => {
  assert.equal(
    shouldReplaceMaritimeSnapshot(
      { source_name: "aisstream", observed_at: "2026-08-21T12:00:01Z" },
      { source_name: "barentswatch", observed_at: "2026-08-21T12:00:00Z" },
    ),
    true,
  );
  assert.equal(
    shouldReplaceMaritimeSnapshot(
      { source_name: "barentswatch", observed_at: "2026-08-21T11:59:59Z" },
      { source_name: "aisstream", observed_at: "2026-08-21T12:00:00Z" },
    ),
    false,
  );
  assert.equal(
    shouldReplaceMaritimeSnapshot(
      { source_name: "barentswatch", observed_at: "not-a-timestamp" },
      null,
    ),
    false,
  );
});

test("official regional feeds win exact timestamp ties with AISstream", () => {
  assert.equal(
    shouldReplaceMaritimeSnapshot(
      { source_name: "mpa_oceans_x", observed_at: "2026-08-21T12:00:00Z" },
      { source_name: "aisstream", observed_at: "2026-08-21T12:00:00Z" },
    ),
    true,
  );
  assert.equal(
    shouldReplaceMaritimeSnapshot(
      { source_name: "aisstream", observed_at: "2026-08-21T12:00:00Z" },
      { source_name: "digitraffic", observed_at: "2026-08-21T12:00:00Z" },
    ),
    false,
  );
  assert.equal(
    shouldReplaceMaritimeSnapshot(
      { source_name: "kystverket", observed_at: "2026-08-21T12:00:00Z" },
      { source_name: "aisstream", observed_at: "2026-08-21T12:00:00Z" },
    ),
    false,
  );
});

test("sampling permits a provider upgrade without allowing poll-by-poll churn", () => {
  const current = {
    source_name: "aisstream" as const,
    observed_at: "2026-08-21T12:00:00Z",
  };
  const common = {
    current,
    now: 1_000_000,
    lastQueuedAt: 990_000,
    sampleMilliseconds: 600_000,
  };
  assert.equal(
    shouldAcceptSampledMaritimeSnapshot({
      ...common,
      candidate: {
        source_name: "aisstream",
        observed_at: "2026-08-21T12:00:10Z",
      },
    }),
    false,
  );
  assert.equal(
    shouldAcceptSampledMaritimeSnapshot({
      ...common,
      candidate: {
        source_name: "barentswatch",
        observed_at: "2026-08-21T12:00:10Z",
      },
    }),
    true,
  );
  assert.equal(
    shouldAcceptSampledMaritimeSnapshot({
      ...common,
      current: {
        source_name: "barentswatch",
        observed_at: "2026-08-21T12:00:00Z",
      },
      candidate: {
        source_name: "aisstream",
        observed_at: "2026-08-21T12:00:10Z",
      },
    }),
    false,
  );
  assert.equal(
    shouldAcceptSampledMaritimeSnapshot({
      ...common,
      current: {
        source_name: "barentswatch",
        observed_at: "2026-08-21T12:00:00Z",
      },
      candidate: {
        source_name: "aisstream",
        observed_at: "2026-08-21T12:10:01Z",
      },
      lastQueuedAt: 399_999,
    }),
    true,
  );
});
