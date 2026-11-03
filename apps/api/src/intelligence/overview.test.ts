import assert from "node:assert/strict";
import test from "node:test";
import type { OverviewSample } from "./overview-model";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("overview event and timeline keep archive status, exact dates and safe source links", async () => {
  const { assembleIntelligenceOverview, normalizeOverviewOptions } = await import("./overview");
  const now = new Date("2026-11-03T12:00:00Z");
  const sample: OverviewSample = {
    id: "event", event_type: "security_incident", status: "resolved", severity: "high", relevance_score: .8,
    urgency_score: .7, materiality_score: .5, source_diversity: 2, domain_count: 2,
    last_activity_time: "2026-11-03T11:00:00Z", primary_location_id: null, primary_country_iso2: "SE",
    location_name: null, country_name: "Sweden", metadata: { origin_domain: "news" }, period: "current", displayable: true,
  };
  const row: Parameters<typeof assembleIntelligenceOverview>[1][number] = {
    ...sample, title: "Resolved investigation", summary: "Original attributed context", confidence: .7,
    start_time: "2026-11-02T13:00:00Z", expires_at: "2026-11-03T11:30:00Z", location_type: null,
    latitude: null, longitude: null, monitoring_tier: null, evidence_count: 2,
    signal_domains: ["news", "weather"], earth_observation_available: true, origin_domain: "news",
    source_refs: [{ label: "Publisher", url: "https://example.org/story", domain: "news" },
      { label: "Invalid", url: "javascript:alert(1)", domain: "news" }],
    imagery: { preview_url: "/api/earth-observation/assets/retained", captured_at: "2026-11-01T12:00:00Z", attribution: "Satellite provider" },
  };
  const result = assembleIntelligenceOverview([sample], [row], normalizeOverviewOptions(), now);
  assert.equal(result.events[0].status, "resolved");
  assert.equal(result.events[0].freshness_state, "expired");
  assert.equal(result.timeline[0].occurred_at, "2026-11-03T11:00:00.000Z");
  assert.equal(result.timeline[0].imagery?.captured_at, "2026-11-01T12:00:00.000Z");
  assert.deepEqual(result.timeline[0].source_refs, [{ label: "Publisher", url: "https://example.org/story", domain: "news" }]);
  assert.equal("source_refs" in result.events[0], false);
  assert.equal(result.timeline[0].priority_score, Math.round(result.events[0].priority_score * 100));
  assert.deepEqual(assembleIntelligenceOverview([sample], [], normalizeOverviewOptions(), now).events, []);
});
