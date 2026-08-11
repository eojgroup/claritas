import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_GIBS_LAYERS,
  GIBS_ACKNOWLEDGEMENT,
  buildApprovedGibsEventLayers,
  buildApprovedGibsPreviewUrl,
  buildApprovedGibsTileTemplate,
} from "./nasa-gibs";

test("GIBS exposes only reviewed HTTPS WMTS templates", () => {
  assert.ok(APPROVED_GIBS_LAYERS.length > 0);
  for (const layer of APPROVED_GIBS_LAYERS) {
    const template = buildApprovedGibsTileTemplate(layer.id, "2026-08-11");
    assert.match(template, /^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg4326\/best\//);
    assert.ok(template.includes(layer.id));
  }
  assert.throws(() => buildApprovedGibsTileTemplate("unreviewed-layer", "2026-08-11"), /allowlist/);
  assert.throws(() => buildApprovedGibsTileTemplate(APPROVED_GIBS_LAYERS[0].id, "11-08-2026"), /YYYY-MM-DD/);
});

test("GIBS previews use the reviewed WMS host and EPSG:4326 axis order", () => {
  const url = new URL(buildApprovedGibsPreviewUrl(
    APPROVED_GIBS_LAYERS[0].id,
    "2026-08-11",
    [10, 20, 12, 21],
  ));
  assert.equal(url.origin, "https://gibs.earthdata.nasa.gov");
  assert.equal(url.pathname, "/wms/epsg4326/best/wms.cgi");
  assert.equal(url.searchParams.get("BBOX"), "20,10,21,12");
  assert.equal(url.searchParams.get("TIME"), "2026-08-11");
  assert.equal(url.searchParams.get("LAYERS"), APPROVED_GIBS_LAYERS[0].id);
  assert.equal(url.searchParams.get("WIDTH"), "1280");
  assert.equal(url.searchParams.get("HEIGHT"), "724");
  assert.throws(
    () => buildApprovedGibsPreviewUrl("unreviewed-layer", "2026-08-11", [10, 20, 12, 21]),
    /allowlist/,
  );
});

test("GIBS event context is date-specific, bounded, allowlisted, and provenance-bearing", () => {
  const layers = buildApprovedGibsEventLayers({ date: "2026-08-11", bbox: [10, 20, 11, 21] });
  assert.equal(layers.length, APPROVED_GIBS_LAYERS.length);
  assert.deepEqual(layers.map((layer) => layer.layer_id), APPROVED_GIBS_LAYERS.map((layer) => layer.id));
  for (const layer of layers) {
    assert.equal(layer.date, "2026-08-11");
    assert.deepEqual(layer.bbox, [10, 20, 11, 21]);
    assert.equal(layer.provenance.provider, "NASA EOSDIS GIBS");
    assert.equal(layer.provenance.observation_date, "2026-08-11");
    assert.equal(layer.provenance.acknowledgement, GIBS_ACKNOWLEDGEMENT);
    assert.equal(layer.provenance.source_url, layer.preview_url);
    assert.match(layer.preview_url, /^https:\/\/gibs\.earthdata\.nasa\.gov\/wms\//);
    assert.equal(layer.quality_tier, "regional_browse_context");
    assert.equal(layer.evidence_role, "context_not_confirmation");
    assert.ok(layer.native_resolution_m >= 250);
  }
  assert.throws(
    () => buildApprovedGibsEventLayers({ date: "2026-02-31", bbox: [10, 20, 11, 21] }),
    /valid YYYY-MM-DD/,
  );
});
