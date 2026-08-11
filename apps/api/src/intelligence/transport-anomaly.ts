export type BaselineWindow = {
  current: number;
  previousEquivalent: number;
  sevenDayMedian: number;
  twentyEightDayMedian: number;
  sampleHours: number;
};

export type TransportAnomaly = {
  anomalous: boolean;
  direction: "above" | "below" | "stable";
  magnitude: number;
  baseline: number;
  percentChange: number | null;
  confidence: number;
  methodology: string;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function calculateRollingBaseline(values: number[], window = 7): number {
  return median(values.slice(-Math.max(1, window)).filter(Number.isFinite));
}
export function detectTransportAnomaly(input: BaselineWindow, threshold = 0.45): TransportAnomaly {
  const candidates = [input.previousEquivalent, input.sevenDayMedian, input.twentyEightDayMedian]
    .filter((value) => Number.isFinite(value) && value >= 0);
  const baseline = median(candidates);
  const delta = input.current - baseline;
  const percentChange = baseline > 0 ? delta / baseline : input.current > 0 ? null : 0;
  const magnitude = baseline > 0 ? Math.min(1, Math.abs(delta) / Math.max(1, baseline)) : 0;
  const sampleConfidence = Math.min(1, Math.max(0, input.sampleHours / (24 * 7)));
  const anomalous = baseline >= 3 && percentChange !== null && Math.abs(percentChange) >= threshold && sampleConfidence >= 0.25;
  return {
    anomalous,
    direction: !anomalous ? "stable" : delta > 0 ? "above" : "below",
    magnitude: Number(magnitude.toFixed(4)),
    baseline: Number(baseline.toFixed(2)),
    percentChange: percentChange === null ? null : Number(percentChange.toFixed(4)),
    confidence: Number((0.55 + sampleConfidence * 0.4).toFixed(4)),
    methodology: "median(previous-equivalent, 7d same-hour, 28d same-hour); minimum baseline 3; coverage weighted",
  };
}
