import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscoveryDedupeKey,
  compatibleCopernicusProducts,
  requestedCopernicusProducts,
  resolveDiscoveryAoi,
  resolveTrustedEventCoordinates,
} from "./discovery-context";

test("exact event geography takes precedence over a broad nearest-location bbox", () => {
  const resolved = resolveDiscoveryAoi({
    eventLatitude: 35.51,
    eventLongitude: 139.79,
    locationBbox: [-180, -80, 180, 80],
    locationLatitude: 0,
    locationLongitude: 0,
  });
  assert.equal(resolved.source, "event_geography");
  assert.deepEqual(resolved.center, { latitude: 35.51, longitude: 139.79 });
  assert.ok(resolved.bbox[0] > 139 && resolved.bbox[2] < 141);
});

test("null coordinates fail closed instead of silently targeting null island", () => {
  assert.throws(
    () => resolveDiscoveryAoi({
      eventLatitude: null,
      eventLongitude: null,
      locationBbox: null,
      locationLatitude: null,
      locationLongitude: null,
    }),
    /requires valid event geography or location geometry/,
  );
  assert.throws(
    () => resolveDiscoveryAoi({ eventLatitude: 12, eventLongitude: null }),
    /event geography is incomplete/,
  );
});

test("location geometry remains a bounded fallback when event geography is absent", () => {
  const resolved = resolveDiscoveryAoi({
    eventLatitude: null,
    eventLongitude: null,
    locationBbox: [10, 20, 12, 21],
  });
  assert.equal(resolved.source, "location_bbox");
  assert.deepEqual(resolved.bbox, [10, 20, 12, 21]);
});

test("EO scheduling can reuse trusted canonical event geography after non-spatial corroboration", () => {
  assert.deepEqual(resolveTrustedEventCoordinates({
    incomingCoordinatesAreExact: false,
    canonicalLatitude: -42.25,
    canonicalLongitude: 166.75,
    canonicalCoordinatesAreExact: true,
  }), { latitude: -42.25, longitude: 166.75, source: "canonical_event" });
  assert.equal(resolveTrustedEventCoordinates({
    incomingCoordinatesAreExact: false,
    canonicalLatitude: 38,
    canonicalLongitude: -97,
    canonicalCoordinatesAreExact: false,
  }), null);
  assert.deepEqual(resolveTrustedEventCoordinates({
    incomingLatitude: 1.264,
    incomingLongitude: 103.84,
    incomingCoordinatesAreExact: true,
    canonicalLatitude: 0,
    canonicalLongitude: 0,
    canonicalCoordinatesAreExact: true,
  }), { latitude: 1.264, longitude: 103.84, source: "incoming_signal" });
});

test("discovery dedupe keys make bounded revisits explicit", () => {
  const input = { eventId: "event", locationId: "location" };
  assert.equal(buildDiscoveryDedupeKey(input), "scene-discovery:event:location");
  assert.equal(buildDiscoveryDedupeKey({ ...input, revisitNumber: 2 }), "scene-discovery:event:location:revisit-2");
  assert.equal(buildDiscoveryDedupeKey({ eventId: "event" }), "scene-discovery:event:event-aoi");
  assert.equal(buildDiscoveryDedupeKey({
    ...input,
    discoverySeries: "signal",
    discoveryWindow: "2026-08-11",
    revisitNumber: 1,
  }), "scene-discovery:event:location:signal:2026-08-11:revisit-1");
  assert.notEqual(
    buildDiscoveryDedupeKey({ ...input, discoverySeries: "signal", discoveryWindow: "2026-08-11", revisitNumber: 1 }),
    buildDiscoveryDedupeKey({ ...input, discoverySeries: "signal", discoveryWindow: "2026-08-12", revisitNumber: 1 }),
  );
  assert.notEqual(
    buildDiscoveryDedupeKey({ ...input, discoverySeries: "signal", discoveryWindow: "2026-08-11" }),
    buildDiscoveryDedupeKey({ ...input, discoverySeries: "admin", discoveryWindow: "2026-08-11" }),
  );
});

test("event product policy survives discovery and stays sensor-compatible", () => {
  const requested = requestedCopernicusProducts(["sar", "ndwi", "sar", "unsupported"]);
  assert.deepEqual(requested, ["sar", "ndwi"]);
  assert.deepEqual(compatibleCopernicusProducts("sentinel-1-grd", requested), ["sar"]);
  assert.deepEqual(compatibleCopernicusProducts("sentinel-2-l2a", requested), ["ndwi"]);
  assert.deepEqual(requestedCopernicusProducts(undefined), ["true_color"]);
});
