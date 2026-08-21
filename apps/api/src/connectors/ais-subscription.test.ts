import assert from "node:assert/strict";
import test from "node:test";
import {
  AIS_POSITION_MESSAGE_TYPES,
  GLOBAL_AIS_BOUNDING_BOX,
  aisReconnectDelayMilliseconds,
  buildAisSubscription,
  isAisCoordinateMessageType,
  normalizeAisBoundingBoxes,
  normalizeAisObservedAt,
  shouldQueueAisSnapshot,
} from "./ais-subscription";

test("AIS reconnects back off through silent upstream failures", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, attempt) =>
      aisReconnectDelayMilliseconds(attempt),
    ),
    [
      2_000,
      10_000,
      30_000,
      60_000,
      300_000,
      900_000,
      1_800_000,
      3_600_000,
      3_600_000,
    ],
  );
});

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

test("static AIS metadata cannot replace a usable live position with null coordinates", () => {
  assert.equal(shouldQueueAisSnapshot(null, null), false);
  assert.equal(shouldQueueAisSnapshot(91, 12), false);
  assert.equal(shouldQueueAisSnapshot(59.3293, 18.0686), true);
});

test("only coordinate-bearing AISstream message types can prove position liveness", () => {
  assert.equal(isAisCoordinateMessageType("PositionReport"), true);
  assert.equal(isAisCoordinateMessageType("StandardClassBPositionReport"), true);
  assert.equal(isAisCoordinateMessageType("ExtendedClassBPositionReport"), true);
  assert.equal(isAisCoordinateMessageType("LongRangeAisBroadcastMessage"), true);
  assert.equal(isAisCoordinateMessageType("ShipStaticData"), false);
  assert.equal(isAisCoordinateMessageType("StaticDataReport"), false);
  assert.equal(isAisCoordinateMessageType(null), false);
});

test("AISstream observation timestamps must be current and plausible", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");
  assert.equal(
    normalizeAisObservedAt("2026-08-21T11:50:00.000Z", now),
    "2026-08-21T11:50:00.000Z",
  );
  assert.equal(
    normalizeAisObservedAt(now / 1_000, now),
    "2026-08-21T12:00:00.000Z",
  );
  assert.equal(normalizeAisObservedAt("2026-08-21T11:44:59.999Z", now), null);
  assert.equal(normalizeAisObservedAt("2026-08-21T12:05:00.001Z", now), null);
  assert.equal(normalizeAisObservedAt("not-a-date", now), null);
  assert.equal(normalizeAisObservedAt(undefined, now), null);
});
