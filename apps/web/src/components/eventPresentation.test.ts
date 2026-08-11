import { describe, expect, it } from "vitest";
import type { IntelligenceEvent } from "../lib/api";
import { presentEvent } from "./eventPresentation";

const baseEvent: IntelligenceEvent = {
  id: "event",
  event_type: "geopolitical_development",
  title: "Port access negotiations enter a decisive phase",
  summary: "Multiple reports describe a change in negotiating posture.",
  status: "active",
  severity: "high",
  confidence: 0.82,
  start_time: "2026-08-11T08:00:00Z",
  last_activity_time: "2026-08-11T09:00:00Z",
  primary_location_id: null,
  primary_country_iso2: "RU",
  source_diversity: 2,
  domain_count: 2,
  relevance_score: 0.77,
  urgency_score: 0.64,
  materiality_score: 0.7,
  location_name: "Russia",
  evidence_count: 3,
  earth_observation_available: false,
};

describe("presentEvent", () => {
  it("keeps an informative headline and makes prioritization explicit", () => {
    const result = presentEvent(baseEvent);
    expect(result.headline).toBe(baseEvent.title);
    expect(result.locationLabel).toBe("Russia");
    expect(result.why).toContain("77% relevance");
    expect(result.why).toContain("3 linked items across 2 domains");
  });

  it("does not promote a raw actor token to the only event title", () => {
    const result = presentEvent({ ...baseEvent, title: "SPECIAL ENVOY / VLADIMIR PUTIN" });
    expect(result.headline).toBe("Geopolitical Development in Russia");
    expect(result.focus).toBe("Special Envoy / Vladimir Putin");
  });

  it("turns a country-only title into an event-and-place statement", () => {
    const result = presentEvent({ ...baseEvent, title: "Russia" });
    expect(result.headline).toBe("Geopolitical Development in Russia");
    expect(result.focus).toBeNull();
  });

  it("does not let a generic Global label override known geography", () => {
    const result = presentEvent({
      ...baseEvent,
      location_name: "Global",
      primary_country_iso2: "CO",
      location_type: "city",
      latitude: 4.12345,
      longitude: -73.98765,
      metadata: { exact_geography: true },
    });
    expect(result.locationLabel).toBe("Colombia");
    expect(result.locationBasis).toBe("Source-observed coordinates");
    expect(result.coordinateLabel).toBe("4.1235° N, 73.9877° W");
  });

  it("does not present a country reference point as an event coordinate", () => {
    const result = presentEvent({
      ...baseEvent,
      location_name: "Global",
      location_type: "country",
      latitude: 61.52,
      longitude: 105.31,
    });
    expect(result.locationLabel).toBe("Russia");
    expect(result.coordinateLabel).toBeNull();
  });

  it("does not coerce missing coordinates to Null Island", () => {
    const result = presentEvent({
      ...baseEvent,
      primary_country_iso2: null,
      location_name: "Global",
      latitude: null,
      longitude: null,
    });
    expect(result.locationLabel).toBe("Global");
    expect(result.coordinateLabel).toBeNull();
    expect(result.locationBasis).toBeNull();
  });
});
