// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorldEventStream from "./WorldEventStream";
import type { IntelligenceEvent } from "../lib/api";

const events = Array.from({ length: 8 }, (_, index) => ({
  id: `event-${index}`, title: `Development ${index}`, event_type: "weather",
  severity: "high", primary_country_iso2: index === 7 ? "TN" : "SE",
  last_activity_time: "2026-11-01T10:00:00Z", evidence_count: 3, domain_count: 2,
  signal_domains: ["news", "weather"], relevance_score: .8, urgency_score: .7,
}) as IntelligenceEvent);
const props = { events, loading: false, includeExpired: false, onSelect: vi.fn(), onArchiveChange: vi.fn(), onRefresh: vi.fn() };
afterEach(cleanup);

it("keeps selected event identity, place and evidence together and exposes more events on small screens", () => {
  render(<WorldEventStream {...props} selectedId="event-1" />);
  expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Development 1");
  fireEvent.click(screen.getByRole("button", { name: /Development 2/ }));
  expect(props.onSelect).toHaveBeenCalledWith("event-2");
  expect(screen.queryByText("Development 7")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Show 2 more events/ }));
  expect(screen.getByText("Development 7")).toBeTruthy();
});

it("scopes events by country and exposes archive and retry actions", () => {
  render(<WorldEventStream {...props} country="tn" error="Connection lost" />);
  expect(screen.getByText("Development 7")).toBeTruthy();
  expect(screen.queryByText("Development 0")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Time" }), { target: { value: "archive" } });
  expect(props.onArchiveChange).toHaveBeenCalledWith(true);
  expect(screen.getByRole("alert").textContent).toContain("Showing the last loaded events");
  fireEvent.click(screen.getByRole("button", { name: "Refresh events" }));
  expect(props.onRefresh).toHaveBeenCalled();
});
