// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVisiblePolling } from "./useVisiblePolling";

function Poller({ refresh, enabled = true, scope = "scope" }: { refresh: (signal: AbortSignal) => Promise<void>; enabled?: boolean; scope?: string }) {
  useVisiblePolling(enabled, 1_000, scope, refresh);
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("waits for a slow request and pauses polling while the page is hidden", async () => {
  let finish!: () => void;
  const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<Poller refresh={refresh} />);
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { finish(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(refresh).toHaveBeenCalledTimes(2);
  // Repeated focus events cannot start parallel reads either.
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("aborts the active read and removes future work when disabled", async () => {
  let signal!: AbortSignal;
  const refresh = vi.fn(async (value: AbortSignal) => { signal = value; });
  const { rerender } = render(<Poller refresh={refresh} />);
  await act(async () => {});
  rerender(<Poller refresh={refresh} enabled={false} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("aborts the old account read when the authenticated scope changes", async () => {
  const signals: AbortSignal[] = [];
  let finishOld!: () => void;
  const refresh = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return signals.length === 1 ? new Promise<void>((resolve) => { finishOld = resolve; }) : Promise.resolve();
  });
  const { rerender } = render(<Poller refresh={refresh} scope="account-a" />);
  rerender(<Poller refresh={refresh} scope="account-b" />);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  await act(async () => { finishOld(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  // Only the current account schedules another read after both finish.
  expect(refresh).toHaveBeenCalledTimes(3);
});
