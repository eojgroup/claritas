import type { IntelligenceEventDetail } from "../lib/api";
import SatelliteImage from "./SatelliteImage";

/** Visual summaries reuse the selected event's already-loaded evidence. */
export default function EventSignalVisuals({ detail }: { detail: IntelligenceEventDetail }) {
  const comparison = detail.evidence.find((item) => item.domain === "transport" && item.evidence_type === "rolling_baseline_anomaly"
    && typeof item.metadata?.current === "number" && typeof item.metadata?.baseline === "number");
  const current = Number(comparison?.metadata?.current);
  const baseline = Number(comparison?.metadata?.baseline);
  const comparable = comparison && Number.isFinite(current) && Number.isFinite(baseline) && current >= 0 && baseline >= 0;
  const maximum = Math.max(1, current || 0, baseline || 0);
  const images = (detail.news_images ?? []).slice(0, 3);
  if (!comparable && !images.length) return null;
  return <section className="event-signal-visuals" aria-label="Event signal visuals">
    {comparable && <figure className="event-transport-comparison"><figcaption><strong>Transport activity</strong><span>Same completed UTC hours</span></figcaption>
      <div role="img" aria-label={`Observed ${current} arrivals and departures; rolling baseline ${baseline}`}>
        <div><span>Observed</span><i style={{ width: `${current / maximum * 100}%` }} /><strong>{current.toLocaleString()}</strong></div>
        <div><span>Baseline</span><i style={{ width: `${baseline / maximum * 100}%` }} /><strong>{baseline.toLocaleString()}</strong></div>
      </div><p>Observed telemetry coverage; a change alone does not establish disruption.</p>
    </figure>}
    {images.length > 0 && <div className="event-photo-strip">{images.map((image) => <figure key={image.id}>
      <SatelliteImage sources={[image.preview_url]} alt={image.caption || image.article_title} className="event-context-photo" />
      <figcaption><a href={image.article_url} target="_blank" rel="noreferrer">{image.publisher}</a> · Publisher photo; capture unverified</figcaption>
    </figure>)}</div>}
  </section>;
}
