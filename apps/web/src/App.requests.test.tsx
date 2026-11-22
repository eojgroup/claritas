// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { event, overviewFixture } from "./test/situationFixture";

vi.mock("./components/WorldMapBubbles", () => ({ default: ({ data = [], points = [], onSelectPoint, onSelect }: { data: { count: number }[]; points: { id: string; selected?: boolean }[]; onSelectPoint: (point: { id: string }) => void; onSelect: (country: string) => void }) => <div data-testid="overview-map" data-country-total={data.reduce((sum,item) => sum + item.count,0)} data-point-count={points.length}><button type="button" aria-pressed={points[0]?.selected} onClick={() => onSelectPoint(points[0])}>Map development</button><button type="button" onClick={() => onSelect("SE")}>Map Sweden</button></div> }));
beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.history.replaceState(null, "", "/");
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads the overview and briefing without an optional-feed request burst and shares map/list filters and selection", async () => {
  const requests: string[] = [];
  let pending = 0; let peak = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "http://localhost"); requests.push(url.pathname + url.search);
    pending++; peak = Math.max(peak, pending);
    // Simulate occupied connections: optional domains would stay pending and
    // consume the same five available slots as the initial production pool.
    if (!url.pathname.startsWith("/api/auth/") && !url.pathname.startsWith("/api/intelligence/") && !url.pathname.startsWith("/api/briefings/")) return new Promise<Response>(() => {});
    await new Promise((resolve) => setTimeout(resolve, url.pathname.includes("overview") ? 30 : 10));
    let data: unknown = {};
    if (url.pathname === "/api/auth/me") data = { user: { id: 1, email: "reader@example.test", display_name: "Reader", avatar_url: null, roles: [], billing: { has_access: true } } };
    else if (url.pathname === "/api/auth/providers") data = { providers: [] };
    else if (url.pathname === "/api/intelligence/overview") {
      const overview = overviewFixture(url.searchParams.get("priority") as "high" | "all", url.searchParams.get("country"));
      overview.events.push({ ...event, id: "outside-latest-cohort" });
      overview.map_events = [event, { ...event, id: "older-located-event" }];
      overview.countries = [{ country_iso2: "SE", event_count: 1000, high_priority_count: 20, attention_score: 72, previous_event_count: 900, peak_priority_score: 90 }];
      overview.visual_events = [{ ...event, id: "older-imaged-event", imagery: { preview_url: "/api/news-images/photo/preview", captured_at: null, attribution: "Port authority", source_kind: "publisher" } }];
      data = overview;
    }
    else if (url.pathname === "/api/briefings/daily/latest") data = { briefing: null };
    else if (url.pathname === `/api/intelligence/events/${event.id}`) data = { event, evidence: [], locations: [], earth_observations: [], related_events: [], epistemic_notice: "Evidence limits." };
    else throw new Error(`Unexpected request ${url}`);
    pending--;
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  }));
  render(<App />);
  expect(await screen.findByRole("button", { name: event.title })).toBeTruthy();
  expect(requests.sort()).toEqual(["/api/auth/me", "/api/auth/providers", "/api/briefings/daily/latest", "/api/intelligence/overview?hours=24&priority=all"].sort());
  expect(peak).toBeLessThanOrEqual(3);
  expect(screen.getByTestId("overview-map").getAttribute("data-point-count")).toBe("3");
  expect(screen.getByTestId("overview-map").getAttribute("data-country-total")).toBe("72");
  expect(screen.queryByRole("region", { name: "Images from this period" })).toBeNull();
  fireEvent.click(screen.getByText("Filters"));
  fireEvent.change(screen.getByRole("combobox", { name: "Country shading" }), { target: { value: "priority" } });
  expect(screen.getByTestId("overview-map").getAttribute("data-country-total")).toBe("20");
  fireEvent.change(screen.getByRole("combobox", { name: "Country shading" }), { target: { value: "activity" } });
  expect(screen.getByTestId("overview-map").getAttribute("data-country-total")).toBe("1000");
  fireEvent.click(screen.getByText("Filters"));
  fireEvent.click(screen.getByRole("button", { name: "Expand map" }));
  expect(screen.getByRole("dialog", { name: "Expanded development map" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Expanded development map" })).toBeNull();
  expect(screen.getByRole("button", { name: "All developments" }).getAttribute("aria-pressed")).toBe("true");
  const mapBeforeContext = screen.getByTestId("overview-map");
  fireEvent.click(screen.getByRole("button", { name: "Show more map" }));
  expect(document.getElementById("world-map-context")?.hasAttribute("inert")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Map development" }));
  // The real lazy detail module is transformed on demand in Vitest. Allow
  // cold compilation under parallel CI load; request concurrency is asserted
  // independently above.
  expect(await screen.findByRole("heading", { name: event.title }, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByTestId("overview-map")).toBe(mapBeforeContext);
  expect(document.getElementById("world-map-context")?.hasAttribute("inert")).toBe(false);
  expect(screen.getByRole("region", { name: "Selected development" }).closest(".situation-workspace")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Map development" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Back to developments" })).toBeTruthy();
  expect(requests.filter((path) => path.includes(`/events/${event.id}`))).toHaveLength(1);
  expect(requests.some((path) => /watchlist|gibs|weather|transport|markets|news/.test(path))).toBe(false);
  fireEvent.click(screen.getByText("Explore surrounding context"));
  await waitFor(() => expect(requests).toContain(`/api/intelligence/events/${event.id}?include_context=true`));
  fireEvent.click(screen.getByRole("button", { name: "High priority" }));
  await waitFor(() => expect(requests).toContain("/api/intelligence/overview?hours=24&priority=high"));
  expect(screen.queryByRole("heading", { name: event.title })).toBeNull();
  await screen.findByRole("button", { name: event.title });
  fireEvent.click(screen.getByRole("button", { name: "Map Sweden" }));
  await waitFor(() => expect(requests).toContain("/api/intelligence/overview?hours=24&country=SE&priority=high"));
  expect(await screen.findByRole("button", { name: "Clear SE ×" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Country profile" })).toBeTruthy();
  const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
  for (const name of ["News", "Social signals", "Podcasts", "Transport", "Weather", "Markets", "Imagery"]) {
    expect(navigation.queryByRole("button", { name })).toBeNull();
  }
  await waitFor(() => expect(requests).toContain("/api/weather/country-latest"));
});
