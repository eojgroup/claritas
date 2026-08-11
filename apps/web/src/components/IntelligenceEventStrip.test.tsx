// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceEventStrip from "./IntelligenceEventStrip";
import { fetchIntelligenceEvents, type IntelligenceEvent } from "../lib/api";

vi.mock("../lib/api", () => ({ fetchIntelligenceEvents: vi.fn() }));

const event: IntelligenceEvent = {
  id: "2baac726-a118-416c-b0ec-da308a1da9a2",
  event_type: "earthquake",
  title: "M7.2 earthquake near strategic port",
  summary: "USGS observation with cross-domain context.",
  status: "active",
  severity: "critical",
  confidence: 0.96,
  start_time: "2026-08-11T09:00:00Z",
  last_activity_time: "2026-08-11T09:05:00Z",
  primary_location_id: null,
  primary_country_iso2: "SG",
  source_diversity: 2,
  domain_count: 3,
  relevance_score: 0.94,
  urgency_score: 0.91,
  materiality_score: 0.89,
  location_name: "Port of Singapore",
  evidence_count: 4,
  earth_observation_available: true,
};

describe("IntelligenceEventStrip", () => {
  beforeEach(() => {
    vi.mocked(fetchIntelligenceEvents).mockReset();
  });
  afterEach(cleanup);

  it("renders an accessible empty state without fabricating a signal", async () => {
    vi.mocked(fetchIntelligenceEvents).mockResolvedValue([]);
    render(<IntelligenceEventStrip onOpen={() => undefined} />);
    expect(await screen.findByText("No material correlated changes")).toBeTruthy();
    expect(screen.getByRole("region", { name: "High-impact intelligence events" })).toBeTruthy();
  });

  it("distinguishes loading from a true empty result", async () => {
    let resolveRequest: (rows: IntelligenceEvent[]) => void = () => undefined;
    vi.mocked(fetchIntelligenceEvents).mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    render(<IntelligenceEventStrip onOpen={() => undefined} />);
    expect(screen.getByText("Loading correlated changes…")).toBeTruthy();
    expect(screen.queryByText("No material correlated changes")).toBeNull();
    await act(async () => resolveRequest([]));
    expect(await screen.findByText("No material correlated changes")).toBeTruthy();
  });

  it("renders priority, confidence, provenance counts, and opens the workspace", async () => {
    const onOpen = vi.fn();
    vi.mocked(fetchIntelligenceEvents).mockResolvedValue([event]);
    render(<IntelligenceEventStrip country="SG" onOpen={onOpen} />);
    expect(await screen.findByText(event.title)).toBeTruthy();
    expect(screen.getByText("96% confidence")).toBeTruthy();
    expect(screen.getByText(/3 domains · 4 evidence/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open workspace/i }));
    expect(onOpen).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByRole("button", { name: `Investigate ${event.title}` }));
    expect(onOpen).toHaveBeenLastCalledWith(event.id);
  });

  it("degrades to a bounded error message", async () => {
    let rejectRequest: (reason: unknown) => void = () => undefined;
    vi.mocked(fetchIntelligenceEvents).mockImplementation(() => new Promise((_, reject) => {
      rejectRequest = reject;
    }));
    render(<IntelligenceEventStrip onOpen={() => undefined} />);
    await act(async () => rejectRequest(new Error("offline")));
    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy();
  });
});
