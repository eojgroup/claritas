import assert from "node:assert/strict";
import test from "node:test";
import { APPROVED_GIBS_LAYERS, buildApprovedGibsTileTemplate } from "./nasa-gibs";

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
