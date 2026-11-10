import type { IntelligenceEvent, IntelligenceOverview } from "../lib/api";
export const event: IntelligenceEvent = {
  id: "port-development", title: "Port resumes operations after storm", summary: "Port operations resumed following the weather warning. Authorities continue to monitor the area.",
  event_type: "transport", severity: "high", status: "active", confidence: .8,
  start_time: "2026-11-10T08:00:00Z", last_activity_time: "2026-11-10T09:00:00Z",
  primary_location_id: null, primary_country_iso2: "SE", location_name: "Gothenburg", location_type: "city",
  latitude: 57.7, longitude: 11.97, metadata: { exact_geography: true }, source_diversity: 2, domain_count: 2,
  relevance_score: .8, urgency_score: .8, materiality_score: .7, evidence_count: 2, earth_observation_available: false,
};
export function overviewFixture(priority: "high" | "all" = "high", country: string | null = null): IntelligenceOverview {
  return {
    generated_at: "2026-11-10T10:00:00Z", snapshot: { status: "fresh", generated_at: "2026-11-10T10:00:00Z", age_seconds: 0 },
    window: { hours: 24, start: "2026-11-09T10:00:00Z", end: "2026-11-10T10:00:00Z", previous_start: "2026-11-08T10:00:00Z", previous_end: "2026-11-09T10:00:00Z", bucket_hours: 1 },
    filters: { country, topic: null, priority }, summary: { event_count: 1, high_priority_count: 1, previous_event_count: 1, change: 0, change_percent: 0, direction: "steady", location_count: 1 },
    topics: [], locations: [], buckets: [{ start: "2026-11-10T09:00:00Z", end: "2026-11-10T10:00:00Z", event_count: 1, previous_event_count: 1, high_priority_count: 1 }], events: [event],
    timeline: [{ event_id: event.id, title: event.title, occurred_at: event.last_activity_time, country_iso2: "SE", location_name: "Gothenburg", severity: "high", topic: "transport", topic_label: "Transport", priority_score: 80, priority_reasons: [], source_refs: [{ label: "Port authority", domain: "official", url: "https://example.test/report" }], imagery: null }],
    coverage: { sample_limit: 40, sampled_events: 1, truncated: false, comparison_available: true, notice: "Full selected period.", comparison_notice: "Adjacent equal periods.", priority_notice: "Priority describes attention." },
  };
}
