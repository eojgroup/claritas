import assert from "node:assert/strict";
import test from "node:test";
import { isTimelyEventMedia } from "./event-media";

test("event visuals require a known date near the development, independently of image source", () => {
  const event = { last_activity_time: "2026-11-12T12:00:00Z" };
  assert.equal(isTimelyEventMedia(event, "2026-11-10T12:00:00Z"), true);
  assert.equal(isTimelyEventMedia(event, "2026-10-01T12:00:00Z"), false);
  assert.equal(isTimelyEventMedia(event, "2026-11-14T12:00:00Z"), false);
  assert.equal(isTimelyEventMedia(event, null), false);
  assert.equal(isTimelyEventMedia({}, "2026-11-12T12:00:00Z"), false);
});
