// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceWorkspace from "./IntelligenceWorkspace";
import {
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
  fetchIntelligenceAlerts: vi.fn(),
  fetchIntelligenceEvent: vi.fn(),
  fetchIntelligenceEvents: vi.fn(),
  fetchIntelligenceWatchlist: vi.fn(),
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
    expect(screen.getByText(/active fire hotspot · observed/i)).toBeTruthy();
    expect(screen.getByText("Attribution: NASA FIRMS")).toBeTruthy();
    expect(screen.getByText(/Correlation does not establish causation/i)).toBeTruthy();
  });
});
