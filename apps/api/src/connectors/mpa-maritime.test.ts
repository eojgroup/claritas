import assert from "node:assert/strict";
import test from "node:test";
import { parseMpaMaritimeObservations } from "./mpa-maritime";

test("MPA parser uses explicit degree coordinates and Singapore-local timestamps", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  const observations = parseMpaMaritimeObservations([
    {
      vesselParticulars: {
        vesselName: "CLARITAS TEST",
        callSign: "9VTEST",
        mmsiNumber: "563123456",
        vesselType: "DR",
        flag: "sg",
      },
      latitude: 0.0241476315047,
      longitude: 1.80084330648,
      latitudeDegrees: 1.38355737046,
      longitudeDegrees: 103.180721026,
      speed: 5.17939,
      course: 127.988,
      heading: 128,
      timeStamp: "2026-08-21 16:02:52",
    },
  ], now);

  assert.deepEqual(observations, [{
    mmsi: "563123456",
    latitude: 1.38355737046,
    longitude: 103.180721026,
    speed: 5.17939,
    course: 127.988,
    heading: 128,
    navigationStatus: null,
    observedAt: "2026-08-21T08:02:52.000Z",
    displayName: "CLARITAS TEST",
    callsign: "9VTEST",
    shipType: "DR",
    registrationCountryIso2: "SG",
    destination: null,
  }]);
});

test("MPA parser also accepts explicitly zoned and plausibly UTC timestamps", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  const base = {
    vesselParticulars: { mmsiNumber: "563123456" },
    latitudeDegrees: 1.3,
    longitudeDegrees: 103.8,
  };
  assert.equal(
    parseMpaMaritimeObservations([
      { ...base, timeStamp: "2026-08-21 08:02:52" },
    ], now)[0]?.observedAt,
    "2026-08-21T08:02:52.000Z",
  );
  assert.equal(
    parseMpaMaritimeObservations([
      { ...base, timeStamp: "2026-08-21T16:02:52+08:00" },
    ], now)[0]?.observedAt,
    "2026-08-21T08:02:52.000Z",
  );
});

test("MPA parser rejects radians-only, stale, invalid, and future positions", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  const vesselParticulars = { mmsiNumber: "563123456" };
  assert.deepEqual(parseMpaMaritimeObservations([
    {
      vesselParticulars,
      latitude: 0.024,
      longitude: 1.8,
      timeStamp: "2026-08-21 08:04:00",
    },
    {
      vesselParticulars,
      latitudeDegrees: 91,
      longitudeDegrees: 103.8,
      timeStamp: "2026-08-21 08:04:00",
    },
    {
      vesselParticulars,
      latitudeDegrees: 1.3,
      longitudeDegrees: 103.8,
      timeStamp: "2026-08-21 07:40:00",
    },
    {
      vesselParticulars,
      latitudeDegrees: 1.3,
      longitudeDegrees: 103.8,
      timeStamp: "2026-08-21 16:20:00",
    },
  ], now), []);
});

test("MPA parser accepts only ISO alpha-2 provider flags", () => {
  const now = Date.parse("2026-08-21T08:05:00Z");
  const base = {
    latitudeDegrees: 1.3,
    longitudeDegrees: 103.8,
    timeStamp: "2026-08-21T16:02:52+08:00",
  };
  assert.equal(
    parseMpaMaritimeObservations([
      {
        ...base,
        vesselParticulars: { mmsiNumber: "563123456", flag: "Singapore" },
      },
    ], now)[0]?.registrationCountryIso2,
    null,
  );
});
