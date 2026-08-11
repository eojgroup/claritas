import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventGibsContext, fetchIntelligenceEvents } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("fetchEventGibsContext", () => {
  it.each([404, 503])("treats HTTP %s as optional context", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEventGibsContext("event/with spaces")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/earth-observation/events/event%2Fwith%20spaces/gibs",
      { credentials: "include" },
    );
  });

  it("never exposes a reverse-proxy HTML failure document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "<html><head><title>502 Server Error</title></head><body>upstream trace</body></html>",
      { status: 502, headers: { "content-type": "text/html; charset=utf-8" } },
    )));

    const failure = await fetchIntelligenceEvents().catch((reason: unknown) => reason as Error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error("Expected intelligence request to fail");
    expect(failure.message).toContain("temporarily unavailable");
    expect(failure.message).toContain("HTTP 502");
    expect(failure.message).not.toContain("<html>");
    expect(failure.message).not.toContain("upstream trace");
  });

  it("uses a governed transient message even when a 502 JSON body contains internal detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "database pool internal upstream detail" }),
      { status: 502, headers: { "content-type": "application/json" } },
    )));

    const failure = await fetchIntelligenceEvents().catch((reason: unknown) => reason as Error);
    if (!(failure instanceof Error)) throw new Error("Expected intelligence request to fail");
    expect(failure.message).toContain("retry shortly");
    expect(failure.message).not.toContain("database pool");
  });
});
