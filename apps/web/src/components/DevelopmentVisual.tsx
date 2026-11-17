import type { OverviewSignalVisual } from "../lib/api";

export default function DevelopmentVisual({ visual }: { visual: OverviewSignalVisual }) {
  if (visual.kind === "transport") {
    const { current, baseline } = visual;
    if (typeof current !== "number" || typeof baseline !== "number" || !Number.isFinite(current) || !Number.isFinite(baseline) || current < 0 || baseline < 0) return null;
    const maximum = Math.max(1, current, baseline);
    return <figure className="development-signal-visual"><figcaption>Transport activity</figcaption>
      <div role="img" aria-label={`Observed ${current} movements; rolling baseline ${baseline}`}>
        <div><span>Observed</span><i style={{ width: `${current / maximum * 100}%` }} /><strong>{current.toLocaleString()}</strong></div>
        <div><span>Baseline</span><i style={{ width: `${baseline / maximum * 100}%` }} /><strong>{baseline.toLocaleString()}</strong></div>
      </div><small>{visual.label} · {new Date(visual.observed_at).toLocaleString()}</small></figure>;
  }
  const values = [[visual.temp_c, "°C"], [visual.precipitation_mm, "mm rain"], [visual.wind_speed, "m/s wind"]] as const;
  return <figure className="development-signal-visual"><figcaption>Weather reference</figcaption><p>{values.filter(([value]) => typeof value === "number" && Number.isFinite(value)).map(([value, unit]) => <strong key={unit}>{Number(value).toFixed(1)} {unit}</strong>)}</p><small>{visual.label} · {new Date(visual.observed_at).toLocaleString()}</small></figure>;
}
