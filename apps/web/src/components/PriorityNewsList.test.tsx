// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PriorityNewsList from "./PriorityNewsList";
import type { NewsItem } from "../lib/api";

afterEach(cleanup);

describe("PriorityNewsList", () => {
  it("opens the exact linked investigation and exposes imagery state", () => {
    const onOpenEvent = vi.fn();
    const item: NewsItem = {
      id: 42,
      kind: "news",
      title: "Port fire disrupts tanker traffic",
      summary: "Emergency services reported a fire.",
      url: "https://example.com/report",
      country_iso2: "AE",
      event_time: "2026-08-11T08:00:00Z",
      linked_events: [{
        id: "a1139da5-2bcf-486a-817b-10b52fb21a2f",
        event_type: "wildfire",
        title: "Fire near energy infrastructure",
        severity: "high",
        correlation_score: 0.87,
        earth_observation_state: "imagery_available",
      }],
    };
    render(<PriorityNewsList items={[item]} selectedId={item.id} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example"} getCountryName={() => "United Arab Emirates"} onToggle={() => undefined} onSelectCountry={() => undefined} onOpenEvent={onOpenEvent} />);
    expect(screen.getAllByText(/imagery available/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Fire near energy infrastructure/i }));
    expect(onOpenEvent).toHaveBeenCalledWith(item.linked_events?.[0].id);
  });
});
