// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SituationDashboard from "./SituationDashboard";
import { event, overviewFixture } from "../test/situationFixture";

vi.mock("./WorldMapBubbles", () => ({ default: ({ onSelect, onSelectPoint, data, corridors=[] }: { data:unknown; corridors?:unknown[]; onSelect: (iso: string) => void; onSelectPoint: (point: { id: string }) => void }) => <div data-testid="map-camera" data-countries={JSON.stringify(data)} data-corridors={JSON.stringify(corridors)}><button onClick={() => onSelect("SE")}>Select Sweden</button><button onClick={() => onSelect("NO")}>Select Norway</button><button onClick={() => onSelectPoint({ id: event.id })}>Select port event</button></div> }));
vi.mock("./OverviewCountryProfile", () => ({ default: () => <section aria-label="Country profile">Sweden profile</section> }));
vi.mock("./IntelligenceWorkspace", () => ({ default: () => <h3>Selected event evidence</h3> }));
vi.mock("./MarketScopeContext", () => ({ default: ({ country, expanded }: { country?: string; expanded: boolean }) => <section aria-label="Market glance">{country || "World"} markets{expanded && <h3>Market explorer</h3>}</section> }));
vi.mock("./TransportScopeContext", () => ({ default: ({ country }: { country?: string }) => <section aria-label="Transport explorer">{country || "World"} transport history</section> }));
afterEach(cleanup);

function Workspace({ initialEventID = null }: { initialEventID?: string | null }) {
  const [country, setCountry] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialEventID);
  return <SituationDashboard overview={overviewFixture("all", country)} loading={false} error={null}
    hours={24} topic={null} priority="all" country={country} selectedId={selectedId} dark
    briefing={null} briefingError={null} onHoursChange={vi.fn()} onTopicChange={vi.fn()}
    onPriorityChange={vi.fn()} onCountryChange={setCountry} onSelect={setSelectedId}
    onOpenImagery={vi.fn()} onRefresh={vi.fn()} onRefreshBriefing={async () => {}} />;
}

it("keeps the expanded map and its camera mounted while country and event context opens", async () => {
  render(<Workspace />);
  const expand = screen.getByRole("button", { name: "Expand map" });
  fireEvent.click(expand);
  const map = screen.getByTestId("map-camera");
  fireEvent.click(screen.getByRole("button", { name: "Select Sweden" }));
  expect(screen.getByRole("dialog", { name: "Expanded development map" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Country profile" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Weather, markets & country profile/ }));
  expect(screen.getByRole("region", { name: "Country profile" })).toBeTruthy();
  expect(screen.getByTestId("map-camera")).toBe(map);
  fireEvent.click(screen.getByRole("button", { name: "All countries ×" }));
  expect(screen.queryByRole("region", { name: "Country profile" })).toBeNull();
  expect(screen.getByTestId("map-camera")).toBe(map);
  fireEvent.click(screen.getByRole("button", { name: "Select Sweden" }));
  fireEvent.click(screen.getByRole("button", { name: "Select port event" }));
  expect(await screen.findByRole("heading", { name: "Selected event evidence" })).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Expanded development map" })).toBeTruthy();
  expect(screen.getByTestId("map-camera")).toBe(map);
  fireEvent.click(screen.getByRole("button", { name: "Back to developments" }));
  expect(screen.getByRole("region", { name: "Activity over time" })).toBeTruthy();
  expect(screen.getByTestId("map-camera")).toBe(map);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("lets keyboard users resize context without unmounting the map or its timeline", () => {
  render(<Workspace />);
  const map = screen.getByTestId("map-camera");
  const handle = screen.getByRole("button", { name: "Resize context panel" });
  fireEvent.keyDown(handle, { key: "Home" });
  expect(document.getElementById("world-map-context")?.hasAttribute("inert")).toBe(true);
  fireEvent.keyDown(handle, { key: "End" });
  expect(document.getElementById("world-map-context")?.hasAttribute("inert")).toBe(false);
  expect(screen.getByRole("region", { name: "Activity over time" })).toBeTruthy();
  expect(screen.getByTestId("map-camera")).toBe(map);
});

it("puts a directly opened event before the general overview controls", async () => {
  render(<Workspace initialEventID={event.id} />);
  await screen.findByRole("heading", { name: "Selected event evidence" });
  const detail = screen.getByRole("region", { name: "Selected development" });
  const overview = screen.getByRole("region", { name: "Situation overview" });
  expect(detail.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("leads with country developments and keeps reference context available without remounting the map", () => {
  render(<Workspace />);
  const map = screen.getByTestId("map-camera");
  fireEvent.click(screen.getByRole("button", { name: "Select Sweden" }));
  expect(screen.queryByRole("region", { name: "Country profile" })).toBeNull();
  const developments = screen.getByRole("region", { name: "Latest developments" });
  const briefing = screen.getByRole("region", { name: "Daily briefing" });
  expect(developments.compareDocumentPosition(briefing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Weather, markets & country profile/ }));
  expect(screen.getByRole("region", { name: "Country profile" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Widen context" }));
  expect(screen.getByRole("button", { name: "Narrow context" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByTestId("map-camera")).toBe(map);
});

it("leaves country focus to the profile instead of scheduling an overview scroll", () => {
  const onSelect = vi.fn();
  render(<SituationDashboard overview={overviewFixture("all")} loading={false} error={null}
    hours={24} topic={null} priority="all" country={null} selectedId={null} dark
    briefing={null} briefingError={null} onHoursChange={vi.fn()} onTopicChange={vi.fn()}
    onPriorityChange={vi.fn()} onCountryChange={vi.fn()} onSelect={onSelect}
    onOpenImagery={vi.fn()} onRefresh={vi.fn()} onRefreshBriefing={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Select Sweden" }));
  expect(onSelect).toHaveBeenCalledWith(null, { focus: false });
});

it("keeps explicit transport map browsing scoped while developments remains the default", async () => {
  render(<Workspace />);
  const map = screen.getByTestId("map-camera");
  expect(within(screen.getByRole("navigation", { name: "Explore selected scope" })).queryByRole("button", { name: "Markets" })).toBeNull();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Explore selected scope" })).getByRole("button", { name: "Transport" }));
  expect((await screen.findByRole("region", { name: "Transport explorer" })).textContent).toContain("World transport history");
  fireEvent.click(screen.getByRole("button", { name: "Select Sweden" }));
  expect(screen.getByRole("button", { name: "Transport" }).getAttribute("aria-pressed")).toBe("true");
  expect((await screen.findByRole("region", { name: "Transport explorer" })).textContent).toContain("SE transport history");
  fireEvent.click(screen.getByRole("button", { name: "Select Norway" }));
  expect((await screen.findByRole("region", { name: "Transport explorer" })).textContent).toContain("NO transport history");
  expect(screen.getByRole("button", { name: "Transport" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button",{name:"Clear SE ×"})).toBeNull();
  expect(screen.getByRole("button",{name:"Clear NO ×"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Developments" }));
  expect(screen.getByRole("region", { name: "Activity over time" })).toBeTruthy();
  expect(screen.getByTestId("map-camera")).toBe(map);
});

it("shades secondary countries from the selected developments without drawing country arcs", () => {
  const overview=overviewFixture("all","SE");
  overview.country_links=[{country_iso2:"SE",event_count:8,high_priority_count:3},{country_iso2:"NO",event_count:2,high_priority_count:1}];
  render(<SituationDashboard overview={overview} loading={false} error={null} hours={24} topic={null} priority="all" country="SE" selectedId={null} dark briefing={null} briefingError={null} onHoursChange={vi.fn()} onTopicChange={vi.fn()} onPriorityChange={vi.fn()} onCountryChange={vi.fn()} onSelect={vi.fn()} onOpenImagery={vi.fn()} onRefresh={vi.fn()} onRefreshBriefing={async()=>{}} />);
  const map=screen.getByTestId("map-camera");
  expect(JSON.parse(map.getAttribute("data-countries")!)).toEqual([{country:"SE",count:8},{country:"NO",count:2}]);
  expect(map.getAttribute("data-corridors")).toBe("[]");
});

it("switches directly between map countries in developments without clearing the filter", () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole("button",{name:"Select Sweden"}));
  expect(screen.getByRole("button",{name:"Clear SE ×"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Select Norway"}));
  expect(screen.queryByRole("button",{name:"Clear SE ×"})).toBeNull();
  expect(screen.getByRole("button",{name:"Clear NO ×"})).toBeTruthy();
});
