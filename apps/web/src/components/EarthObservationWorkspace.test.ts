import { describe, expect, it } from "vitest";
import { findDefensibleComparisonPair, reconcileValidatedComparisonPair } from "./earthObservationComparison";
import type { EarthObservation } from "../lib/api";

function observation(id: string, eventId: string | null, locationId: string | null, capture: string): EarthObservation {
  return {
    id,
    event_id: eventId,
    location_id: locationId,
    scene_id: `${id}-scene`,
    product_type: "true_color",
    status: "available",
    captured_at: capture,
    provider: "copernicus",
    mission: "sentinel-2",
    collection: "sentinel-2-l2a",
    provider_scene_id: `${id}-provider-scene`,
    capture_start: capture,
    source_url: "https://dataspace.copernicus.eu/",
    assets: [{ id: `${id}-asset`, asset_type: "preview", mime_type: "image/png", width: 100, height: 100, size_bytes: 100, generated_at: capture, url: `/${id}.png` }],
  };
}

describe("findDefensibleComparisonPair", () => {
  it("never compares observations from unrelated events", () => {
    const rows = [
      observation("before", "event-a", "location-a", "2026-08-10T08:00:00Z"),
      observation("after", "event-b", "location-a", "2026-08-11T08:00:00Z"),
    ];
    expect(findDefensibleComparisonPair(rows)).toBeNull();
  });

  it("uses a chronological pair from the same scoped event", () => {
    const rows = [
      observation("before", "event-a", "location-a", "2026-08-10T08:00:00Z"),
      observation("after", "event-a", "location-a", "2026-08-11T08:00:00Z"),
    ];
    expect(findDefensibleComparisonPair(rows, "event-a")?.before.id).toBe("before");
    expect(findDefensibleComparisonPair(rows, "event-a")?.after.id).toBe("after");
  });

  it("uses exact event scope as the shared AOI when both locations are null", () => {
    const rows = [
      observation("before", "event-a", null, "2026-08-10T08:00:00Z"),
      observation("after", "event-a", null, "2026-08-11T08:00:00Z"),
      observation("other-event", "event-b", null, "2026-08-12T08:00:00Z"),
    ];

    const pair = findDefensibleComparisonPair(rows, "event-a");
    expect(pair?.before.id).toBe("before");
    expect(pair?.after.id).toBe("after");
    expect(findDefensibleComparisonPair([
      observation("event-a-only", "event-a", null, "2026-08-10T08:00:00Z"),
      observation("event-b-only", "event-b", null, "2026-08-11T08:00:00Z"),
    ], "event-a")).toBeNull();
  });

  it("does not automatically promote analytical products into the comparison canvas", () => {
    const rows = [
      { ...observation("before", "event-a", "location-a", "2026-08-10T08:00:00Z"), product_type: "burn_index" },
      { ...observation("after", "event-a", "location-a", "2026-08-11T08:00:00Z"), product_type: "burn_index" },
    ];
    expect(findDefensibleComparisonPair(rows, "event-a")).toBeNull();
    expect(reconcileValidatedComparisonPair(rows, {
      status: "available",
      before: { id: rows[0].scene_id },
      after: { id: rows[1].scene_id },
    }, "event-a")).toBeNull();
  });

  it("fails closed when the backend rejects or selects a different comparison", () => {
    const before = observation("before", "event-a", "location-a", "2026-08-10T08:00:00Z");
    const after = observation("after", "event-a", "location-a", "2026-08-11T08:00:00Z");
    expect(reconcileValidatedComparisonPair([before, after], { status: "unavailable" }, "event-a"))
      .toBeNull();
    expect(reconcileValidatedComparisonPair([before, after], {
      status: "available",
      before: { id: before.scene_id },
      after: { id: "different-scene" },
    }, "event-a")).toBeNull();
    expect(reconcileValidatedComparisonPair([before, after], {
      status: "limited_comparability",
      before: { id: before.scene_id },
      after: { id: after.scene_id },
    }, "event-a")?.after.id).toBe("after");
  });
});
