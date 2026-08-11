import assert from "node:assert/strict";
import test from "node:test";
import {
  AIS_POSITION_MESSAGE_TYPES,
  GLOBAL_AIS_BOUNDING_BOX,
  buildAisSubscription,
  normalizeAisBoundingBoxes,
} from "./ais-subscription";

test("AIS default subscription matches the provider's documented global handshake", () => {
  assert.deepEqual(buildAisSubscription("secret", [GLOBAL_AIS_BOUNDING_BOX]), {
    APIKey: "secret",
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FilterMessageTypes: [...AIS_POSITION_MESSAGE_TYPES],
  });
});

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
