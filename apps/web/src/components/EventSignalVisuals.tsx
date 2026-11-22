import { useEffect, useState } from "react";
import { fetchEventWeather, type EventWeatherVisual as Weather, type IntelligenceEventDetail } from "../lib/api";
import EventWeatherVisual from "./EventWeatherVisual";
import SatelliteImage from "./SatelliteImage";
import { sortEarthObservationsForDisplay } from "./earthObservationPresentation";
import EventTransportDetails from "./EventTransportDetails";

/** Visual summaries reuse the selected event's already-loaded evidence. */
export default function EventSignalVisuals({ detail, onOpenEvent }: { detail: IntelligenceEventDetail; onOpenEvent?: (id: string) => void }) {
  const [layer, setLayer] = useState<"images" | "transport" | "weather" | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherLoaded, setWeatherLoaded] = useState(false);
  const [weatherError, setWeatherError] = useState(false);
  const [movementDetails, setMovementDetails] = useState(false);
  const country = detail.event?.primary_country_iso2;
  useEffect(() => {
    if (layer !== "weather" || weatherLoaded || !country) return;
    const controller = new AbortController();
    void fetchEventWeather(detail.event.id, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setWeather(value); setWeatherLoaded(true); }
    }).catch(() => { if (!controller.signal.aborted) { setWeatherError(true); setWeatherLoaded(true); } });
    return () => controller.abort();
  }, [layer, country, detail.event?.id, weatherLoaded]);
  const comparison = detail.evidence.find((item) => item.domain === "transport" && item.evidence_type === "rolling_baseline_anomaly"
    && typeof item.metadata?.current === "number" && typeof item.metadata?.baseline === "number");
  const current = Number(comparison?.metadata?.current);
  const baseline = Number(comparison?.metadata?.baseline);
  const comparable = comparison && Number.isFinite(current) && Number.isFinite(baseline) && current >= 0 && baseline >= 0;
  const movement = "arrivals and departures";
  const maximum = Math.max(1, current || 0, baseline || 0);
  const images = (detail.news_images ?? []).slice(0, 3);
  const scene = sortEarthObservationsForDisplay(detail.earth_observations ?? [])
    .filter((observation) => observation.product_type === "true_color" && observation.status === "available")
    .map((observation) => ({ observation, asset: observation.imagery?.preferred_asset ?? observation.assets?.find((asset) => asset.asset_type === "preview") }))
    .find(({ asset }) => asset?.url);
  const retained = (detail.context_images ?? []).slice(0, scene || images.length ? 1 : 2);
  const hasImages = images.length > 0 || Boolean(scene) || retained.length > 0;
  const selected = layer ?? (hasImages ? "images" : comparable ? "transport" : null);
  if (!comparable && !hasImages && !country) return null;
  return <section className="event-signal-visuals" aria-label="Event signal visuals">
    <div className="event-visual-layers" role="group" aria-label="Event visual layers">
      {hasImages && <button type="button" aria-pressed={selected === "images"} onClick={() => setLayer("images")}>Images</button>}
      {comparable && <button type="button" aria-pressed={selected === "transport"} onClick={() => setLayer("transport")}>Transport</button>}
      {country && <button type="button" aria-pressed={selected === "weather"} onClick={() => setLayer("weather")}>{weatherLoaded ? "Weather" : "Load weather"}</button>}
    </div>
    {selected === "weather" && (!weatherLoaded ? <p role="status">Loading weather context…</p> : weather ? <EventWeatherVisual weather={weather} /> : <p>{weatherError ? "Weather could not be loaded." : "No weather reference sample close to this event’s update time."}{weatherError && <button type="button" onClick={() => { setWeatherError(false); setWeatherLoaded(false); }}>Retry weather</button>}</p>)}
    {selected === "transport" && comparable && <figure className="event-transport-comparison"><figcaption><strong>Transport activity</strong><span>Same completed UTC hours</span></figcaption>
      <div role="img" aria-label={`Observed ${current} ${movement}; rolling baseline ${baseline}`}>
        <div><span>Observed</span><i style={{ width: `${current / maximum * 100}%` }} /><strong>{current.toLocaleString()}</strong></div>
        <div><span>Baseline</span><i style={{ width: `${baseline / maximum * 100}%` }} /><strong>{baseline.toLocaleString()}</strong></div>
      </div><p>Observed telemetry coverage; a change alone does not establish disruption.</p>
      <details open={movementDetails} onToggle={(event) => setMovementDetails(event.currentTarget.open)}><summary>Explore this anomaly’s movements</summary>
        {movementDetails && <EventTransportDetails eventId={detail.event.id} />}
      </details>
    </figure>}
    {selected === "images" && hasImages && <div className="event-photo-strip">
    {scene && <figure>
      <SatelliteImage sources={[scene.asset!.url]} alt={`Satellite view of ${scene.observation.location_name || detail.event.location_name || "the event area"}`} className="event-context-photo" />
      <figcaption>Event-linked satellite view · Captured {new Date(scene.observation.capture_start).toLocaleDateString()}<br />{scene.observation.attribution || scene.observation.mission}</figcaption>
    </figure>}
    {images.map((image) => <figure key={image.id}>
      <SatelliteImage sources={[image.preview_url]} alt={image.caption || image.article_title} className="event-context-photo" />
      <figcaption><a href={image.article_url} target="_blank" rel="noreferrer">{image.publisher}</a> · Publisher photo; capture unverified</figcaption>
    </figure>)}
    {retained.map((image) => <figure key={`context-${image.id}`}>
      <SatelliteImage sources={[image.thumbnail_url || image.preview_url]} alt={image.title} className="event-context-photo" />
      <figcaption><strong>Retained location context</strong><br />{image.captured_at ? `Captured ${new Date(image.captured_at).toLocaleDateString()}` : "Capture time unverified"} · {image.attribution}
        <details><summary>Image source & limits</summary><p>{image.notice}</p>{image.source_url && <a href={image.source_url} target="_blank" rel="noreferrer">Image provenance</a>}<p>{image.license}</p></details>
        {image.source_event_id && onOpenEvent && <button type="button" onClick={() => onOpenEvent(image.source_event_id!)}>Open original event</button>}
      </figcaption>
    </figure>)}
    </div>}
  </section>;
}
