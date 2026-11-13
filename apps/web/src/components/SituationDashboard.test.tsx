// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SituationDashboard from "./SituationDashboard";
import { event, overviewFixture } from "../test/situationFixture";

vi.mock("./WorldMapBubbles", () => ({ default: ({ onSelect, onSelectPoint }: { onSelect: (iso: string) => void; onSelectPoint: (point: { id: string }) => void }) => <div data-testid="map-camera"><button onClick={() => onSelect("SE")}>Select Sweden</button><button onClick={() => onSelectPoint({ id: event.id })}>Select port event</button></div> }));
vi.mock("./OverviewCountryProfile", () => ({ default: () => <section aria-label="Country profile">Sweden profile</section> }));
vi.mock("./IntelligenceWorkspace", () => ({ default: () => <h3>Selected event evidence</h3> }));
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
