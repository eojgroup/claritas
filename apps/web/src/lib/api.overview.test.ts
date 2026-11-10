import { afterEach, expect, it, vi } from "vitest";
import { fetchIntelligenceOverview } from "./api";

afterEach(() => vi.unstubAllGlobals());
it("requests one bounded overview with the selected topic, place and period", async () => {
  const overview = { summary: { event_count: 3 }, events: [], timeline: [] };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(overview), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchIntelligenceOverview({ hours: 72, country: "SE", topic: "transport" })).resolves.toEqual(overview);
  expect(fetch).toHaveBeenCalledOnce();
  const [address, init] = fetch.mock.calls[0];
  const url = new URL(address, "https://claritas.test");
  expect(url.pathname).toBe("/api/intelligence/overview");
  expect(Object.fromEntries(url.searchParams)).toEqual({ hours: "72", country: "SE", topic: "transport", priority: "high" });
  expect(init.credentials).toBe("include");
  expect(init.signal).toBeInstanceOf(AbortSignal);
});
