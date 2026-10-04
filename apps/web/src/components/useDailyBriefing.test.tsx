// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDailyBriefing } from "./useDailyBriefing";
import { fetchDailySignalBriefingLatest, type DailySignalBriefing } from "../lib/api";
vi.mock("../lib/api", () => ({ fetchDailySignalBriefingLatest: vi.fn() }));
const edition = { id: 1, title: "Daily edition" } as DailySignalBriefing;
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("recovers a failed initial request when the user returns to the dashboard", async () => {
  vi.mocked(fetchDailySignalBriefingLatest).mockRejectedValueOnce(new Error("Temporary outage")).mockResolvedValue(edition);
  const { result } = renderHook(() => useDailyBriefing(true));
  await waitFor(() => expect(result.current.error).toBe("Temporary outage"));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(() => expect(result.current.briefing).toEqual(edition));
  expect(result.current.error).toBeNull();
});
it("retains the loaded edition during outages and clears it on sign out", async () => {
  vi.mocked(fetchDailySignalBriefingLatest).mockResolvedValueOnce(edition).mockRejectedValue(new Error("Offline"));
  const { result, rerender } = renderHook(({ enabled }) => useDailyBriefing(enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.briefing).toEqual(edition));
  await act(() => result.current.refresh());
  expect(result.current.briefing).toEqual(edition);
  expect(result.current.error).toBe("Offline");
  rerender({ enabled: false });
  expect(result.current.briefing).toBeNull();
});
