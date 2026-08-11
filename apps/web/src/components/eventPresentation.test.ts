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
});
