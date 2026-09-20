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
      primary_category: "transport",
      categories: ["transport", "energy"],
      tags: [
        { code: "category:transport", label: "Transport", kind: "category" },
        { code: "category:energy", label: "Energy", kind: "category" },
        { code: "event:port", label: "Port disruption", kind: "event" },
        { code: "evidence:ae", label: "United Arab Emirates", kind: "evidence" },
        { code: "topic:tanker", label: "Tankers", kind: "topic" },
      ],
      importance: {
        score: 81,
        tier: "high",
        confidence: 0.91,
        reasons: [{ code: "transport_materiality", label: "Material transport interruption" }],
        methodology: "news_importance_v1",
        calculated_at: "2026-08-11T08:05:00Z",
      },
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
    render(<PriorityNewsList items={[item]} selectedId={item.id} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example"} getCountries={() => ["AE"]} getCountryName={() => "United Arab Emirates"} onToggle={() => undefined} onSelectCountry={() => undefined} onOpenEvent={onOpenEvent} />);
    expect(screen.getAllByText(/imagery available/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Additional context")).toBeTruthy();
    expect(screen.getByText(/Why shown: the same named location/i)).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText(/Why it ranks: Material transport interruption/i)).toBeTruthy();
    expect(screen.getByText("Port disruption")).toBeTruthy();
    expect(screen.getByText("Tankers")).toBeTruthy();
    expect(screen.getByText("United Arab Emirates")).toBeTruthy();
    expect(screen.queryByText("Transport")).toBeNull();
    expect(screen.queryByText("Energy")).toBeNull();
    expect(screen.queryByText("P1")).toBeNull();
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
      getCountries: () => ["ES"],
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

    render(<PriorityNewsList items={[item]} selectedId={null} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example · via GDELT"} getCountries={() => ["GB"]} getCountryName={() => "United Kingdom"} onToggle={() => undefined} onSelectCountry={() => undefined} />);
    expect(screen.getByText(/First seen · Aug 14, 2026/i)).toBeTruthy();
  });

  it("renders and labels the canonical publisher timeline instant", () => {
    const item: NewsItem = {
      id: 47,
      kind: "news",
      title: "A publisher-timed report",
      summary: null,
      url: "https://example.com/published-report",
      country_iso2: "US",
      event_time: "2026-09-07T10:30:00Z",
      time: {
        basis: "publisher_published_verified",
        is_publisher_verified: true,
        timeline_at: "2026-09-07T08:30:00Z",
        published_at: "2026-09-07T08:30:00Z",
        discovered_at: "2026-09-07T10:30:00Z",
      },
    };

    render(<PriorityNewsList items={[item]} selectedId={null} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example"} getCountries={() => ["US"]} getCountryName={() => "United States"} onToggle={() => undefined} onSelectCountry={() => undefined} />);
    expect(screen.getByText(/Published · Sep 7, 2026/i)).toBeTruthy();
    expect(document.querySelector('time[datetime="2026-09-07T08:30:00Z"]')).toBeTruthy();
    const mobileTime = document.querySelector(".dashboard-news-mobile-timestamp");
    expect(mobileTime?.getAttribute("datetime")).toBe("2026-09-07T08:30:00Z");
    expect(mobileTime?.textContent).toMatch(/Published Sep 7, 2026/);
  });

  it("discloses when ranking evidence is still limited", () => {
    const item: NewsItem = {
      id: 45,
      kind: "news",
      title: "New report awaiting assessment",
      summary: null,
      url: "https://example.com/pending",
      country_iso2: null,
      event_time: "2026-08-14T09:15:00Z",
      importance: {
        score: 0,
        tier: "routine",
        confidence: 0,
        reasons: [{ code: "assessment_pending", label: "Automated assessment pending" }],
        methodology: "news_importance_v1",
        calculated_at: null,
        is_fallback: true,
        components: { assessment_pending: true },
      },
    };

    render(<PriorityNewsList items={[item]} selectedId={null} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Example"} getCountries={() => []} getCountryName={() => "Global"} onToggle={() => undefined} onSelectCountry={() => undefined} />);

    expect(screen.getAllByText(/Unranked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/assessment pending/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ranking status: Assessment pending/i)).toBeTruthy();
    expect(screen.queryByText(/Why it ranks: Assessment pending/i)).toBeNull();
    expect(screen.queryByText(/Routine importance/i)).toBeNull();
    expect(screen.queryByText(/recency-only/i)).toBeNull();
  });

  it("keeps a selected secondary subject country attached to the story", () => {
    const onToggle = vi.fn();
    const item: NewsItem = {
      id: 46,
      kind: "news",
      title: "Cross-border market action",
      summary: null,
      url: "https://example.com/cross-border",
      country_iso2: "US",
      countries: ["US", "GB"],
      event_time: "2026-08-14T09:15:00Z",
    };

    render(
      <PriorityNewsList
        items={[item]}
        selectedId={null}
        primaryCountry="GB"
        emptyState={null}
        getImageUrl={() => undefined}
        getSourceLabel={() => "Example"}
        getCountries={() => ["US", "GB"]}
        getCountryName={(iso) => iso}
        onToggle={onToggle}
        onSelectCountry={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Cross-border market action/i }));
    expect(onToggle).toHaveBeenCalledWith(item, "GB");
    expect(document.querySelector(".dashboard-news-item.is-primary")).toBeTruthy();
    expect(screen.getByText("US · GB")).toBeTruthy();
  });
});

it("hides a source-only event but shows independently retained context", () => {
  const item: NewsItem = { id: 90, kind: "news", summary: null, country_iso2: null, event_time: null, title: "Single report", url: "https://example.com/report",
    linked_events: [{ id: "event-1", title: "Single report", event_type: "news", severity: "low",
      evidence_count: 1, additional_evidence_count: 0 }] };
  const props = { selectedId: 90, emptyState: null, getImageUrl: () => undefined,
    getSourceLabel: () => "Publisher", getCountries: () => [], getCountryName: () => "",
    onToggle: () => undefined, onSelectCountry: () => undefined };
  const { rerender } = render(<PriorityNewsList {...props} items={[item]} />);
  expect(screen.queryByText("Additional context")).toBeNull();
  rerender(<PriorityNewsList {...props} items={[{ ...item, linked_events: [{ ...item.linked_events![0], additional_evidence_count: 2 }] }]} />);
  expect(screen.getByText("Additional context")).toBeTruthy();
  expect(screen.getByText("2 additional sources")).toBeTruthy();
});
