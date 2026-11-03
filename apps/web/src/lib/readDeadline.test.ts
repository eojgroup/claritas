import { afterEach, expect, it, vi } from "vitest";
import { readWithDeadline } from "./readDeadline";

afterEach(() => vi.useRealTimers());
it("ends a stalled read even when a transport does not honor cancellation", async () => {
  vi.useFakeTimers();
  let requestSignal!: AbortSignal;
  const result = readWithDeadline((signal) => {
    requestSignal = signal;
    return new Promise(() => {});
  }, undefined, 100);
  const failed = expect(result).rejects.toThrow("taking too long");
  await vi.advanceTimersByTimeAsync(100);
  await failed;
  expect(requestSignal.aborted).toBe(true);
});
it("cancels obsolete scope reads and does not start an already cancelled request", async () => {
  const scope = new AbortController();
  const read = vi.fn(() => new Promise(() => {}));
  const result = readWithDeadline(read, scope.signal);
  const failed = expect(result).rejects.toMatchObject({ name: "AbortError" });
  scope.abort();
  await failed;
  await expect(readWithDeadline(read, scope.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(read).toHaveBeenCalledTimes(1);
});
it("releases the deadline once a complete response is available", async () => {
  vi.useFakeTimers();
  await expect(readWithDeadline(async () => ({ available: true }))).resolves.toEqual({ available: true });
  expect(vi.getTimerCount()).toBe(0);
});
