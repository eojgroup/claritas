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
    expect(screen.getByText("Context only · not proof")).toBeTruthy();
    expect(screen.getByText(/Regional NASA browse layer shown at a bounded size/i)).toBeTruthy();
    expect(screen.getByText("Linked-location context, not event evidence.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open evidence thread/i }));
    expect(onOpenEvent).toHaveBeenCalledWith(event.id);
    fireEvent.click(screen.getByRole("button", { name: /Inspect imagery/i }));
    expect(onOpenImagery).toHaveBeenCalledWith(event.id);
  });

  it("does not promote a burn index to the overview hero when true-color browse context exists", async () => {
    const eventWithObservation = { ...event, earth_observation_available: true };
    vi.mocked(fetchIntelligenceEvents).mockResolvedValue([eventWithObservation]);
    vi.mocked(fetchIntelligenceEvent).mockResolvedValue({
      event: eventWithObservation,
      evidence: [],
      locations: [],
      earth_observations: [{
        id: "burn-observation",
        event_id: event.id,
        scene_id: "scene",
        product_type: "burn_index",
        status: "available",
        captured_at: "2026-08-11T08:30:00Z",
        provider: "copernicus",
        mission: "sentinel-2",
        collection: "sentinel-2-l2a",
        provider_scene_id: "S2-burn",
        capture_start: "2026-08-11T08:30:00Z",
        source_url: "https://example.test/scene",
        assets: [{
          id: "burn-asset",
          asset_type: "preview",
          mime_type: "image/png",
          width: 1024,
          height: 768,
          size_bytes: 1024,
          generated_at: "2026-08-11T09:00:00Z",
          url: "/api/earth-observation/assets/burn-asset",
        }],
      }],
      related_events: [],
      epistemic_notice: "Correlation does not establish causation.",
    });

    render(<SatelliteContextPanel onOpenEvent={vi.fn()} onOpenImagery={vi.fn()} />);
    const image = await screen.findByAltText(/NASA GIBS · linked location/i);
    expect(image.getAttribute("src")).toContain("gibs.earthdata.nasa.gov");
    expect(screen.getByText("Context only · not proof")).toBeTruthy();
    expect(screen.queryByText(/Burn-sensitive index/i)).toBeNull();
  });

  it("uses the contract-selected high-resolution asset without silently falling back to browse pixels", async () => {
    const eventWithObservation = { ...event, earth_observation_available: true };
    const highResolutionAsset = {
      id: "preview-high",
      asset_type: "preview",
      mime_type: "image/png",
      width: 1536,
      height: 1024,
      size_bytes: 4096,
      generated_at: "2026-08-11T09:00:00Z",
      url: "/api/earth-observation/assets/preview-high",
    };
    vi.mocked(fetchIntelligenceEvents).mockResolvedValue([eventWithObservation]);
    vi.mocked(fetchIntelligenceEvent).mockResolvedValue({
      event: eventWithObservation,
      evidence: [],
      locations: [],
      earth_observations: [{
        id: "natural-observation",
        event_id: event.id,
        scene_id: "scene-natural",
        product_type: "true_color",
        status: "available",
        captured_at: "2026-08-11T08:30:00Z",
        provider: "copernicus",
        mission: "sentinel-2",
        collection: "sentinel-2-l2a",
        provider_scene_id: "S2-natural",
        capture_start: "2026-08-11T08:30:00Z",
        source_url: "https://example.test/scene",
        assets: [{ ...highResolutionAsset, id: "thumbnail", asset_type: "thumbnail", width: 320, url: "/api/earth-observation/assets/thumbnail" }, highResolutionAsset],
        imagery: {
          label: "Natural color",
          visual_class: "natural",
          evidence_role: "visual_context",
          natural_color: true,
          interpretation: "Human-readable event-scoped scene.",
          quality_tier: "high_resolution_processed",
          native_resolution_m: 10,
          effective_pixel_size_m: 14.8,
          preferred_asset: highResolutionAsset,
          display_guidance: "Use the preview asset for primary display.",
        },
        event_context: {
          id: event.id,
          news: { count: 2, items: [] },
          linkage: { relationship: "event_scoped_observation", scope: "Event geography", limitation: "Alignment does not by itself prove causation." },
        },
        analysis_summary: "Possible access-road flooding is visible.",
        analysis_summary_role: "model_interpretation",
        model_interpretation: {
          summary: "Possible access-road flooding is visible.",
          findings: ["Standing water is visible beside the terminal road."],
          possible_changes: ["Road access may have narrowed since the prior observation."],
          confidence: 0.62,
          model: "free-vision-model",
          epistemic_class: "model_interpretation",
          notice: "Model-generated interpretation; not an independent sensor measurement.",
        },
      }],
      related_events: [],
      epistemic_notice: "Correlation does not establish causation.",
    });

    render(<SatelliteContextPanel onOpenEvent={vi.fn()} onOpenImagery={vi.fn()} />);
    const image = await screen.findByAltText(/sentinel-2 · natural color/i);
    expect(image.getAttribute("src")).toBe(highResolutionAsset.url);
    expect(screen.getByText(/High-resolution processed scene · 10 m native resolution · 14.8 m effective pixel size/i)).toBeTruthy();
    expect(screen.getByText(/2 linked reports/i)).toBeTruthy();
    expect(screen.getByText(/does not by itself prove causation/i)).toBeTruthy();
    expect(screen.getByText(/Model interpretation · not a sensor measurement/i)).toBeTruthy();
    expect(screen.getByText("Possible access-road flooding is visible.")).toBeTruthy();
    expect(screen.getByText("Observed feature:").parentElement?.textContent).toContain("Standing water is visible");
    expect(screen.getByText("Possible change:").parentElement?.textContent).toContain("Road access may have narrowed");
  });
});
