import { NewsImageCards } from "./NewsImageGallery";
import CountryFlag from "./CountryFlag";
import { useCountryContext } from "./countryContext";
import { countryReferencePoint } from "./countryPresentation";
import { useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-50m.json";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Properties, Topology } from "topojson-specification";
import type { IntelligenceEventDetail } from "../lib/api";
import { evidenceFamily, isCoverageAssessment, sourceFamilyLabel } from "./eventSourcePresentation";
import SatelliteImage from "./SatelliteImage";

const topology = worldAtlas as unknown as Topology<{ countries: GeometryCollection<Properties> }>;
const land = feature(topology, topology.objects.countries) as FeatureCollection<Geometry, Properties>;
const validPoint = (lat: unknown, lon: unknown): lat is number => typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export default function EventVisualContext({ detail, onSelectFamily }: { detail: IntelligenceEventDetail; onSelectFamily?: (family: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const located = detail.locations.filter((location) => validPoint(location.latitude, location.longitude));
  const coordinates = detail.understanding?.coordinates;
  const primary = coordinates && validPoint(coordinates.latitude, coordinates.longitude) ? coordinates : null;
  const countryContext = useCountryContext(detail.event.primary_country_iso2);
  const referencePoint = countryReferencePoint(countryContext);
  const center = primary ?? located[0] ?? (referencePoint ? { longitude: referencePoint[0], latitude: referencePoint[1] } : null);
  const projection = geoMercator().center(center ? [center.longitude!, Math.max(-75, Math.min(75, center.latitude!))] : [0, 15]).scale(95 * zoom).translate([320, 150]);
  const path = geoPath(projection);
  const points = [...(primary ? [{ id: "event", latitude: primary.latitude, longitude: primary.longitude, canonical_name: primary.label, relationship: primary.basis === "estimated_mapped" ? "Estimated event location" : "Source-observed event location" }] : []), ...located];
  const records = detail.evidence.filter((item) => !isCoverageAssessment(item));
  const groups = [...new Set(records.map(evidenceFamily))].map((domain) => ({
    domain, items: records.filter((item) => evidenceFamily(item) === domain),
  })).slice(0, 8);
  const photos = records.filter((item) => item.domain === "news" && /^https:\/\//i.test(item.image_url ?? ""))
    .filter((item, index, items) => items.findIndex((other) => other.image_url === item.image_url) === index).slice(0, 4);

  return <section className="event-visual-context" aria-label="Event visual context">
    <div className="event-visual-grid">
      <figure className="event-location-map">
        <figcaption><strong><CountryFlag country={detail.event.primary_country_iso2} />Geographic context</strong><span>{center ? detail.event.location_name || "Event area" : "Location not resolved · world overview"}</span></figcaption>
        <svg viewBox="0 0 640 300" role="img" aria-label="Map of event and linked locations">
          <rect width="640" height="300" fill="var(--shell-bg)" />
          <g fill="var(--shell-sidebar)" stroke="var(--shell-border)" strokeWidth="0.6">{land.features.map((country, index) => <path key={`${country.id ?? "country"}-${index}`} d={path(country) ?? undefined} />)}</g>
          {points.map((point) => {
            const pixel = projection([point.longitude!, point.latitude!]);
            if (!pixel || pixel[0] < 8 || pixel[0] > 632 || pixel[1] < 8 || pixel[1] > 292) return null;
            return <g key={point.id} transform={`translate(${pixel[0]},${pixel[1]})`}><title>{point.canonical_name} · {point.relationship}</title><circle r="12" fill="var(--shell-accent)" opacity="0.2" /><circle r="4" fill="var(--shell-accent)" stroke="var(--shell-ink)" /></g>;
          })}
        </svg>
        <label className="event-map-zoom">Zoom <input aria-label="Event map zoom" type="range" min="1" max="12" step="0.5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <p>{primary?.basis === "estimated_mapped" ? "Estimated geography; pin is not a verified incident position." : primary ? "Source-observed geography." : located.length ? "Linked places; no precise incident position is available." : "No coordinates available; no incident pin is inferred."} {!primary && !located.length && referencePoint && " View centered on Wikidata’s country reference point."} Map: Natural Earth.</p>
      </figure>
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
