// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TransportScopeContext from "./TransportScopeContext";
import { event } from "../test/situationFixture";
import type { TransportEntity, TransportHistoryPoint, TransportOverview } from "../lib/api";
const api = vi.hoisted(() => ({ overview: vi.fn(), entity: vi.fn(), positions: vi.fn(), ports: vi.fn(), outlook: vi.fn() }));
vi.mock("../lib/api", () => ({ fetchTransportOverview: api.overview, fetchTransportEntity: api.entity, fetchTransportPositions: api.positions, fetchTransportPortActivity: api.ports, fetchTransportOutlook: api.outlook }));
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
beforeEach(() => {
 api.overview.mockReset();api.entity.mockReset();api.positions.mockReset();api.ports.mockReset();api.outlook.mockReset();
 api.overview.mockImplementation(({country}:{country?:string})=>Promise.resolve(overview(country)));
 api.positions.mockResolvedValue({generated_at:"2026-11-22T11:00:00Z",entities:[{...vessel,latitude:52,longitude:4}],limit:600,truncated:false,cohort:null});
 api.ports.mockResolvedValue({generated_at:"2026-11-22T11:00:00Z",window_hours:24,ports:[{country:"NL",name:"Rotterdam",latitude:52,longitude:4,departures:12,arrivals:10,hours:[{bucket:"2026-11-22T10:00:00Z",departures:12,arrivals:10}]}]});
 api.outlook.mockResolvedValue({corridors:[]});
});
afterEach(cleanup);
it("loads bounded positions independently while historical overview is still pending",async()=>{
 api.overview.mockImplementation(()=>new Promise(()=>{}));const publish=vi.fn();render(<TransportScopeContext country="NL" onMapChange={publish}/>);
 await waitFor(()=>expect(publish).toHaveBeenCalledWith(expect.objectContaining({positions:expect.objectContaining({entities:[expect.objectContaining({latitude:52,longitude:4})]})})));
 expect(api.positions).toHaveBeenCalledWith("NL",expect.objectContaining({mode:"all",window:null}),expect.any(AbortSignal));
 expect(await screen.findByRole("button",{name:/Example ship/})).toBeTruthy();
});
it("filters current positions from mode cards without rerunning the historical aggregates",async()=>{
 render(<TransportScopeContext country="NL"/>);fireEvent.click(await screen.findByRole("button",{name:/Aircraft/}));
 await waitFor(()=>expect(api.positions).toHaveBeenLastCalledWith("NL",expect.objectContaining({mode:"aviation"}),expect.any(AbortSignal)));
 expect(api.overview).toHaveBeenCalledTimes(1);
});
it("makes corridor heat tiles and port frequency rows filter map positions",async()=>{
 const value=overview("NL");value.routes=[{mode:"maritime",origin_country:"NL",destination_country:"BE",origin_name:"Netherlands",destination_name:"Belgium",active_count:17,origin_basis:"observed",examples:[]}];api.overview.mockResolvedValue(value);
 render(<TransportScopeContext country="NL"/>);
 fireEvent.click(await screen.findByRole("button",{name:/Filter connection Belgium/}));
 await waitFor(()=>expect(api.positions).toHaveBeenLastCalledWith("NL",expect.objectContaining({corridor:"BE"}),expect.any(AbortSignal)));
 fireEvent.click(screen.getByRole("button",{name:/Rotterdam.*12.*departures/}));
 await waitFor(()=>expect(api.positions).toHaveBeenLastCalledWith("NL",expect.objectContaining({port:"Rotterdam",mode:"maritime",corridor:""}),expect.any(AbortSignal)));
});
it("selects a historical activity cohort and an actual departure cohort, with gaps unselectable",async()=>{
 render(<TransportScopeContext country="NL"/>);const history=await screen.findByRole("region",{name:"Retained transport history"});
 const charts=within(history).getAllByRole("group");
 const activity=charts.find(chart=>chart.tagName.toLowerCase()==="svg")!;
 const periods=within(activity).getAllByRole("button");expect(periods).toHaveLength(2);fireEvent.click(periods[0]);
 await waitFor(()=>expect(api.positions).toHaveBeenLastCalledWith("NL",expect.objectContaining({window:{from:"2026-11-19T00:00:00.000Z",to:"2026-11-20T00:00:00.000Z"}}),expect.any(AbortSignal)));
 const plots=within(history).getAllByRole("group").filter(chart=>chart.tagName.toLowerCase()==="svg");fireEvent.click(within(plots[1]).getAllByRole("button")[0]);
 await waitFor(()=>expect(api.positions).toHaveBeenLastCalledWith("NL",expect.objectContaining({movement:"departure",mode:"maritime"}),expect.any(AbortSignal)));
 fireEvent.click(screen.getByRole("button",{name:/Aircraft/}));
 await waitFor(()=>expect(api.positions).toHaveBeenLastCalledWith("NL",expect.objectContaining({mode:"aviation",movement:undefined}),expect.any(AbortSignal)));
 fireEvent.click(within(screen.getByLabelText("History window")).getByRole("button",{name:"Year"}));expect(screen.getByText(/Missing days mean/)).toBeTruthy();
});
it("opens a selected vehicle trail on demand and cancels its read on unmount",async()=>{
 let signal:AbortSignal|undefined;api.entity.mockImplementation((_mode,_id,value:AbortSignal)=>{signal=value;return new Promise(()=>{});});
 const view=render(<TransportScopeContext country="NL"/>);fireEvent.click(await screen.findByRole("button",{name:/Example ship/}));
 await waitFor(()=>expect(api.entity).toHaveBeenCalledWith("maritime",vessel.entity_id,expect.any(AbortSignal)));view.unmount();expect(signal?.aborted).toBe(true);
});
it("cancels old scoped map reads and keeps explicitly linked reporting visible",async()=>{
 let signal:AbortSignal|undefined;api.positions.mockImplementationOnce((_country,_selection,value:AbortSignal)=>{signal=value;return new Promise(()=>{});});
 const open=vi.fn(),related={...event,id:"linked-report",title:"Port strike reported",primary_country_iso2:null,origin_domain:"news"};
 const view=render(<TransportScopeContext country="NL" events={[related]} relatedEventIds={[related.id]} onOpenEvent={open}/>);
 view.rerender(<TransportScopeContext country="BE" events={[related]} relatedEventIds={[related.id]} onOpenEvent={open}/>);expect(signal?.aborted).toBe(true);
 fireEvent.click(await screen.findByRole("button",{name:/Port strike reported/}));expect(open).toHaveBeenCalledWith(related.id);
});
