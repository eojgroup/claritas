import { NewsImageCards } from "./NewsImageGallery";
import CountryFlag from "./CountryFlag";
import { memo } from "react";
import WorldMapBubbles from "./WorldMapBubbles";
import type { IntelligenceEventDetail } from "../lib/api";
import { evidenceFamily, isCoverageAssessment, sourceFamilyLabel } from "./eventSourcePresentation";
import SatelliteImage from "./SatelliteImage";

const validPoint = (lat: unknown, lon: unknown): lat is number => typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

const EventLocationMap = memo(function EventLocationMap({ detail }: { detail: IntelligenceEventDetail }) {
  const located = detail.locations.filter((location) => validPoint(location.latitude, location.longitude) && !["country", "country_centroid", "admin", "admin1", "administrative_area"].includes(location.location_type ?? ""));
  const coordinates = detail.understanding?.coordinates;
  const primary = coordinates && validPoint(coordinates.latitude, coordinates.longitude) ? coordinates : null;
  const center = primary ?? located[0];
  const points = [...(primary ? [{ id: "event", latitude: primary.latitude, longitude: primary.longitude, title: primary.label, subtitle: primary.basis === "estimated_mapped" ? "Estimated event location" : "Source-observed event location" }] : []), ...located.map((location) => ({ id: location.id, latitude: location.latitude!, longitude: location.longitude!, title: location.canonical_name, subtitle: location.relationship }))];
  const country = detail.event.primary_country_iso2;
  return <figure className="event-location-map">
        <figcaption><strong><CountryFlag country={detail.event.primary_country_iso2} />Geographic context</strong><span>{center ? detail.event.location_name || "Event area" : "Location not resolved · world overview"}</span></figcaption>
        <div className="event-location-canvas"><WorldMapBubbles data={country ? [{ country, count: 1 }] : []} points={points}
          primaryCountry={country} focusOnActivity legend={false} showBubbles={false} showLabels
          fillMode="relevance" /></div>
        <p>{primary?.basis === "estimated_mapped" ? "Estimated geography; pin is not a verified incident position." : primary ? "Source-observed geography." : located.length ? "Linked places; no precise incident position is available." : "No coordinates available; no incident pin is inferred."} {!primary && !located.length && country && " Country reference geography; no incident pin is inferred."} Map: Natural Earth.</p>
      </figure>;
});

export default function EventVisualContext({ detail, onSelectFamily, showLocationMap = true }: { detail: IntelligenceEventDetail; onSelectFamily?: (family: string) => void; showLocationMap?: boolean }) {
  const records = detail.evidence.filter((item) => !isCoverageAssessment(item));
  const groups = [...new Set(records.map(evidenceFamily))].map((domain) => ({
    domain, items: records.filter((item) => evidenceFamily(item) === domain),
  })).slice(0, 8);
  const photos = records.filter((item) => item.domain === "news" && /^https:\/\//i.test(item.image_url ?? ""))
    .filter((item, index, items) => items.findIndex((other) => other.image_url === item.image_url) === index).slice(0, 4);

  return <section className="event-visual-context" aria-label="Event visual context">
    <div className="event-visual-grid">
      {showLocationMap && <EventLocationMap detail={detail} />}
      <figure className="event-correlation-graphic">
        <figcaption><strong>Evidence connections</strong><span>{records.length} records · {groups.length} source types</span></figcaption>
        {groups.length ? <svg viewBox="0 0 440 300" role={onSelectFamily ? "group" : "img"} aria-label="Correlation network between this event and its evidence sources">
          {groups.map((group, index) => {
            const angle = index * 2 * Math.PI / groups.length - Math.PI / 2;
            const x = 220 + 145 * Math.cos(angle); const y = 150 + 105 * Math.sin(angle);
            const context = group.items.every((item) => ["context", "derived", "model_interpretation"].includes(item.relationship));
            return <g key={group.domain} role={onSelectFamily ? "button" : undefined} tabIndex={onSelectFamily ? 0 : undefined} aria-label={onSelectFamily ? `Read ${sourceFamilyLabel(group.domain)} connections` : undefined} onClick={() => onSelectFamily?.(group.domain)} onKeyDown={(event) => {
              if (onSelectFamily && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectFamily(group.domain); }
            }} style={onSelectFamily ? { cursor: "pointer" } : undefined}><title>{sourceFamilyLabel(group.domain)}: {group.items.length} records; {context ? "context only" : "linked evidence"}</title>
              <line x1="220" y1="150" x2={x} y2={y} stroke="var(--shell-accent)" strokeWidth="2" strokeDasharray={context ? "5 5" : undefined} opacity="0.65" />
              <circle cx={x} cy={y} r="23" fill="var(--shell-sidebar)" stroke="var(--shell-accent)" />
              <text x={x} y={y + 5} textAnchor="middle" fill="var(--shell-ink)" fontSize="15">{group.items.length}</text>
              <text x={x} y={y + 39} textAnchor="middle" fill="var(--shell-muted)" fontSize="11">{sourceFamilyLabel(group.domain)}</text>
            </g>;
          })}
          <circle cx="220" cy="150" r="36" fill="var(--shell-sidebar)" stroke="var(--shell-accent)" strokeWidth="2" />
          <text x="220" y="154" textAnchor="middle" fill="var(--shell-ink)" fontSize="12">Event</text>
        </svg> : <p>No linked evidence is available yet.</p>}
        <p>Solid: linked records · Dashed: context only. Connections show association, not causation. Inspect matching factors below.</p>
      </figure>
    </div>
    {detail.news_images?.length ? <NewsImageCards images={detail.news_images} /> : null}
    {!detail.news_images?.length && photos.length > 0 && <div className="event-news-images" aria-label="Images from linked reporting">{photos.map((item) => <figure key={item.id}>
      <SatelliteImage sources={[item.image_url]} alt={item.source_title || item.title || "Image supplied with linked reporting"} className="event-news-image" />
      <figcaption>{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">{item.source_name || "Publisher image"}</a> : item.source_name || "Publisher image"}<span>Publisher-supplied illustration · not independent confirmation</span></figcaption>
    </figure>)}</div>}
  </section>;
}
