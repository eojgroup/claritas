import { normalizeIntelligenceDisplayLanguage } from "./display-language";
export const OVERVIEW_TOPICS = [
  { key: "security", label: "Security & geopolitics", pattern: "(security|conflict|military|protest|politic|diploma)" },
  { key: "disasters", label: "Disasters & hazards", pattern: "(earthquake|seismic|wildfire|flood|fire|volcan|disaster)" },
  { key: "weather", label: "Weather & climate", pattern: "(weather|storm|cyclone|hurricane|typhoon|climate)" },
  { key: "transport", label: "Transport & logistics", pattern: "(transport|aviation|maritime|shipping|logistic)" },
  { key: "markets", label: "Markets & economy", pattern: "(market|econom|energy|trade|financ)" },
  { key: "agriculture", label: "Agriculture & resources", pattern: "(agricultur|crop|drought|food|resource)" },
  { key: "developments", label: "Other developments", pattern: "" },
] as const;
export type OverviewTopic = typeof OVERVIEW_TOPICS[number]["key"];
export type OverviewOptions = { hours?: 24 | 72 | 168; country?: string; topic?: OverviewTopic; priority?: "high" | "all"; displayLanguage?: string };
export type OverviewDirection = "rising" | "falling" | "steady" | "new" | "quiet" | "unavailable";
export type OverviewSample = {
  id: string; event_type: string; status: string; severity: string;
  relevance_score: number; urgency_score: number; materiality_score: number;
  source_diversity: number; domain_count: number;
  last_activity_time: string | Date; primary_location_id: string | null; primary_country_iso2: string | null;
  location_name: string | null; country_name: string | null;
  metadata: { origin_domain?: string | null; canonical_evidence_key?: string | null };
  period: "current" | "previous"; displayable?: boolean;
};
export const OVERVIEW_EVENT_LIMIT = 40;
export const OVERVIEW_TIMELINE_LIMIT = 24;

export function normalizeOverviewOptions(input: { hours?: unknown; country?: unknown; topic?: unknown; priority?: unknown; displayLanguage?: unknown } = {}): Required<OverviewOptions> {
  const hours = Number(input.hours ?? 24);
  if (![24, 72, 168].includes(hours)) throw new Error("Overview hours must be 24, 72 or 168.");
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("Overview country must be an ISO2 code.");
  const topic = typeof input.topic === "string" ? input.topic.trim().toLowerCase() : "";
  if (topic && !OVERVIEW_TOPICS.some((candidate) => candidate.key === topic)) throw new Error("Unknown overview topic.");
  const priority = input.priority ?? "high";
  if (priority !== "high" && priority !== "all") throw new Error("Overview priority must be high or all.");
  return { hours: hours as 24 | 72 | 168, country, topic: topic as OverviewTopic, priority, displayLanguage: normalizeIntelligenceDisplayLanguage(input.displayLanguage ?? "en") };
}

export function overviewTopic(eventType: string) {
  const normalized = eventType.toLowerCase();
  return OVERVIEW_TOPICS.find((topic) => topic.pattern && new RegExp(topic.pattern).test(normalized)) ?? OVERVIEW_TOPICS[6];
}

export function overviewWindow(hours: 24 | 72 | 168, now: Date) {
  const end = now.getTime();
  const duration = hours * 3_600_000;
  return { hours, start: new Date(end - duration).toISOString(), end: now.toISOString(),
    previous_start: new Date(end - duration * 2).toISOString(), previous_end: new Date(end - duration).toISOString(),
    bucket_hours: hours === 24 ? 2 : hours === 72 ? 6 : 12 };
}

/** A transparent navigation aid, not a probability or independent assessment. */
export function overviewPriority(event: OverviewSample, now: Date) {
  const clamp = (value: number) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;
  const age = Math.max(0, now.getTime() - new Date(event.last_activity_time).getTime());
  const recency = Number.isFinite(age) ? Math.max(0, 1 - age / (72 * 3_600_000)) : 0;
  const score = .55 * clamp(event.relevance_score) + .2 * clamp(event.urgency_score)
    + .15 * clamp(event.materiality_score) + .1 * recency;
  const cap = ["social", "podcast"].includes(event.metadata?.origin_domain ?? "") && !Number(event.source_diversity) ? .6 : 1;
  return Math.round(Math.min(cap, score) * 100);
}

export const overviewHighPriority = (event: OverviewSample, now: Date) =>
  ["high", "critical"].includes(event.severity) || overviewPriority(event, now) >= 70;

export function overviewPriorityReasons(event: OverviewSample) {
  const reasons: string[] = [];
  if (["high", "critical"].includes(event.severity)) reasons.push(`${event.severity === "critical" ? "Critical" : "High"} reported severity`);
  if (Number(event.relevance_score) >= .65) reasons.push("High recorded relevance");
  if (Number(event.urgency_score) >= .65) reasons.push("Time-sensitive development");
  if (Number(event.source_diversity) > 1) reasons.push(`${event.source_diversity} source identities`);
  if (Number(event.domain_count) > 1) reasons.push(`${event.domain_count} signal types`);
  if (["social", "podcast"].includes(event.metadata?.origin_domain ?? "")) reasons.push("Interpretive lead; independent verification remains necessary");
  return reasons.length ? reasons : ["Recorded relevance, urgency, materiality and update recency"];
}

export function overviewChange(current: number, previous: number) {
  const change = current - previous;
  const direction: OverviewDirection = current === 0 && previous === 0 ? "quiet" : previous === 0 ? "new"
    : change > 0 ? "rising" : change < 0 ? "falling" : "steady";
  return { change, change_percent: previous ? Math.round(change / previous * 100) : null, direction };
}

export function buildOverviewAnalytics(rawRows: OverviewSample[], options: Required<OverviewOptions>, now: Date) {
  const window = overviewWindow(options.hours, now);
  const end = now.getTime();
  const duration = options.hours * 3_600_000;
  const seen = new Set<string>();
  // Analytics cover the entire saved projection. Only the presented cards are
  // bounded; applying that limit here erased the older chart buckets.
  const rows = rawRows
    .filter((row) => {
      const time = new Date(row.last_activity_time).getTime();
      const belongs = row.period === "current" ? time >= end - duration && time <= end : time >= end - duration * 2 && time < end - duration;
      if (!belongs || row.displayable === false || row.status === "dismissed" || seen.has(row.id)) return false;
      if (options.country && row.primary_country_iso2 !== options.country) return false;
      if (options.topic && overviewTopic(row.event_type).key !== options.topic) return false;
      if (options.priority === "high" && !overviewHighPriority(row, now)) return false;
      seen.add(row.id);
      return true;
    });
  const current = rows.filter((row) => row.period === "current");
  const previous = rows.filter((row) => row.period === "previous");
  const highPriority = (row: OverviewSample) => overviewHighPriority(row, now);
  const pulse = (key: string, label: string, members: OverviewSample[]) => {
    const currentMembers = members.filter((row) => row.period === "current");
    const previousMembers = members.filter((row) => row.period === "previous");
    return { key, label, event_count: currentMembers.length, previous_event_count: previousMembers.length,
      ...overviewChange(currentMembers.length, previousMembers.length),
      priority_score: currentMembers.length ? Math.max(...currentMembers.map((row) => overviewPriority(row, now))) : 0,
      event_ids: [...currentMembers].sort((a, b) => overviewPriority(b, now) - overviewPriority(a, now)).slice(0, 3).map((row) => row.id) };
  };
  const topics = OVERVIEW_TOPICS.map((topic) => pulse(topic.key, topic.label, rows.filter((row) => overviewTopic(row.event_type).key === topic.key)))
    .filter((topic) => topic.event_count || topic.previous_event_count)
    .sort((a, b) => b.event_count - a.event_count || b.priority_score - a.priority_score || a.key.localeCompare(b.key));
  const locationsByKey = new Map<string, OverviewSample[]>();
  for (const row of rows) {
    const key = row.primary_location_id ? `location:${row.primary_location_id}` : row.primary_country_iso2 ? `country:${row.primary_country_iso2}` : null;
    if (key) locationsByKey.set(key, [...(locationsByKey.get(key) ?? []), row]);
  }
  const locations = [...locationsByKey].map(([key, members]) => {
    const first = members[0];
    const { label, ...rest } = pulse(key, first.location_name || first.country_name || first.primary_country_iso2 || "Named location", members);
    return { ...rest, name: label, country_iso2: first.primary_country_iso2 };
  }).sort((a, b) => b.event_count - a.event_count || b.priority_score - a.priority_score || a.key.localeCompare(b.key)).slice(0, 8);
  const countries = [...new Set(current.map((row) => row.primary_country_iso2).filter((value): value is string => Boolean(value)))].map((country_iso2) => {
    const members = current.filter((row) => row.primary_country_iso2 === country_iso2);
    return { country_iso2, event_count: members.length, high_priority_count: members.filter(highPriority).length };
  }).sort((a, b) => b.event_count - a.event_count || a.country_iso2.localeCompare(b.country_iso2));
  const bucketDuration = window.bucket_hours * 3_600_000;
  const buckets = Array.from({ length: options.hours / window.bucket_hours }, (_, index) => {
    const start = end - duration + index * bucketDuration;
    const finish = start + bucketDuration;
    const contains = (row: OverviewSample, shift = 0) => {
      const value = new Date(row.last_activity_time).getTime() + shift;
      return value >= start && (value < finish || index === options.hours / window.bucket_hours - 1 && value === finish);
    };
    return { start: new Date(start).toISOString(), end: new Date(finish).toISOString(),
      event_count: current.filter((row) => contains(row)).length,
      previous_event_count: previous.filter((row) => contains(row, duration)).length,
      high_priority_count: current.filter((row) => contains(row) && highPriority(row)).length };
  });
  return { generated_at: now.toISOString(), window, filters: { country: options.country || null, topic: options.topic || null, priority: options.priority },
    summary: { event_count: current.length, previous_event_count: previous.length, ...overviewChange(current.length, previous.length),
      high_priority_count: current.filter(highPriority).length,
      location_count: new Set(current.map((row) => row.primary_location_id || row.primary_country_iso2).filter(Boolean)).size },
    topics, locations, countries, buckets,
    // Keep the legacy numeric field decodable by already-installed clients.
    // This is the observed complete-window size, not a sampling cap.
    coverage: { sample_limit: Math.max(current.length, previous.length), full_window: true, sampled_events: rows.length, truncated: false, comparison_available: true,
      notice: "Counts cover all eligible saved investigations in the selected window. The latest-development cards are limited to 40; chart counts are not limited by the cards. Investigations are not a count of real-world incidents or articles.",
      comparison_notice: "Comparison uses each investigation's latest recorded update, not historical activity totals. Later updates can move an investigation between windows. Source coverage and ingestion delays can change the result; this is a reporting pulse, not proof of escalation.",
      priority_notice: "Overview priority is a navigation score: 55% recorded relevance, 20% urgency, 15% materiality and 10% recency over 72 hours. Uncorroborated social/podcast leads are capped at 60. High-priority updates have high/critical severity or a score of at least 70. It is not a probability, verified impact or independent assessment." },
    current: [...current].sort((a, b) => new Date(b.last_activity_time).getTime() - new Date(a.last_activity_time).getTime() || a.id.localeCompare(b.id)) };
}
