import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDailySignalBriefingLatest, type DailySignalBriefing } from "../lib/api";

export function useDailyBriefing(enabled: boolean) {
  const [briefing, setBriefing] = useState<DailySignalBriefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const request = ++requestId.current;
    try {
      const latest = await fetchDailySignalBriefingLatest();
      if (request !== requestId.current) return;
      setBriefing(latest);
      setError(null);
    } catch (reason) {
      if (request !== requestId.current) return;
      // Keep a usable edition visible during a temporary outage.
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) { setBriefing(null); setError(null); return; }
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, 5 * 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      ++requestId.current;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, refresh]);
  return { briefing, error, refresh };
}
