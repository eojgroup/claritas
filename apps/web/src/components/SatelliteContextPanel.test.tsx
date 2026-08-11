// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SatelliteContextPanel from "./SatelliteContextPanel";
import { fetchEventGibsContext, fetchIntelligenceEvent, fetchIntelligenceEvents } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchEventGibsContext: vi.fn(),
  fetchIntelligenceEvent: vi.fn(),
  fetchIntelligenceEvents: vi.fn(),
  imageProxy: (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`,
}));

const event = {
  id: "11b7592c-4848-4c61-9777-7c9c4624038d",
  event_type: "transport_disruption",
  title: "Movement disruption near Panama Canal",
  summary: "Reported and derived signals are being monitored.",
  status: "active" as const,
  severity: "high" as const,
  confidence: 0.83,
  start_time: "2026-08-11T08:00:00Z",
  last_activity_time: "2026-08-11T09:00:00Z",
  primary_location_id: "2734f188-a62c-403d-bbd5-868349632d67",
  primary_country_iso2: "PA",
  source_diversity: 2,
  domain_count: 2,
  relevance_score: 0.81,
  urgency_score: 0.7,
  materiality_score: 0.8,
  location_name: "Panama Canal",
  evidence_count: 3,
  earth_observation_available: false,
};

describe("SatelliteContextPanel", () => {
  beforeEach(() => {
    vi.mocked(fetchIntelligenceEvents).mockResolvedValue([event]);
    vi.mocked(fetchIntelligenceEvent).mockResolvedValue({
      event,
      evidence: [],
      locations: [],
      earth_observations: [],
      related_events: [],
      epistemic_notice: "Correlation does not establish causation.",
    });
    vi.mocked(fetchEventGibsContext).mockResolvedValue({
      event_id: event.id,
      context_scope: "location",
      layers: [{
        layer_id: "MODIS_Terra_CorrectedReflectance_TrueColor",
        title: "MODIS Terra true color",
        category: "true_color",
        date: "2026-08-11",
        bbox: [-79.95, 8.75, -79.45, 9.45],
        tile_url: "https://gibs.earthdata.nasa.gov/wmts/example.jpg",
        preview_url: "https://gibs.earthdata.nasa.gov/wms/example.jpg",
        provenance: {
          provider: "NASA EOSDIS GIBS",
          source_url: "https://gibs.earthdata.nasa.gov/wms/example.jpg",
          attribution: "NASA EOSDIS GIBS / MODIS Terra",
        },
      }],
      notice: "Linked-location context, not event evidence.",
    });
  });
  afterEach(cleanup);

  it("shows linked-location browse imagery on Overview and opens the exact event", async () => {
    const onOpenEvent = vi.fn();
    const onOpenImagery = vi.fn();
    render(<SatelliteContextPanel country="PA" onOpenEvent={onOpenEvent} onOpenImagery={onOpenImagery} />);
    const image = await screen.findByAltText(/NASA GIBS · linked location/i);
    expect(image.getAttribute("src")).toContain("/api/proxy-image?url=");
    expect(screen.getByText("Browse context · not proof")).toBeTruthy();
    expect(screen.getByText("Linked-location context, not event evidence.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open evidence thread/i }));
    expect(onOpenEvent).toHaveBeenCalledWith(event.id);
    fireEvent.click(screen.getByRole("button", { name: /Inspect imagery/i }));
    expect(onOpenImagery).toHaveBeenCalledWith(event.id);
  });
});
