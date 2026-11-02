import { useEffect, useRef } from "react";

/** Poll only while visible and wait for a request to finish before scheduling another. */
export function useVisiblePolling(
  enabled: boolean,
  intervalMs: number,
  refreshKey: string | number,
  refresh: (signal: AbortSignal) => Promise<void>,
) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const visible = () => document.visibilityState !== "hidden";
    const run = async () => {
      if (controller.signal.aborted || pending || !visible()) return;
      clearTimeout(timer);
      pending = true;
      try {
        await refreshRef.current(controller.signal);
      } finally {
        pending = false;
        if (!controller.signal.aborted && visible()) timer = setTimeout(() => { void run(); }, intervalMs);
      }
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      if (visible()) void run();
    };
    void run();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, intervalMs, refreshKey]);
}
