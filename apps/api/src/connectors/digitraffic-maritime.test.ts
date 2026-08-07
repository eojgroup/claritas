import assert from "node:assert/strict";
import test from "node:test";
import { parseDigitrafficMaritimeObservations } from "./digitraffic-maritime";

test("Digitraffic AIS parser joins fresh positions with vessel metadata", () => {
  const now = Date.parse("2026-08-07T15:00:00Z");
  const observations = parseDigitrafficMaritimeObservations(
    {
      type: "FeatureCollection",
      features: [
        {
          mmsi: 230123456,
          geometry: { type: "Point", coordinates: [24.95, 60.17] },
          properties: {
            sog: 12.4,
            cog: 182.5,
            heading: 180,
            navStat: 0,
            timestampExternal: now - 30_000,
          },
        },
      ],
    },
    [{
      mmsi: 230123456,
      name: "CLARITAS TEST",
      callSign: "OABC",
      shipType: 70,
      destination: "FIHEL",
    }],
    now,
  );

  assert.deepEqual(observations, [{
    mmsi: "230123456",
    latitude: 60.17,
    longitude: 24.95,
    speed: 12.4,
    course: 182.5,
    heading: 180,
    navigationStatus: 0,
    observedAt: "2026-08-07T14:59:30.000Z",
    displayName: "CLARITAS TEST",
    callsign: "OABC",
    shipType: 70,
    destination: "FIHEL",
  }]);
});

test("Digitraffic AIS parser rejects stale and invalid positions", () => {
  const now = Date.parse("2026-08-07T15:00:00Z");
  const observations = parseDigitrafficMaritimeObservations(
    {
      features: [
        {
          mmsi: 230123456,
          geometry: { coordinates: [24.95, 60.17] },
          properties: { timestampExternal: now - 16 * 60_000 },
        },
        {
          mmsi: "invalid",
          geometry: { coordinates: [24.95, 60.17] },
          properties: { timestampExternal: now - 30_000 },
        },
      ],
    },
    [],
    now,
  );
  assert.deepEqual(observations, []);
});
