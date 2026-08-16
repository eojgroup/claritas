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
        correlation_factors: {
          decision: "attached",
          location: 1,
          temporal: 0.9,
          event_type: 1,
        },
        earth_observation_state: "imagery_available",
      }],
    };
    render(<PriorityNewsList items={[item]} selectedId={item.id} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example"} getCountryName={() => "United Arab Emirates"} onToggle={() => undefined} onSelectCountry={() => undefined} onOpenEvent={onOpenEvent} />);
    expect(screen.getAllByText(/imagery available/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Likely linked investigations")).toBeTruthy();
    expect(screen.getByText(/Why shown: the same named location/i)).toBeTruthy();
    expect(document.querySelector('time[datetime="2026-08-11T08:00:00Z"]')).toBeTruthy();
    const linkedEventButton = screen.getByRole("button", { name: /Open likely linked event investigation: Fire near energy infrastructure/i });
    expect((linkedEventButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(linkedEventButton);
    expect(onOpenEvent).toHaveBeenCalledWith(item.linked_events?.[0].id);
  });

  it("distinguishes on-demand translation from active work and offers a retry after failure", () => {
    const onRequestTranslation = vi.fn();
    const item: NewsItem = {
      id: 43,
      kind: "news",
      title: "Incendio cerca del puerto",
      summary: "Los bomberos respondieron.",
      url: "https://example.com/es-report",
      country_iso2: "ES",
      language_code: "es",
      event_time: "2026-08-12T08:00:00Z",
    };
    const props = {
      items: [item],
      selectedId: item.id,
      emptyState: null,
      getImageUrl: () => undefined,
      getSourceLabel: () => "Example",
      getCountryName: () => "Spain",
      onToggle: () => undefined,
      onSelectCountry: () => undefined,
      onRequestTranslation,
    };

    const { rerender } = render(<PriorityNewsList {...props} />);
    expect(screen.getByText(/ES source · English on open/i)).toBeTruthy();
    expect(screen.queryByText(/translation pending/i)).toBeNull();

    rerender(<PriorityNewsList {...props} translationPendingIds={new Set([item.id])} />);
    expect(screen.getByText(/ES→EN · translating/i)).toBeTruthy();

    rerender(<PriorityNewsList {...props} translationErrorIds={new Set([item.id])} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry translation/i }));
    expect(onRequestTranslation).toHaveBeenCalledWith(item);
  });

  it("labels provider discovery batches separately from publisher publication time", () => {
    const item: NewsItem = {
      id: 44,
      kind: "news",
      title: "A newly discovered report",
      summary: null,
      url: "https://example.com/report",
      country_iso2: "GB",
      event_time: "2026-08-14T09:15:00Z",
      payload: { time_basis: "provider_first_seen", time_precision: "15_minutes" },
    };

    render(<PriorityNewsList items={[item]} selectedId={null} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example · via GDELT"} getCountryName={() => "United Kingdom"} onToggle={() => undefined} onSelectCountry={() => undefined} />);
    expect(screen.getByText(/First seen · Aug 14, 2026/i)).toBeTruthy();
  });
});
