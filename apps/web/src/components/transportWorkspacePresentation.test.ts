import { describe, expect, it } from "vitest";
import type { TransportOverview } from "../lib/api";
import { buildTransportScopeSignals, transportTimestamp } from "./transportWorkspacePresentation";

function overview(): TransportOverview {
  return {
    generated_at: "2026-08-11T12:00:00Z",
    detail: "full",
    summary: { active: 4, routed: 3, alerts: 1, linked_countries: 3, modes: {} as TransportOverview["summary"]["modes"] },
    countries: [],
    activity_ranking: {
      window_hours: 24,
      comparison: "previous_24_hours",
      countries: [{
        rank: 1, country: "NL", country_name: "Netherlands", activity_index: 80,
        current: { linked_entities: 3, ship_movements: 10, ship_departures: 4, ship_arrivals: 3, cargo_vessel_departures: 2, tracked_flights: 12, observed_movements: 22 },
        previous: { ship_movements: 5, tracked_flights: 5, observed_movements: 10 },
        momentum: { current: 22, previous: 10, change_pct: 120, direction: "up" },
        mode_mix: { maritime_pct: 45, aviation_pct: 55 },
      }],
      highlights: [],
      methodology: { index: "", momentum: "", coverage: "" },
    },
    routes: [
      { mode: "maritime", origin_country: "NL", origin_name: "Netherlands", destination_country: "GB", destination_name: "United Kingdom", active_count: 3, origin_basis: "observed", examples: [] },
      { mode: "aviation", origin_country: "US", origin_name: "United States", destination_country: "CA", destination_name: "Canada", active_count: 99, origin_basis: "observed", examples: [] },
    ],
    trends: {} as TransportOverview["trends"],
    takeaways: [], ports: [], activity: [], history: null,
    entities: [{
      id: "vessel", mode: "maritime", entity_id: "1", display_name: "Vessel", callsign: null, flight_number: null,
      registration: null, vehicle_type: null, vehicle_category: null, latitude: 52, longitude: 4, heading: 90, speed: 10,
      altitude: null, vertical_rate: null, current_country_iso2: "NL", origin_country_iso2: "NL", destination_country_iso2: "GB",
      registration_country_iso2: "NL", origin_name: "Rotterdam", destination_name: "London", origin_latitude: null,
      origin_longitude: null, destination_latitude: null, destination_longitude: null, current_location_name: "North Sea",
      route_label: "Rotterdam → London", linkage_basis: ["origin"], linkage_confidence: "high", status: "under_way",
      is_alert: true, source_name: "aisstream", observed_at: "2026-08-11T11:59:30Z",
      country_links: [{ role: "origin", country: "NL" }, { role: "destination", country: "GB" }],
    }],
    coverage: {} as TransportOverview["coverage"],
  };
}

describe("transport workspace presentation", () => {
  it("shows relative age and an exact timestamp with seconds", () => {
    const value = transportTimestamp("2026-08-11T11:59:30Z", Date.parse("2026-08-11T12:00:00Z"), "en-GB", "UTC");
    expect(value?.relative).toBe("30s ago");
    expect(value?.exact).toMatch(/11:59:30/);
  });

  it("derives actions only from the selected country scope", () => {
    const signals = buildTransportScopeSignals(overview(), "NL");
    expect(signals.some((signal) => signal.title.includes("accelerating"))).toBe(true);
    expect(signals.some((signal) => signal.summary.includes("United States"))).toBe(false);
    expect(signals.some((signal) => `${signal.title} ${signal.summary}`.includes("United Kingdom"))).toBe(true);
  });
});
