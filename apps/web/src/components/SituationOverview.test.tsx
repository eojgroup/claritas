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
const props = { overview, loading: false, error: null, hours: 24 as const, topic: null, onHoursChange: vi.fn(), onTopicChange: vi.fn(), onCountryChange: vi.fn(), onSelect: vi.fn(), onOpenImagery: vi.fn(), onRefresh: vi.fn() };

it("explains changes as investigation updates and opens exact evidence and imagery", () => {
  render(<SituationOverview {...props} />);
  expect(screen.getByText(/8 investigations updated/)).toBeTruthy();
  expect(screen.getByText(/2 more than the previous 24 hours/)).toBeTruthy();
  expect(screen.getByText(/3 high-priority · 4 places/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Port development 0" }));
  expect(props.onSelect).toHaveBeenCalledWith("event-0");
  fireEvent.click(screen.getByRole("button", { name: "Inspect imagery for Port development 0" }));
  expect(props.onOpenImagery).toHaveBeenCalledWith("event-0");
  expect(screen.getAllByRole("link", { name: "Port authority" })[0].getAttribute("href")).toBe("https://example.test/report");
  expect(screen.getByText(overview.coverage.priority_notice)).toBeTruthy();
});
it("narrows the timeline to a selected interval and restores the full period", () => {
  render(<SituationOverview {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /: 4 updates; previous period 2/ }));
  expect(screen.queryByRole("button", { name: "Port development 0" })).toBeNull();
  expect(screen.getByRole("button", { name: "Port development 4" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show the full period" }));
  expect(screen.getByRole("button", { name: "Port development 0" })).toBeTruthy();
});
it("changes server scope explicitly and never labels a previous scope as current", () => {
  const view = render(<SituationOverview {...props} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Topic" }), { target: { value: "weather" } });
  expect(props.onTopicChange).toHaveBeenCalledWith("weather");
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), { target: { value: "72" } });
  expect(props.onHoursChange).toHaveBeenCalledWith(72);
  view.rerender(<SituationOverview {...props} country="TN" loading />);
  expect(screen.queryByText(/8 investigations updated/)).toBeNull();
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
  expect(screen.getByText(/At least 8 investigations updated/)).toBeTruthy();
  expect(screen.getByText(/Sample capped; period comparison is unavailable/)).toBeTruthy();
  expect(screen.queryByText(/2 more than/)).toBeNull();
  expect(container.querySelectorAll(".situation-bar-previous")).toHaveLength(0);
});
it("includes an update exactly at the final timeline boundary", () => {
  render(<SituationOverview {...props} overview={{ ...overview, timeline: [{ ...overview.timeline[0], occurred_at: overview.window.end }] }} />);
  fireEvent.click(screen.getByRole("button", { name: /: 4 updates; previous period 4/ }));
  expect(screen.getByRole("button", { name: "Port development 0" })).toBeTruthy();
});
