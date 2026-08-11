import assert from "node:assert/strict";
import test from "node:test";
import { trustedGdeltActionCoordinate, trustedGdeltLocations } from "./gdelt-geography";

test("GDELT imagery geography excludes country and admin centroids", () => {
  const locations = trustedGdeltLocations({
    gkg: {
      locations: [
        { type: 1, name: "United States", latitude: 39.8, longitude: -98.6 },
        { type: 5, name: "California", latitude: 37.2, longitude: -119.7 },
        { type: 4, name: "Los Angeles", latitude: 34.05, longitude: -118.24 },
      ],
    },
  });
  assert.deepEqual(locations, [{ latitude: 34.05, longitude: -118.24, name: "Los Angeles" }]);
});

test("GDELT action geography requires a preserved city/local type", () => {
  assert.equal(trustedGdeltActionCoordinate({
    action_lat: 39.8,
    action_lon: -98.6,
    payload: { action_geo: { type: 1 } },
  }), null);
  assert.deepEqual(trustedGdeltActionCoordinate({
    action_lat: 1.264,
    action_lon: 103.84,
    payload: { action_geo: { type: 4 } },
  }), { latitude: 1.264, longitude: 103.84 });
  assert.equal(trustedGdeltActionCoordinate({
    action_lat: 1.264,
    action_lon: 103.84,
    payload: { action_geo: {} },
  }), null);
});
