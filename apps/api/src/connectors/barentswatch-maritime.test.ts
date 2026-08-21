import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBarentsWatchMaritimeObservations,
  parseBarentsWatchToken,
} from "./barentswatch-maritime";

test("BarentsWatch parser normalizes a fresh full-model observation", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  assert.deepEqual(parseBarentsWatchMaritimeObservations([{
    mmsi: 257011940,
    latitude: 69.543985,
    longitude: 17.769428,
    speedOverGround: 12.4,
    courseOverGround: 356.7,
    trueHeading: 355,
    navigationalStatus: 0,
    msgtime: "2026-08-21T08:03:25+00:00",
    name: "BALDER",
    callSign: "LABC",
    shipType: 33,
    destination: "NOTOS",
  }], now), [{
    mmsi: "257011940",
    latitude: 69.543985,
    longitude: 17.769428,
    speed: 12.4,
    course: 356.7,
    heading: 355,
    navigationStatus: 0,
    observedAt: "2026-08-21T08:03:25.000Z",
    displayName: "BALDER",
    callsign: "LABC",
    shipType: 33,
    destination: "NOTOS",
  }]);
});

test("BarentsWatch parser rejects stale, future, invalid MMSI, and invalid coordinates", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  const base = { mmsi: 257011940, latitude: 69.5, longitude: 17.7 };
  assert.deepEqual(parseBarentsWatchMaritimeObservations([
    { ...base, msgtime: "2026-08-21T07:40:00Z" },
    { ...base, msgtime: "2026-08-21T08:20:00Z" },
    { ...base, mmsi: "invalid", msgtime: "2026-08-21T08:04:00Z" },
    { ...base, latitude: 91, msgtime: "2026-08-21T08:04:00Z" },
  ], now), []);
});

test("BarentsWatch token parser keeps a safety margin before expiry", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  assert.deepEqual(parseBarentsWatchToken({
    access_token: "token",
    expires_in: 3600,
  }, now), {
    accessToken: "token",
    expiresAt: now + 3540 * 1_000,
  });
  assert.equal(parseBarentsWatchToken({ expires_in: 3600 }, now), null);
});
