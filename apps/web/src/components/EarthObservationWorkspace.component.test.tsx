// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchEarthObservations,
  fetchIntelligenceEvent,
  requestEarthObservationComparison,
  type IntelligenceEventDetail,
} from "../lib/api";
import EarthObservationWorkspace from "./EarthObservationWorkspace";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fetchEarthObservations: vi.fn(),
  fetchIntelligenceEvent: vi.fn(),
  requestEarthObservationComparison: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function eventDetail(id: string, title: string, country: string): IntelligenceEventDetail {
  return {
    event: {
      id,
      event_type: "wildfire",
      title,
      summary: `${title} summary`,
      status: "active",
      severity: "high",
      confidence: 0.9,
      start_time: "2026-08-11T10:00:00.000Z",
      last_activity_time: "2026-08-11T10:05:00.000Z",
      primary_location_id: null,
      primary_country_iso2: country,
      source_diversity: 2,
      domain_count: 2,
      relevance_score: 0.8,
      urgency_score: 0.7,
      materiality_score: 0.6,
      location_name: `${country} test site`,
      latitude: 1,
      longitude: 2,
      evidence_count: 2,
      earth_observation_available: false,
    },
    understanding: {
      what_happened: `${title} understood`,
      where: `${country} test site`,
      why_interesting: "Material event context.",
      linked_news_count: 2,
      physical_observation_count: 0,
      location_basis: "source_observed",
      coordinates: {
        latitude: 1,
        longitude: 2,
        label: "1.0000° N, 2.0000° E",
        basis: "source_observed",
      },
    },
    evidence: [],
    linked_news: [],
    locations: [],
    earth_observations: [],
    related_events: [],
    epistemic_notice: "Correlation does not establish causation.",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("EarthObservationWorkspace event scope", () => {
  it("keeps canonical event context when no observation exists yet", async () => {
    vi.mocked(fetchEarthObservations).mockResolvedValue({
      observations: [],
      providers: [],
      provider_notice: "No suitable observation is currently available.",
    });
    vi.mocked(fetchIntelligenceEvent).mockResolvedValue(eventDetail("event-a", "Port fire", "NL"));
    vi.mocked(requestEarthObservationComparison).mockResolvedValue({ status: "unavailable" });

    render(<EarthObservationWorkspace eventId="event-a" />);

    expect(await screen.findByRole("heading", { name: "Port fire" })).toBeTruthy();
    expect(screen.getAllByText("NL test site").length).toBeGreaterThan(0);
    expect(screen.getByText("2 linked news reports")).toBeTruthy();
    expect(screen.getByText(/No readable event imagery is available yet/)).toBeTruthy();
  });

  it("ignores a late response from a previously selected event", async () => {
    const firstObservations = deferred<Awaited<ReturnType<typeof fetchEarthObservations>>>();
    const firstDetail = deferred<IntelligenceEventDetail>();
    vi.mocked(fetchEarthObservations).mockImplementation((params) => (
      params?.eventId === "event-a"
        ? firstObservations.promise
        : Promise.resolve({ observations: [], providers: [], provider_notice: null })
    ));
    vi.mocked(fetchIntelligenceEvent).mockImplementation((id) => (
      id === "event-a" ? firstDetail.promise : Promise.resolve(eventDetail("event-b", "Current event", "SG"))
    ));

    const view = render(<EarthObservationWorkspace eventId="event-a" />);
    view.rerender(<EarthObservationWorkspace eventId="event-b" />);

    expect(await screen.findByRole("heading", { name: "Current event" })).toBeTruthy();
    await act(async () => {
      firstObservations.resolve({ observations: [], providers: [], provider_notice: null });
      firstDetail.resolve(eventDetail("event-a", "Stale event", "NL"));
      await Promise.all([firstObservations.promise, firstDetail.promise]);
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Stale event" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Current event" })).toBeTruthy();
  });
});
