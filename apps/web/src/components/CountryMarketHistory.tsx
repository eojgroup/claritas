export default function CountryMarketHistory({ label, points }: { label: string; points: Array<{ period_end: string; value: number }> }) {
  const history = points.filter((point) => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.period_end)))
    .sort((a, b) => Date.parse(a.period_end) - Date.parse(b.period_end));
  if (history.length < 2) return null;
  const first = history[0], last = history[history.length - 1];
  const start = Date.parse(first.period_end), end = Date.parse(last.period_end);
  const min = Math.min(...history.map((point) => point.value)), max = Math.max(...history.map((point) => point.value));
  const line = history.map((point) => `${8 + (Date.parse(point.period_end) - start) / Math.max(1, end - start) * 344},${max === min ? 52 : 92 - (point.value - min) / (max - min) * 80}`).join(" ");
  return <figure className="country-market-history"><figcaption><strong>{label}</strong><span>{last.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} · {last.period_end}</span></figcaption>
    <svg viewBox="0 0 360 108" role="img" aria-label={`${label} from ${first.period_end} to ${last.period_end}; range ${min} to ${max}`}>
      <line x1="8" y1="100" x2="352" y2="100" stroke="var(--shell-border)" /><polyline points={line} fill="none" stroke="var(--brand-blue)" strokeWidth="2" />
    </svg><small>{first.period_end} — {last.period_end}</small>
  </figure>;
}
