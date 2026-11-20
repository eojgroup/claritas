import assert from "node:assert/strict";
import test from "node:test";
import { newsCoordinateConflictsWithLocation } from "./event-geography";

test("news enrichment cannot relocate a named strait to Stockholm", () => {
  const hormuz = { location_type: "strait", latitude: 26.56, longitude: 56.25 };
  assert.equal(newsCoordinateConflictsWithLocation({ latitude: 59.3333, longitude: 18.05 }, hormuz), true);
  assert.equal(newsCoordinateConflictsWithLocation({ latitude: 26.1799, longitude: 56.2477 }, hormuz), false);
  assert.equal(newsCoordinateConflictsWithLocation({ latitude: 59.3333, longitude: 18.05 }, null), false);
  assert.equal(newsCoordinateConflictsWithLocation({ latitude: 59.3333, longitude: 18.05 }, { ...hormuz, location_type: "country" }), false);
});
