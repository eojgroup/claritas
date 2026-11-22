// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TransportScopeContext from "./TransportScopeContext";
import { event } from "../test/situationFixture";
import type { TransportEntity, TransportHistoryPoint, TransportOverview } from "../lib/api";
const api = vi.hoisted(() => ({ overview: vi.fn(), entity: vi.fn() }));
vi.mock("../lib/api", () => ({ fetchTransportOverview: api.overview, fetchTransportEntity: api.entity }));
const metric = { current: 12, previous: 10, change_pct: 20, direction: "up" as const };
const vessel = { id: "ship-1", entity_id: "123456789", mode: "maritime", display_name: "Example ship", route_label: "Rotterdam → Antwerp", country_links: [{ country: "NL", role: "current" }], observed_at: "2026-11-22T10:00:00Z", speed: 8, source_name: "aisstream", linkage_basis: ["current_country"] } as TransportEntity;
const point = (bucket: string, value: number | null): TransportHistoryPoint => ({ bucket, ship_departures: value, ship_arrivals: value == null ? null : 0, maritime_entities: value, aviation_entities: null, observed_hours: value == null ? 0 : 12, cargo_vessel_departures: value, corridor_maritime_entities: value, corridor_aviation_entities: null, corridor_observed_hours: value == null ? 0 : 12, corridor_observed_origins: value, corridor_flag_proxy_origins: null, source_names: ["aisstream"] });
function overview(country?: string): TransportOverview {
  return { generated_at: "2026-11-22T11:00:00Z", summary: { active: 20, routed: 7 },
    countries: country ? [{ country, trend: { ship_departures: metric, ship_arrivals: metric, tracked_flights: metric } }] : [],
    trends: { maritime: { ship_departures: metric, ship_arrivals: metric }, aviation: { tracked_flights: metric } },
    activity_ranking: { countries: [{ country: "NL", country_name: "Netherlands", current: { observed_movements: 14 }, momentum: metric }] },
    activity: [], routes: [], ports: country ? [{ country, country_name: "Netherlands", location_name: "Rotterdam", departures: 12, arrivals: 10, cargo_vessel_departures: 9 }] : [], entities: country ? [vessel] : [],
    coverage: { maritime: { coverage_note: "Partial tracked areas" }, aviation: { source: "adsb.lol", license: "ODbL" } },
    history: country ? { country, scope: "country", corridor_country: null, requested_days: 400, retention_days: 400, activity_retention_days: 400, movement_retention_days: 100, available_from: "2026-11-19T00:00:00Z", available_to: "2026-11-21T00:00:00Z", observed_days: 2, windows: [], series: [point("2026-11-19T00:00:00Z", 12), point("2026-11-20T00:00:00Z", null), point("2026-11-21T00:00:00Z", 6)], methodology: "Missing days mean no persisted observations, not zero traffic.", comparisons: [{ key: "same_window_last_year", label: "Same period last year", metric: "daily_peak_sampled_entities", comparable: false, change_percent: null, current: { start: "2026-10-23", end: "2026-11-22", days: 30, observed_days: 2, observation_hours: 24, average_daily_entities: 9 }, previous: { start: "2025-10-23", end: "2025-11-22", days: 30, observed_days: 0, observation_hours: 0, average_daily_entities: null }, notice: "Both periods require retained observations." }] } : null,
  } as unknown as TransportOverview;
}
beforeEach(() => { api.overview.mockReset(); api.entity.mockReset(); api.overview.mockImplementation(({ country }: { country?: string }) => Promise.resolve(overview(country))); });
afterEach(cleanup);
it("keeps the global read aggregate and allows browsing into a country", async () => {
  const select = vi.fn(); render(<TransportScopeContext onSelectCountry={select} />);
  fireEvent.click(await screen.findByRole("button", { name: /Netherlands/ }));
  expect(select).toHaveBeenCalledWith("NL");
  expect(api.overview).toHaveBeenCalledWith(expect.objectContaining({ detail: "aggregate", country: undefined, signal: expect.any(AbortSignal) }));
  expect(api.entity).not.toHaveBeenCalled();
});
it("shows retained history gaps and honest year-comparison coverage while preserving linked reporting", async () => {
  const open = vi.fn(); render(<TransportScopeContext country="NL" events={[{ ...event, primary_country_iso2: "NL", event_type: "transport_activity_change", title: "Port delays reported" }]} onOpenEvent={open} />);
  await screen.findByRole("region", { name: "Retained transport history" });
  expect(api.overview).toHaveBeenCalledWith(expect.objectContaining({ country: "NL", detail: "full", historyDays: 400, entityLimit: 160 }));
  expect(screen.getByText(/Comparison unavailable.*2\/30 current days.*0\/30 prior days/)).toBeTruthy();
  fireEvent.click(screen.getByText("Daily counts & gaps"));
  expect(screen.getByText("No retained observation")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("History"), { target: { value: "365" } });
  expect(screen.getByLabelText("History")).toHaveProperty("value", "365");
  fireEvent.click(screen.getByRole("button", { name: /Port delays reported/ })); expect(open).toHaveBeenCalledWith(event.id);
  expect(screen.getByText("Rotterdam")).toBeTruthy();
});
it("fetches an individual vehicle trail only on selection and cancels reads when the panel closes", async () => {
  let signal: AbortSignal | undefined;
  api.entity.mockImplementation((_mode, _id, value: AbortSignal) => { signal = value; return new Promise(() => {}); });
  const view = render(<TransportScopeContext country="NL" />);
  const button = await screen.findByRole("button", { name: /Example ship/ });
  expect(api.entity).not.toHaveBeenCalled(); fireEvent.click(button);
  await waitFor(() => expect(api.entity).toHaveBeenCalledWith("maritime", "123456789", expect.any(AbortSignal)));
  view.unmount(); expect(signal?.aborted).toBe(true);
});
it("cancels the old country request and ignores its eventual response after scope changes", async () => {
  let finish: ((value: TransportOverview) => void) | undefined; let signal: AbortSignal | undefined;
  api.overview.mockImplementationOnce(({ signal: value }: { signal: AbortSignal }) => { signal = value; return new Promise<TransportOverview>((resolve) => { finish = resolve; }); });
  const view = render(<TransportScopeContext country="NL" />); view.rerender(<TransportScopeContext country="BE" />);
  await screen.findByRole("region", { name: "Retained transport history" }); expect(signal?.aborted).toBe(true);
  finish?.(overview("NL"));
  await waitFor(() => expect(screen.getByText("Transport · Belgium")).toBeTruthy());
});
it("keeps reporting from the transport topic cohort visible even before its location resolves", async () => {
  const related = { ...event, id: "linked-report", title: "Port strike reported", primary_country_iso2: null, event_type: "reported_development", origin_domain: "news", signal_domains: ["news"] };
  const unrelated = { ...related, id: "unrelated-report", title: "Unrelated report" };
  const open = vi.fn(); render(<TransportScopeContext country="NL" events={[related, unrelated]} relatedEventIds={[related.id]} onOpenEvent={open} />);
  fireEvent.click(await screen.findByRole("button", { name: /Port strike reported/ }));
  expect(open).toHaveBeenCalledWith("linked-report");
  expect(screen.queryByRole("button", { name: /Unrelated report/ })).toBeNull();
});
