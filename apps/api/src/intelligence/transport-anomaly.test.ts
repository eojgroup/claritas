import assert from "node:assert/strict";
import test from "node:test";
import { calculateRollingBaseline, detectTransportAnomaly } from "./transport-anomaly";

test("rolling baselines use a robust median", () => {
  assert.equal(calculateRollingBaseline([10, 11, 12, 100, 9], 5), 11);
});

test("transport anomalies require sufficient baseline and coverage", () => {
  const anomaly = detectTransportAnomaly({
    current: 4,
    previousEquivalent: 10,
    sevenDayMedian: 12,
    twentyEightDayMedian: 11,
    sampleHours: 24 * 7,
  });
  assert.equal(anomaly.anomalous, true);
  assert.equal(anomaly.direction, "below");
  assert.ok((anomaly.percentChange ?? 0) < -0.5);
  assert.equal(detectTransportAnomaly({ current: 0, previousEquivalent: 1, sevenDayMedian: 1, twentyEightDayMedian: 1, sampleHours: 200 }).anomalous, false);
});
