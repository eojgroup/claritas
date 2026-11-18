// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SituationOverview from "./SituationOverview";
import type { IntelligenceOverview } from "../lib/api";

afterEach(cleanup);
const overview: IntelligenceOverview = {
  generated_at: "2026-11-03T10:00:00Z",
  window: { hours: 24, start: "2026-11-02T10:00:00Z", end: "2026-11-03T10:00:00Z", previous_start: "2026-11-01T10:00:00Z", previous_end: "2026-11-02T10:00:00Z", bucket_hours: 12 },
  filters: { country: null, topic: null },
  summary: { event_count: 8, previous_event_count: 6, change: 2, change_percent: 33, direction: "rising", high_priority_count: 3, location_count: 4 },
  topics: [{ key: "transport", label: "Transport", event_count: 8, previous_event_count: 6, change: 2, direction: "rising", priority_score: 80, event_ids: ["event-0"] }],
  locations: [{ key: "port", name: "Port of Example", country_iso2: "SE", event_count: 4, previous_event_count: 2, change: 2, direction: "rising", priority_score: 80, event_ids: ["event-0"] }],
  buckets: [
    { start: "2026-11-02T10:00:00Z", end: "2026-11-02T22:00:00Z", event_count: 4, previous_event_count: 2, high_priority_count: 2 },
    { start: "2026-11-02T22:00:00Z", end: "2026-11-03T10:00:00Z", event_count: 4, previous_event_count: 4, high_priority_count: 1 },
  ],
  events: [],
  timeline: Array.from({ length: 8 }, (_, index) => ({
    event_id: `event-${index}`, occurred_at: index < 4 ? "2026-11-03T09:00:00Z" : "2026-11-02T12:00:00Z",
    title: `Port development ${index}`, topic: "transport", topic_label: "Transport", location_name: "Port of Example", country_iso2: "SE", severity: "high", priority_score: 80,
    priority_reasons: ["Multiple source types describe this development"], source_refs: [{ label: "Port authority", domain: "news", url: "https://example.test/report" }],
    imagery: index === 0 ? { preview_url: "/api/earth-observation/assets/image", captured_at: "2026-10-29T08:00:00Z", attribution: "Copernicus Sentinel data" } : null,
  })),
  coverage: { sample_limit: 300, sampled_events: 8, truncated: false, comparison_available: true, notice: "Counts cover sampled investigations, not all reporting.", comparison_notice: "Comparison uses latest recorded updates in adjacent periods.", priority_notice: "Attention priority is not a probability or confirmation." },
};
const props = { overview, loading: false, error: null, hours: 24 as const, topic: null, priority: "all" as const, onBucketChange: vi.fn(), onHoursChange: vi.fn(), onTopicChange: vi.fn(), onCountryChange: vi.fn(), onSelect: vi.fn(), onOpenImagery: vi.fn(), onRefresh: vi.fn() };

it("explains changes as investigation updates and opens exact evidence and imagery", () => {
  render(<SituationOverview {...props} />);
  expect(screen.getByText(/8 developments updated/)).toBeTruthy();
  expect(screen.getByText(/2 more than the previous 24 hours/)).toBeTruthy();
  expect(screen.getByText(/3 high-priority · 4 places/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Port development 0" }));
  expect(props.onSelect).toHaveBeenCalledWith("event-0");
  fireEvent.click(screen.getByRole("button", { name: "Inspect imagery for Port development 0" }));
  expect(props.onSelect).toHaveBeenCalledWith("event-0");
  fireEvent.click(screen.getAllByText("1 source")[0]);
  expect(screen.getAllByRole("link", { name: "Port authority" })[0].getAttribute("href")).toBe("https://example.test/report");
  fireEvent.click(screen.getByText("Coverage and how to read this"));
  expect(screen.getByText(overview.coverage.priority_notice)).toBeTruthy();
});
it("requests the selected interval while retaining full chart context, and clears it", () => {
  const view = render(<SituationOverview {...props} />);
  const bar = screen.getByRole("button", { name: /: 4 updates; previous period 2/ });
  fireEvent.click(bar);
  expect(props.onBucketChange).toHaveBeenLastCalledWith(0);
  view.rerender(<SituationOverview {...props} bucket={0} loading />);
  expect(screen.getByText("Loading selected interval…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Port development 0" })).toBeNull();
  const scoped = { ...overview, filters: { ...overview.filters, bucket: 0 }, selection: { bucket: 0, ...overview.buckets[0] }, timeline: [overview.timeline[4]] };
  view.rerender(<SituationOverview {...props} bucket={0} overview={scoped} />);
  expect(screen.getByRole("button", { name: "Port development 4" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Port development 0" })).toBeNull();
  expect(screen.getByRole("button", { name: /: 4 updates; previous period 2/ }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Full period ×" }));
  expect(props.onBucketChange).toHaveBeenLastCalledWith(null);
});
it("keeps every topic available through the same controls after selecting a category", () => {
  const view = render(<SituationOverview {...props} compact />);
  fireEvent.click(screen.getByRole("button", { name: "Markets & economy" }));
  expect(props.onTopicChange).toHaveBeenLastCalledWith("markets");
  view.rerender(<SituationOverview {...props} compact topic="transport" overview={{ ...overview, filters: { ...overview.filters, topic: "transport" } }} />);
  for (const label of ["Security", "Disasters", "Weather", "Transport 8", "Markets & economy", "Agriculture", "Other developments", "All topics"]) {
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "Weather" }));
  expect(props.onTopicChange).toHaveBeenLastCalledWith("weather");
});

it("keeps priority and history visible while grouping the detailed filters", () => {
  const onPriorityChange = vi.fn();
  render(<SituationOverview {...props} compact onPriorityChange={onPriorityChange} />);
  expect(screen.getByRole("region", { name: "Activity over time" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Period" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "High priority" }));
  expect(onPriorityChange).toHaveBeenCalledWith("high");
  fireEvent.click(screen.getByText("Filters"));
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "72" } });
  expect(props.onHoursChange).toHaveBeenCalledWith(72);
  fireEvent.change(screen.getByRole("combobox", { name: "Topic" }), { target: { value: "transport" } });
  expect(props.onTopicChange).toHaveBeenCalledWith("transport");
  expect(screen.getByRole("option", { name: "Transport (8)" })).toBeTruthy();
});
it("changes server scope explicitly and never labels a previous scope as current", () => {
  const view = render(<SituationOverview {...props} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Topic" }), { target: { value: "weather" } });
  expect(props.onTopicChange).toHaveBeenCalledWith("weather");
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "72" } });
  expect(props.onHoursChange).toHaveBeenCalledWith(72);
  view.rerender(<SituationOverview {...props} country="TN" loading />);
  expect(screen.queryByText(/8 developments updated/)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Loading the situation overview");
});
it("keeps loaded context through a refresh failure and provides retry", () => {
  render(<SituationOverview {...props} error="Unavailable" />);
  expect(screen.getByRole("alert").textContent).toContain("Showing the last loaded overview");
  expect(screen.getByRole("button", { name: "Port development 0" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry overview" }));
  expect(props.onRefresh).toHaveBeenCalled();
});
it("shows capped counts as lower bounds and removes unsupported period comparisons", () => {
  const { container } = render(<SituationOverview {...props} overview={{ ...overview, coverage: { ...overview.coverage, truncated: true, comparison_available: false } }} />);
  expect(screen.getByText(/At least 8 developments updated/)).toBeTruthy();
  expect(screen.getByText(/Period comparison unavailable/)).toBeTruthy();
  expect(screen.queryByText(/2 more than/)).toBeNull();
  expect(container.querySelectorAll(".situation-bar-previous")).toHaveLength(0);
});
it("includes an update exactly at the final timeline boundary", () => {
  render(<SituationOverview {...props} overview={{ ...overview, timeline: [{ ...overview.timeline[0], occurred_at: overview.window.end }] }} />);

  expect(screen.getByRole("button", { name: "Port development 0" })).toBeTruthy();
});
it("uses cached timeline and source headlines while preserving untranslated rows and explicit quota state", () => {
  const translated = { original_title: "דיווח חדש", language_code: "he", display_language: "en", translated_title: "New translated development", translation_status: "translated" as const };
  const pending = { translation_status: "pending" as const, translation_availability: { status: "quota_limited" as const, reason: "Free allowance exhausted" } };
  render(<SituationOverview {...props} overview={{ ...overview, timeline: [
    { ...overview.timeline[0], ...translated, source_refs: [{ ...overview.timeline[0].source_refs[0], ...translated, translated_title: "Translated source headline" }] },
    { ...overview.timeline[1], ...pending, title: "Informe original en español" },
  ] }} />);
  expect(screen.getByRole("button", { name: "New translated development" })).toBeTruthy();
  fireEvent.click(screen.getAllByText("1 source")[0]);
  expect(screen.getByRole("link", { name: "Translated source headline" })).toBeTruthy();
  expect(screen.getAllByText("Original headline")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Informe original en español" })).toBeTruthy();
  expect(screen.getByText("Translation allowance reached")).toBeTruthy();
});

it("shows warming as preparation, without zero activity or repeated absence rows", () => {
  const warming = { ...overview, snapshot: { status: "warming" as const, generated_at: null, age_seconds: null }, timeline: [], events: [], buckets: [], summary: { ...overview.summary, event_count: 0, high_priority_count: 0, location_count: 0 } };
  const view = render(<SituationOverview {...props} overview={warming} />);
  expect(screen.getByRole("status").textContent).toContain("Preparing the first overview");
  expect(screen.queryByText(/0 developments updated/)).toBeNull();
  expect(screen.queryByText(/Activity over time · 0/)).toBeNull();
  view.rerender(<SituationOverview {...props} priority="high" overview={{ ...overview, timeline: [{ ...overview.timeline[0], country_iso2: null, location_name: null }] }} />);
  expect(screen.queryByText(/high-priority ·/)).toBeNull();
  expect(screen.queryByText("Location unresolved")).toBeNull();
});
