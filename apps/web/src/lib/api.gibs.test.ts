import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventGibsContext } from "./api";

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
});
