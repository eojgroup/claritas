import assert from "node:assert/strict";
import test from "node:test";
import { FRED_SERIES, parseFredObservations } from "./fred-market-data";

test("FRED parser ignores missing observations and invalid values", () => {
  assert.deepEqual(parseFredObservations({ observations: [
    { date: "2026-07-20", value: "86.99", realtime_start: "2026-07-22", realtime_end: "2026-07-22" },
    { date: "2026-07-21", value: "." },
    { date: "not-a-date", value: "12" },
  ] }), [{ date: "2026-07-20", value: 86.99, realtimeStart: "2026-07-22", realtimeEnd: "2026-07-22" }]);
});

test("FRED allowlist contains only declared public-institution publishers", () => {
  assert.ok(FRED_SERIES.length >= 6);
  assert.ok(FRED_SERIES.every((series) => /U\.S\.|Federal Reserve/.test(series.originalPublisher)));
});
