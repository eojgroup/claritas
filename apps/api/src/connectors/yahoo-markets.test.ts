import assert from "node:assert/strict";
import test from "node:test";

import { MARKET_INSTRUMENTS, parseYahooChart } from "./yahoo-market-data";

test("major market catalogue covers requested exchanges and commodities", () => {
  for (const symbol of ["^HSI", "^N225", "^OMX", "^OMXC25", "^GDAXI", "^GSPC", "^FTSE", "GC=F", "CL=F"])
    assert.ok(MARKET_INSTRUMENTS.some((item) => item.symbol === symbol), symbol);
});

test("chart parser rejects gaps and preserves historical dates", () => {
  const points = parseYahooChart({ chart: { result: [{ timestamp: [1704067200, 1704153600], indicators: { quote: [{ close: [100.5, null] }] } }] } });
  assert.deepEqual(points, [{ date: "2024-01-01", observedAt: "2024-01-01T00:00:00.000Z", value: 100.5 }]);
});
