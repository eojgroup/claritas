import assert from "node:assert/strict";
import test from "node:test";
import {
  batchAisBoundingBoxes,
  incrementalWorldAisBoundingBoxes,
  normalizeAisBoundingBoxes,
} from "./ais-subscription";

test("AIS bounding boxes are normalized and invalid boxes are rejected", () => {
  assert.deepEqual(
    normalizeAisBoundingBoxes([
      [[50, 20], [40, -10]],
      [[91, 0], [80, 10]],
      [[0, 0], [0, 10]],
    ]),
    [[[40, -10], [50, 20]]],
  );
});

test("incremental AIS coverage tiles the world without a full-world burst", () => {
  const boxes = incrementalWorldAisBoundingBoxes();
  assert.equal(boxes.length, 42);
  assert.equal(new Set(boxes.map((box) => JSON.stringify(box))).size, 42);
  assert.deepEqual(boxes[0], [[30, -30], [60, 30]]);

  const batches = batchAisBoundingBoxes(boxes, 2);
  assert.equal(batches.length, 21);
  assert.ok(batches.every((batch) => batch.length <= 2));

  const latitudes = boxes.flatMap((box) => [box[0][0], box[1][0]]);
  const longitudes = boxes.flatMap((box) => [box[0][1], box[1][1]]);
  assert.equal(Math.min(...latitudes), -90);
  assert.equal(Math.max(...latitudes), 90);
  assert.equal(Math.min(...longitudes), -180);
  assert.equal(Math.max(...longitudes), 180);
  assert.equal(
    boxes.reduce(
      (area, [[south, west], [north, east]]) =>
        area + (north - south) * (east - west),
      0,
    ),
    180 * 360,
  );
});

test("AIS batch size is bounded", () => {
  const boxes = incrementalWorldAisBoundingBoxes();
  assert.equal(batchAisBoundingBoxes(boxes, 0).length, 42);
  assert.equal(batchAisBoundingBoxes(boxes, 99).length, 4);
});
