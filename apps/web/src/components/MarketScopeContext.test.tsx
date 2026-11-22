// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MarketScopeContext from "./MarketScopeContext";
import type { IntelligenceEvent } from "../lib/api";
const api = vi.hoisted(() => ({ overview: vi.fn(), quotes: vi.fn(), detail: vi.fn() }));
vi.mock("../lib/api", () => ({ fetchCountryMarketOverview: api.overview, fetchMarketQuotes: api.quotes, fetchCountryMarketDetail: api.detail }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows saved market context at a glance, browses global instruments on demand and cancels country history when scope changes", async () => {
  const row = { country: "SE", country_name: "Sweden", index_name: "OMX", index_value: 2500, index_change_percent: 1.2,
    index_period_end: "2026-10-31", index_frequency: "monthly", index_source: "OECD", currency: "SEK", fx_rate: 11,
    fx_change_percent: -.5, fx_period_end: "2026-11-20", freshness: "current", macro_latest_year: 2025 };
  api.overview.mockResolvedValue({ countries: [row], coverage: { with_index: 1, with_fx: 1 }, methodology: { macro: "Annual indicators" } });
  api.quotes.mockResolvedValue([{ symbol: "BRENT", company_name: "Brent crude", price: 80, percent_change: 2,
    currency: "USD", period_end: "2026-11-20", observed_at: "2026-11-20T20:00:00Z", frequency: "daily", source_name: "Saved source" }]);
  const select = vi.fn(), toggle = vi.fn();
  const view = render(<MarketScopeContext onToggle={toggle} onSelectCountry={select} />);
  expect(await screen.findByText("OMX", { exact: false })).toBeTruthy();
  expect(screen.getByText("monthly · 2026-10-31 · OECD")).toBeTruthy();
  expect(api.quotes).not.toHaveBeenCalled();
  expect(api.detail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Explore markets" }));
  expect(toggle).toHaveBeenCalledOnce();
  view.rerender(<MarketScopeContext expanded onToggle={toggle} onSelectCountry={select} />);
  expect(await screen.findByText("Brent crude")).toBeTruthy();
  expect(api.quotes).toHaveBeenCalledWith({ refresh: false, signal: expect.any(AbortSignal) });
  fireEvent.click(screen.getByRole("button", { name: "Currencies" }));
  expect(screen.getByText("Currency rates against EUR")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: /Sweden/ })[0]);
  expect(select).toHaveBeenCalledWith("SE");
  let signal: AbortSignal | undefined;
  api.detail.mockImplementation((_iso: string, input: AbortSignal) => { signal = input; return new Promise(() => {}); });
  view.rerender(<MarketScopeContext country="SE" expanded onSelectCountry={select} />);
  await waitFor(() => expect(api.detail).toHaveBeenCalledWith("SE", expect.any(AbortSignal)));
  expect(screen.getByRole("region", { name: "Markets in Sweden" })).toBeTruthy();
  const previousSignal = signal;
  view.rerender(<MarketScopeContext country="NO" expanded onSelectCountry={select} />);
  expect(previousSignal?.aborted).toBe(true);
});

it("keeps currency-only world coverage visible and exposes selected-country history, filings and instruments", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 700_000);
  const row = { country: "JP", country_name: "Japan", index_value: null, index_change_percent: null,
    currency: "JPY", fx_rate: 160, fx_change_percent: .8, fx_period_end: "2026-11-20", freshness: "current" };
  api.overview.mockResolvedValue({ countries: [row], coverage: { with_index: 0, with_fx: 1 }, methodology: { macro: "Annual indicators" } });
  const view = render(<MarketScopeContext />);
  expect(await screen.findByText(/JPY vs EUR/)).toBeTruthy();
  expect(screen.getByText("2026-11-20 · ECB")).toBeTruthy();
  api.detail.mockResolvedValue({ summary: row, index_history: [],
    fx_history: [{ period_end: "2026-11-19", value: 159 }, { period_end: "2026-11-20", value: 160 }],
    related_instruments: [{ symbol: "NIKKEI", company_name: "Nikkei benchmark", price: 40000, percent_change: 1,
      observed_at: "2026-11-20T08:00:00Z", period_end: "2026-11-20", source_name: "Saved publisher" }],
    filings: [{ id: 1, title: "Annual company report", url: "https://example.org/report", event_time: "2026-11-19T08:00:00Z", source_name: "SEC" }],
    methodology: { macro: "Annual indicators" } });
  const reporting = { id: "financial-news", origin_domain: "news", signal_domains: ["news"], title: "Japanese energy companies report earnings",
    primary_country_iso2: null, last_activity_time: "2026-11-20T08:00:00Z" } as IntelligenceEvent;
  const open = vi.fn();
  view.rerender(<MarketScopeContext country="JP" expanded events={[reporting]} relatedEventIds={[reporting.id]} onOpenEvent={open} />);
  expect(await screen.findByRole("img", { name: /JPY vs EUR from 2026-11-19 to 2026-11-20/ })).toBeTruthy();
  expect(screen.getByText("Nikkei benchmark")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Annual company report" }).getAttribute("href")).toBe("https://example.org/report");
  fireEvent.click(screen.getByRole("button", { name: /Japanese energy companies report earnings/ }));
  expect(open).toHaveBeenCalledWith(reporting.id);
});
