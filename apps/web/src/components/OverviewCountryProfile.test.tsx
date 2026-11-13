// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OverviewCountryProfile from "./OverviewCountryProfile";
import { overviewFixture } from "../test/situationFixture";
const api = vi.hoisted(() => ({ leadership: vi.fn(), weather: vi.fn(), market: vi.fn() }));
vi.mock("../lib/api", () => ({ fetchCountryLeadership: api.leadership, fetchCountryWeather: api.weather, fetchCountryMarketDetail: api.market }));
vi.mock("./CountryFacts", () => ({ default: () => null }));
afterEach(cleanup);
it("publishes available country data while a provider is slow", async () => {
  let finishWeather!: (items: unknown[]) => void;
  api.weather.mockImplementation(() => { return new Promise((resolve) => { finishWeather = resolve; }); });
  api.leadership.mockResolvedValue([{ country: "SE", summary: "Swedish leadership reference", roles: [] }]);
  api.market.mockResolvedValue({ summary: { index_name: "OMX", index_change_percent: 1.2 } });
  const view = render(<OverviewCountryProfile country="SE" overview={overviewFixture()} onClose={vi.fn()} />);
  expect(await screen.findByText("Swedish leadership reference")).toBeTruthy();
  expect(await screen.findByText("OMX")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Loading");
  await act(async () => { finishWeather([{ country: "SE", temp_c: 10, weather_desc: "Clear" }]); });
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(screen.getByText("10°C · Clear")).toBeTruthy();
  view.unmount();
});

it("cancels an outstanding selected-country read on close", () => {
  let marketSignal: AbortSignal | undefined;
  api.market.mockImplementation((_country: string, signal: AbortSignal) => { marketSignal = signal; return new Promise(() => {}); });
  const view = render(<OverviewCountryProfile country="DE" overview={overviewFixture()} onClose={vi.fn()} />);
  view.unmount();
  expect(marketSignal?.aborted).toBe(true);
});
