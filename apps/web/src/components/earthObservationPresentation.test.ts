import { describe, expect, it } from "vitest";
import type { EarthObservation } from "../lib/api";
import {
  earthObservationProductLabel,
  selectOverviewObservation,
  sortEarthObservationsForDisplay,
} from "./earthObservationPresentation";

function observation(product_type: string, captured = "2026-08-11T08:00:00Z"): EarthObservation {
  return {
    id: product_type,
    scene_id: "scene",
    product_type,
    status: "available",
    captured_at: captured,
    provider: "copernicus",
    mission: "sentinel-2",
    collection: "sentinel-2-l2a",
    provider_scene_id: "provider-scene",
    capture_start: captured,
    source_url: "https://example.test/scene",
    assets: [{
      id: `asset-${product_type}`,
      asset_type: "preview",
      mime_type: "image/png",
      width: 1024,
      height: 768,
      size_bytes: 12,
      generated_at: captured,
      url: `/api/earth-observation/assets/${product_type}`,
    }],
  };
}

describe("Earth observation presentation", () => {
  it("puts readable visual products ahead of analytical indices", () => {
    const sorted = sortEarthObservationsForDisplay([
      observation("burn_index", "2026-08-12T08:00:00Z"),
      observation("true_color", "2026-08-11T08:00:00Z"),
      observation("sar", "2026-08-13T08:00:00Z"),
    ]);
    expect(sorted.map((item) => item.product_type)).toEqual(["true_color", "sar", "burn_index"]);
  });

  it("uses browse true color instead of promoting a burn index to overview hero", () => {
    expect(selectOverviewObservation([observation("burn_index")], true)).toBeNull();
    expect(selectOverviewObservation([observation("burn_index"), observation("true_color")], true)?.product_type)
      .toBe("true_color");
  });

  it("uses reader-facing product names", () => {
    expect(earthObservationProductLabel("burn_index")).toBe("Burn-sensitive index");
    expect(earthObservationProductLabel("true_color")).toBe("Natural color");
  });
});
