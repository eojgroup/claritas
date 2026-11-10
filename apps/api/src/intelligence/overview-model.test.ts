import assert from "node:assert/strict";
import test from "node:test";
import { buildOverviewAnalytics, normalizeOverviewOptions, overviewPriority, overviewPriorityReasons,
  overviewTopic, overviewChange, type OverviewSample } from "./overview-model";
const now = new Date("2026-11-03T12:00:00Z");
const event = (id: string, hoursAgo: number, overrides: Partial<OverviewSample> = {}): OverviewSample => ({
  id, event_type: "security_incident", status: "active", severity: "medium", relevance_score: .7,
  urgency_score: .4, materiality_score: .3, source_diversity: 2, domain_count: 2,
  last_activity_time: new Date(now.getTime() - hoursAgo * 3_600_000), primary_location_id: "named-port",
  primary_country_iso2: "SE", location_name: "Named port", country_name: "Sweden",
  metadata: { origin_domain: "news" }, period: hoursAgo <= 24 ? "current" : "previous", displayable: true, ...overrides,
});

test("overview filters reject unbounded windows and unknown topic input", () => {
  assert.deepEqual(normalizeOverviewOptions({ hours: "72", country: " se ", topic: "TRANSPORT" }), { hours: 72, country: "SE", topic: "transport", priority: "high", displayLanguage: "en" });
  assert.deepEqual(normalizeOverviewOptions(), { hours: 24, country: "", topic: "", priority: "high", displayLanguage: "en" });
  for (const hours of [0, 1, 1000, Infinity, "forever"]) assert.throws(() => normalizeOverviewOptions({ hours }), /hours/);
  assert.equal(normalizeOverviewOptions({ displayLanguage: "fr_FR" }).displayLanguage, "fr-fr");
  assert.notEqual(JSON.stringify(normalizeOverviewOptions({ displayLanguage: "fr" })), JSON.stringify(normalizeOverviewOptions()));
  for (const displayLanguage of ["", "not a code", ["en"], ["en", "fr"], 12]) assert.throws(() => normalizeOverviewOptions({ displayLanguage }), /display_language/);
  assert.throws(() => normalizeOverviewOptions({ country: "Sweden" }), /ISO2/);
  assert.throws(() => normalizeOverviewOptions({ topic: "anything' OR true" }), /topic/);
});

test("overview priority is bounded, explained and capped for uncorroborated interpretive leads", () => {
  const strong = event("strong", 0, { relevance_score: 1, urgency_score: 1, materiality_score: 1, severity: "critical" });
  assert.equal(overviewPriority(strong, now), 100);
  assert.equal(overviewPriority({ ...strong, source_diversity: 0, metadata: { origin_domain: "social" } }, now), 60);
  assert.equal(overviewPriority({ ...strong, last_activity_time: new Date(now.getTime() - 72 * 3_600_000) }, now), 90);
  assert.equal(overviewPriority({ ...strong, relevance_score: 50, urgency_score: -1, materiality_score: NaN }, now), 65);
  assert.ok(overviewPriorityReasons(strong).some((reason) => /Critical/.test(reason)));
  assert.equal(overviewTopic("aviation_disruption").key, "transport");
  assert.equal(overviewTopic("wildfire").key, "disasters");
  assert.equal(overviewTopic("unexpected_source_type").key, "developments");
});

test("pulse compares investigation updates in equal disjoint windows with truthful zero-baseline behavior", () => {
  const rows = [event("current", 1), event("current2", 23), event("previous", 25), event("boundary", 24),
    event("hidden", 2, { displayable: false }), event("dismissed", 1, { status: "dismissed" }), event("too-old", 49),
    event("future", -1), event("duplicate", 3), event("duplicate", 4)];
  const overview = buildOverviewAnalytics(rows, normalizeOverviewOptions({ priority: "all" }), now);
  assert.equal(overview.summary.event_count, 4);
  assert.equal(overview.summary.previous_event_count, 1);
  assert.equal(overview.summary.change, 3);
  assert.equal(overview.summary.change_percent, 300);
  assert.equal(overview.summary.direction, "rising");
  assert.equal(overview.buckets.reduce((sum, bucket) => sum + bucket.event_count, 0), 4);
  assert.equal(overview.buckets.reduce((sum, bucket) => sum + bucket.previous_event_count, 0), 1);
  assert.equal(overview.buckets[0].event_count, 2);
  assert.equal(overview.buckets[11].event_count, 1);
  assert.equal(overview.topics[0].key, "security");
  assert.equal(overview.locations[0].name, "Named port");
  assert.equal(overview.summary.location_count, 1);
  assert.deepEqual(overviewChange(2, 0), { change: 2, change_percent: null, direction: "new" });
  assert.equal(overviewChange(0, 0).direction, "quiet");
  assert.equal(overviewChange(1, 2).direction, "falling");
});

test("full windows keep older buckets after more than 300 recent updates", () => {
  const rows = [...Array.from({ length: 301 }, (_, index) => event(`${index}`, 1)),
    event("old-current", 23), event("previous-old", 47), event("previous-recent", 25)];
  const overview = buildOverviewAnalytics(rows, normalizeOverviewOptions({ priority: "all" }), now);
  assert.equal(overview.summary.event_count, 302);
  assert.equal(overview.summary.previous_event_count, 2);
  assert.equal(overview.coverage.truncated, false);
  assert.equal(overview.coverage.comparison_available, true);
  assert.equal(overview.summary.direction, "rising");
  assert.equal(overview.buckets[0].event_count, 1);
  assert.equal(overview.buckets[0].previous_event_count, 1);
  assert.equal(overview.buckets.at(-1)?.event_count, 301);
  assert.match(overview.coverage.notice, /chart counts are not limited/);
  assert.match(overview.coverage.comparison_notice, /latest recorded update/);
  assert.equal(buildOverviewAnalytics(rows, normalizeOverviewOptions({ country: "NO" }), now).summary.event_count, 0);
  assert.equal(buildOverviewAnalytics(rows, normalizeOverviewOptions({ topic: "transport" }), now).summary.event_count, 0);
  const empty = buildOverviewAnalytics([], normalizeOverviewOptions({ priority: "all" }), now);
  assert.equal(empty.buckets.length, 12);
  assert.equal(empty.summary.direction, "quiet");
});

test("bucket sizes adapt to longer windows without inventing historical snapshots", () => {
  for (const hours of [24, 72, 168] as const) {
    const overview = buildOverviewAnalytics([], normalizeOverviewOptions({ hours }), now);
    assert.equal(overview.buckets.length, hours === 168 ? 14 : 12);
    assert.equal(overview.buckets[0].start, overview.window.start);
    assert.equal(overview.buckets.at(-1)?.end, overview.window.end);
  }
});

test("high priority is the default and filters the same map, cards and chart cohort", () => {
  const rows = [event("routine", 1, { relevance_score: .1 }), event("high-severity", 23, { relevance_score: .1, severity: "high" }),
    event("high-score", 2, { relevance_score: .95, urgency_score: .9 }), event("previous-priority", 25, { severity: "critical" })];
  const high = buildOverviewAnalytics(rows, normalizeOverviewOptions(), now);
  assert.equal(high.filters.priority, "high");
  assert.equal(high.summary.event_count, 2);
  assert.equal(high.summary.previous_event_count, 1);
  assert.equal(high.current.length, 2);
  assert.equal(high.buckets.reduce((total, bucket) => total + bucket.event_count, 0), 2);
  assert.equal(buildOverviewAnalytics(rows, normalizeOverviewOptions({ priority: "all" }), now).summary.event_count, 3);
  assert.throws(() => normalizeOverviewOptions({ priority: "urgent" }), /priority/);
});
