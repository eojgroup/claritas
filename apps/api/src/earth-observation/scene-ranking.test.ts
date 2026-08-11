import assert from "node:assert/strict";
import test from "node:test";
import { rankScenes, selectBeforeAfterPair } from "./scene-ranking";
import { boundBoundingBox, hasProcessingBudget, validateBoundingBox, type EarthScene } from "./types";

const scene = (id: string, captured: string, cloud = 5, collection = "sentinel-2-l2a"): EarthScene => ({
  provider: "copernicus", mission: "sentinel-2", collection, providerSceneId: id,
  captureStart: new Date(captured), bbox: [0, 0, 1, 1], cloudCover: cloud,
  sourceUrl: `https://example.test/${id}`, license: "test", attribution: "test",
  quality: { valid_pixel_coverage: 0.9 }, rawMetadata: {},
});

test("scene ranking rejects cloudy optical scenes without rejecting SAR", () => {
  const ranked = rankScenes([
    scene("clear", "2026-08-10T00:00:00Z", 5),
    scene("cloudy", "2026-08-11T00:00:00Z", 90),
    scene("sar", "2026-08-11T00:00:00Z", 90, "sentinel-1-grd"),
  ], { now: new Date("2026-08-12T00:00:00Z"), eventTime: new Date("2026-08-11T00:00:00Z"), maxCloudCover: 35 });
  assert.equal(ranked.find((entry) => entry.scene.providerSceneId === "cloudy")?.rejectedReason, "cloud_cover_above_35");
  assert.equal(ranked.find((entry) => entry.scene.providerSceneId === "sar")?.rejectedReason, undefined);
});

test("before/after selection exposes comparability warnings", () => {
  const pair = selectBeforeAfterPair([
    scene("before", "2026-08-01T00:00:00Z"),
    scene("after", "2026-08-12T00:00:00Z"),
  ], new Date("2026-08-11T00:00:00Z"));
  assert.equal(pair?.before.providerSceneId, "before");
  assert.equal(pair?.after.providerSceneId, "after");
  assert.ok((pair?.comparability ?? 0) > 0.8);
});

test("oversized governed regions are deterministically cropped to the provider budget", () => {
  const bounded = boundBoundingBox([-20, -10, 20, 10], 25);
  assert.ok((bounded[2] - bounded[0]) * (bounded[3] - bounded[1]) < 25);
  assert.deepEqual(boundBoundingBox([-20, -10, 20, 10], 25), bounded);
  assert.deepEqual(validateBoundingBox(bounded), bounded);
});

test("processing budgets account pessimistically for the next request", () => {
  assert.equal(hasProcessingBudget(9, 10), true);
  assert.equal(hasProcessingBudget(9.1, 10), false);
  assert.equal(hasProcessingBudget(500, 0), true);
  assert.equal(hasProcessingBudget(Number.NaN, 10), false);
});
