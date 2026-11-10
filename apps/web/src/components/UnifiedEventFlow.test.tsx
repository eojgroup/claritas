// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IntelligenceWorkspace from "./IntelligenceWorkspace";
import PriorityNewsList from "./PriorityNewsList";
import { fetchIntelligenceEvent, fetchIntelligenceEvents, resolveSourceInvestigation, type IntelligenceEventDetail, type NewsItem } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/api")>(),
  fetchIntelligenceEvents: vi.fn(), fetchIntelligenceEvent: vi.fn(),
  fetchIntelligenceWatchlist: vi.fn().mockResolvedValue([]), fetchIntelligenceAlerts: vi.fn().mockResolvedValue([]),
  fetchEventGibsContext: vi.fn().mockResolvedValue({ layers: [], notice: "" }),
  resolveSourceInvestigation: vi.fn(),
}));

const story: NewsItem = {
  id: 82, kind: "news", title: "DHL Supply Chain announces an acquisition in Colombia",
  summary: "DHL announced an acquisition of Open Market in Colombia.", url: "https://example.test/colombia-report",
  country_iso2: "CO", event_time: "2026-09-23T03:17:00Z",
};
const detail: IntelligenceEventDetail = {
  event: {
    id: "colombia-acquisition", event_type: "corporate_development", title: story.title!, summary: story.summary!,
    origin_domain: "news", signal_domains: ["news", "podcast"], priority_reasons: ["A named company development with related reporting."],
    status: "emerging", severity: "medium", confidence: .6, start_time: story.event_time!, last_activity_time: story.event_time!,
    primary_location_id: null, primary_country_iso2: "CO", location_name: "Colombia", source_diversity: 2,
    domain_count: 2, relevance_score: .5, urgency_score: .4, materiality_score: .6, evidence_count: 2, earth_observation_available: false,
  },
  evidence: [
    { id: "news-source", domain: "news", evidence_type: "article", source_record_type: "item", source_record_id: "82", observed_at: story.event_time!, relationship: "reported", confidence: .6, title: story.title, summary: story.summary, source_url: story.url, source_name: "Publisher", correlation_factors: { decision: "created" } },
    { id: "podcast-source", domain: "podcast", evidence_type: "podcast_context", source_record_type: "podcast_episode", source_record_id: "100", observed_at: "2026-09-23T05:00:00Z", relationship: "context", confidence: .65, title: "DHL’s Colombian logistics expansion", source_name: "Logistics briefing", correlation_factors: { decision: "attached", entity: .8, event_type: 1, temporal: .9, matched_entities: ["company:dhl"] } },
  ],
  signal_coverage: [{ domain: "news", label: "News", count: 1, state: "linked" }, { domain: "transport", label: "Transport", count: 0, state: "none" }],
  context_signals: [{ id: "transport-co", domain: "transport", title: "Transport coverage in Colombia", summary: "Retained traffic records in the event’s country and time window.", scope_label: "Colombia · country", relationship: "regional_context", observed_at: "2026-09-23T04:00:00Z", metrics: [{ label: "Aircraft observed", value: 24, unit: "aircraft" }, { label: "Vessels observed", value: 6, unit: "vessels" }], coverage_notice: "Feed coverage is partial. These counts do not prove disruption or a change in traffic.", native_route: "/?view=transport&country=CO" }],
  regional_reporting: { window_start: "2026-09-22T03:17:00Z", window_end: "2026-09-24T03:17:00Z", notice: "Same country and nearby time; not a confirmed event connection.", items: [{ id: "other-news", title: "Colombia announces a regional investment programme", url: "https://example.test/other-report", publisher: "Other publisher", observed_at: "2026-09-23T04:00:00Z", published_at: null, scope_label: "Same country · CO" }] },
  earth_observations: [], locations: [], related_events: [], epistemic_notice: "Correlation does not establish causation.",
};
function Flow() {
  const [eventId, setEventId] = useState<string | null>(null);
  return eventId ? <IntelligenceWorkspace initialEventId={eventId} /> : <PriorityNewsList items={[story]} selectedId={story.id} emptyState={null} getImageUrl={() => undefined} getSourceLabel={() => "Publisher"} getCountries={() => ["CO"]} getCountryName={() => "Colombia"} onToggle={() => undefined} onSelectCountry={() => undefined} onOpenEvent={setEventId} />;
}
beforeEach(() => {
  vi.mocked(fetchIntelligenceEvents).mockResolvedValue([detail.event]);
  vi.mocked(fetchIntelligenceEvent).mockResolvedValue(detail);
  vi.mocked(resolveSourceInvestigation).mockReset();
});
afterEach(cleanup);

it("follows a Colombian news report into an event with related sources and separate regional transport data", async () => {
  vi.mocked(resolveSourceInvestigation).mockResolvedValue({ status: "available", event_id: detail.event.id });
  render(<Flow />);
  expect(screen.queryByText(/Why it ranks/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Investigate this source" }));
  expect(await screen.findByRole("heading", { name: story.title!, level: 2 })).toBeTruthy();
  expect(resolveSourceInvestigation).toHaveBeenCalledWith({ domain: "news", source_record_type: "item", source_record_id: "82" });
  expect(screen.getByRole("heading", { name: "Related signals" })).toBeTruthy();
  expect(screen.getAllByText("Started from News").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Read Podcasts connections" }));
  expect(screen.getByRole("heading", { name: "DHL’s Colombian logistics expansion" })).toBeTruthy();
  fireEvent.click(screen.getByText("Connection & provenance"));
  expect(screen.getByText("Shared mentions: dhl")).toBeTruthy();
  expect(screen.getByText("Shared entity")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: story.title!, level: 5 })).toBeNull();
  expect(screen.queryByRole("button", { name: "Read Transport connections" })).toBeNull();
  fireEvent.click(screen.getByText("Explore surrounding context"));
  const context = await screen.findByRole("region", { name: "Around this event" });
  expect(within(context).getByText("Aircraft observed")).toBeTruthy();
  expect(within(context).getByText("aircraft").parentElement?.textContent).toBe("24 aircraft");
  expect(within(context).getByText(/These counts do not prove disruption/)).toBeTruthy();
  expect(within(context).getByRole("link", { name: /Colombia announces a regional investment programme/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Read News connections" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Evidence filter results" }).textContent).toContain("1 record");
});

it("keeps a pending assessment in the source reader without claiming an event exists", async () => {
  vi.mocked(resolveSourceInvestigation).mockResolvedValue({ status: "pending", event_id: null, reason: "Source assessment is queued." });
  render(<Flow />);
  fireEvent.click(screen.getByRole("button", { name: "Investigate this source" }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Source assessment is queued.");
  expect(screen.queryByRole("heading", { name: "Related signals" })).toBeNull();
  expect(screen.getByRole("link", { name: /Open source/ }).getAttribute("href")).toBe(story.url);
});

it("allows retry after a resolver failure without hiding the source", async () => {
  vi.mocked(resolveSourceInvestigation).mockRejectedValueOnce(new Error("Connection unavailable"))
    .mockResolvedValueOnce({ status: "ineligible", event_id: null, reason: "Insufficient event detail." });
  render(<Flow />);
  fireEvent.click(screen.getByRole("button", { name: "Investigate this source" }));
  expect(await screen.findByText("Connection unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Investigate this source" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Insufficient event detail."));
  expect(screen.queryByRole("heading", { name: "Related signals" })).toBeNull();
});
