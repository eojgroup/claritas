// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceWorkspace from "./IntelligenceWorkspace";
import {
  fetchEventGibsContext,
  fetchIntelligenceAlerts,
  fetchIntelligenceEvent,
  fetchIntelligenceEvents,
  fetchIntelligenceWatchlist,
  type EarthObservation,
  type IntelligenceEvent,
} from "../lib/api";

vi.mock("../lib/api", () => ({
  acknowledgeIntelligenceAlert: vi.fn(),
  deleteIntelligenceWatch: vi.fn(),
  fetchEventGibsContext: vi.fn(),
  fetchIntelligenceAlerts: vi.fn(),
  fetchIntelligenceEvent: vi.fn(),
  fetchIntelligenceEvents: vi.fn(),
  fetchIntelligenceWatchlist: vi.fn(),
  imageProxy: (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`,
  saveIntelligenceWatch: vi.fn(),
}));

const event: IntelligenceEvent = {
  id: "11b7592c-4848-4c61-9777-7c9c4624038d",
  event_type: "wildfire",
  title: "Active fire near energy infrastructure",
  summary: "Observed thermal anomaly corroborates reported fire activity.",
  status: "active",
  severity: "high",
  confidence: 0.91,
  start_time: "2026-08-11T08:00:00Z",
  last_activity_time: "2026-08-11T09:00:00Z",
  primary_location_id: "2734f188-a62c-403d-bbd5-868349632d67",
  primary_country_iso2: "AE",
  source_diversity: 2,
  domain_count: 2,
  relevance_score: 0.9,
  urgency_score: 0.8,
  materiality_score: 0.85,
  location_name: "Port of Fujairah",
  evidence_count: 2,
  earth_observation_available: true,
};

const observation: EarthObservation = {
  id: "268281e5-4e11-4aa6-a711-f09dcb554594",
  event_id: event.id,
  location_id: event.primary_location_id,
  scene_id: "857171e3-51c1-44fc-9d1b-bb3dfd5b15b4",
  product_type: "true_color",
  status: "available",
  captured_at: "2026-08-11T08:30:00Z",
  provider: "copernicus",
  mission: "sentinel-2",
  collection: "sentinel-2-l2a",
  provider_scene_id: "S2-fixture",
  capture_start: "2026-08-11T08:30:00Z",
  cloud_cover: 4,
  resolution_m: 10,
  source_url: "https://sh.dataspace.copernicus.eu/catalog/v1/search",
  location_name: "Port of Fujairah",
  attribution: "Contains modified Copernicus Sentinel data",
  license: "Copernicus data terms",
  assets: [{
    id: "ce511c29-a3f5-4ac1-a185-af1f20da8125",
    asset_type: "preview",
    mime_type: "image/png",
    width: 1024,
    height: 768,
    size_bytes: 1024,
    generated_at: "2026-08-11T09:01:00Z",
    url: "/api/earth-observation/assets/ce511c29-a3f5-4ac1-a185-af1f20da8125",
  }],
};

describe("IntelligenceWorkspace", () => {
  beforeEach(() => {
    vi.mocked(fetchEventGibsContext).mockResolvedValue({
      provider: "nasa_gibs",
      event_id: event.id,
      location_name: "Port of Fujairah",
      observation_date: "2026-08-11",
      layers: [{
        layer_id: "MODIS_Terra_CorrectedReflectance_TrueColor",
        title: "MODIS Terra true color",
        category: "true_color",
        date: "2026-08-11",
        bbox: [56.2, 25.0, 56.5, 25.3],
        tile_url: "https://gibs.earthdata.nasa.gov/wmts/example/{z}/{y}/{x}.jpg",
        preview_url: "https://gibs.earthdata.nasa.gov/wms/example.jpg",
        provenance: {
          provider: "NASA EOSDIS GIBS",
          source_url: "https://gibs.earthdata.nasa.gov/wms/example.jpg",
          attribution: "NASA EOSDIS GIBS / MODIS Terra",
        },
      }],
      notice: "GIBS visualizations are contextual browse imagery, not automatic proof of physical change or causation.",
    });
    vi.mocked(fetchIntelligenceEvents).mockResolvedValue([event]);
    vi.mocked(fetchIntelligenceWatchlist).mockResolvedValue([]);
    vi.mocked(fetchIntelligenceAlerts).mockResolvedValue([]);
    vi.mocked(fetchIntelligenceEvent).mockResolvedValue({
      event,
      evidence: [{
        id: "07882387-9088-4530-bfe5-1ac9c17aaabe",
        domain: "earth_observation",
        evidence_type: "active_fire_hotspot",
        source_record_type: "earth_fire_detection",
        source_record_id: "fixture",
        observed_at: "2026-08-11T08:15:00Z",
        confidence: 0.94,
        relationship: "observed",
        source_name: "nasa-firms",
        source_title: "Active fire hotspot",
        source_summary: "Thermal anomaly observed before the first news report.",
        source_url: "https://firms.modaps.eosdis.nasa.gov/",
        attribution: "NASA FIRMS",
        license: "NASA Earth Science open data policy",
      }],
      locations: [],
      earth_observations: [observation],
      related_events: [],
      epistemic_notice: "Correlation does not establish causation.",
    });
  });
  afterEach(cleanup);

  it("renders event detail, satellite context, evidence labels, provenance, and uncertainty", async () => {
    render(<IntelligenceWorkspace initialCountry="AE" />);
    expect(await screen.findByRole("heading", { name: event.title })).toBeTruthy();
    expect((await screen.findByAltText(/true_color observation/i)).getAttribute("loading")).toBe("lazy");
    expect((await screen.findByAltText(/NASA GIBS true-color context/i)).getAttribute("loading")).toBe("lazy");
    expect(screen.getByText("Context · not proof")).toBeTruthy();
    expect(screen.getByRole("link", { name: /NASA GIBS provenance/i }).getAttribute("href")).toBe("https://gibs.earthdata.nasa.gov/wms/example.jpg");
    expect(screen.getByText("Observed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active fire hotspot" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open source/i }).getAttribute("href")).toBe("https://firms.modaps.eosdis.nasa.gov/");
    expect(screen.getByText("Attribution: NASA FIRMS")).toBeTruthy();
    expect(screen.getByText(/Correlation does not establish causation/i)).toBeTruthy();
  });

  it("opens the exact event id supplied by an alert", async () => {
    const alertEventId = "de51ed95-3a5c-4e94-8c27-52687c618471";
    const onSelectEvent = vi.fn();
    vi.mocked(fetchIntelligenceAlerts).mockResolvedValue([{
      id: "f9916c1d-e54c-42dc-8ecb-ad16650a0632",
      event_id: alertEventId,
      severity: "high",
      title: "New corroborating observation",
      body: "Satellite evidence became available.",
      event_type: "wildfire",
      eligibility_status: "eligible",
      created_at: "2026-08-11T09:00:00Z",
      updated_at: "2026-08-11T09:00:00Z",
    }]);
    render(<IntelligenceWorkspace initialEventId={event.id} onSelectEvent={onSelectEvent} />);
    fireEvent.click(await screen.findByRole("button", { name: /New corroborating observation/i }));
    expect(onSelectEvent).toHaveBeenLastCalledWith(alertEventId);
  });

  it("keeps the event workspace available when optional watches and alerts fail", async () => {
    vi.mocked(fetchIntelligenceWatchlist).mockRejectedValue(new Error("watch service unavailable"));
    vi.mocked(fetchIntelligenceAlerts).mockRejectedValue(new Error("alert service unavailable"));
    render(<IntelligenceWorkspace initialEventId={event.id} />);
    expect(await screen.findByRole("heading", { name: event.title })).toBeTruthy();
    expect(screen.queryByText(/watch service unavailable/i)).toBeNull();
  });

  it("clears exact-event detail when navigation removes the event id", async () => {
    const view = render(<IntelligenceWorkspace initialEventId={event.id} />);
    expect(await screen.findByRole("heading", { name: event.title })).toBeTruthy();
    view.rerender(<IntelligenceWorkspace initialEventId={null} />);
    expect(await screen.findByText("Select an event to inspect its evidence thread.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: event.title })).toBeNull();
  });

  it("removes stale detail and scopes a failed event request to the detail panel", async () => {
    const missingId = "3f92373b-a9fe-422f-b640-cb48dfec43af";
    vi.mocked(fetchIntelligenceEvent).mockImplementation(async (id) => {
      if (id === missingId) throw new Error("event no longer available");
      return {
        event,
        evidence: [],
        locations: [],
        earth_observations: [observation],
        related_events: [],
        epistemic_notice: "Correlation does not establish causation.",
      };
    });
    const view = render(<IntelligenceWorkspace initialEventId={event.id} />);
    expect(await screen.findByRole("heading", { name: event.title })).toBeTruthy();
    view.rerender(<IntelligenceWorkspace initialEventId={missingId} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/event no longer available/i);
    await waitFor(() => expect(screen.queryByRole("heading", { name: event.title })).toBeNull());
    expect(screen.getByText(event.title)).toBeTruthy();
  });

  it("opens imagery with the selected event id", async () => {
    const onOpenImagery = vi.fn();
    render(<IntelligenceWorkspace initialEventId={event.id} onOpenImagery={onOpenImagery} />);
    await screen.findByRole("heading", { name: event.title });
    fireEvent.click(screen.getByRole("button", { name: "Inspect event imagery" }));
    expect(onOpenImagery).toHaveBeenCalledWith(event.id);
  });
});
