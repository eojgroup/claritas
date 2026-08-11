import assert from "node:assert/strict";
import test from "node:test";

test("USGS GeoJSON parser retains magnitude, depth, tsunami and source timing", async () => {
  process.env.DB_HOST ||= "127.0.0.1";
  process.env.DB_NAME ||= "claritas_test";
  process.env.DB_USER ||= "claritas_test";
  process.env.DB_PASSWORD ||= "claritas_test";
  const { parseUsgsGeoJson } = await import("./usgs-earthquakes");
  const rows = parseUsgsGeoJson({ features: [{
    id: "us-test", geometry: { type: "Point", coordinates: [56.2, 26.5, 12.3] },
    properties: {
      mag: 7.1, magType: "mww", place: "near a major port", sig: 780,
      tsunami: 1, felt: 120, alert: "orange",
      time: Date.parse("2026-08-11T01:02:03Z"), updated: Date.parse("2026-08-11T01:08:00Z"),
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us-test",
    },
  }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].magnitude, 7.1);
  assert.equal(rows[0].depthKm, 12.3);
  assert.equal(rows[0].tsunami, true);
  assert.equal(rows[0].observedAt.toISOString(), "2026-08-11T01:02:03.000Z");
});
