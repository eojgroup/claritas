import { describe, expect, it } from "vitest";
import type { EarthObservation } from "../lib/api";
import {
  earthObservationEvidenceLabel,
  earthObservationTimestamp,
  summarizeEarthObservationScope,
} from "./earthObservationWorkspacePresentation";

function observation(overrides: Partial<EarthObservation> = {}): EarthObservation {
  return {
    id: "observation-1",
    event_id: "event-1",
    scene_id: "scene-1",
    product_type: "true_color",
    status: "available",
    captured_at: "2026-08-11T12:34:56Z",
    provider: "copernicus",
    mission: "sentinel-2",
    collection: "sentinel-2-l2a",
    provider_scene_id: "provider-scene-1",
    capture_start: "2026-08-11T12:34:56Z",
    source_url: "https://example.test/scene",
    assets: [{ id: "preview", asset_type: "preview", mime_type: "image/png", width: 100, height: 100, size_bytes: 1, generated_at: "2026-08-11T12:34:56Z", url: "/preview.png" }],
    imagery: {
      label: "Natural colour",
      visual_class: "natural",
      evidence_role: "visual_context",
      natural_color: true,
      interpretation: "Context only",
      quality_tier: "high_resolution_processed",
    },
    ...overrides,
  };
}

describe("earth observation workspace presentation", () => {
  it("formats acquisition time with seconds", () => {
    expect(earthObservationTimestamp("2026-08-11T12:34:56Z", "en-GB", "UTC"))
      .toMatch(/12:34:56/);
  });

  it("keeps model interpretation epistemically separate from the sensor image", () => {
    expect(earthObservationEvidenceLabel(observation({
      model_interpretation: {
        summary: "Possible change",
        epistemic_class: "model_interpretation",
        notice: "Model-generated interpretation",
      },
    }))).toBe("Sensor image + model interpretation");
  });

  it("counts unreadable records as pending instead of image cards", () => {
    const summary = summarizeEarthObservationScope([
      observation(),
      observation({ id: "pending", assets: [], imagery: undefined }),
    ]);
    expect(summary).toMatchObject({ total: 2, readable: 1, pending: 1, natural: 1 });
  });
});
