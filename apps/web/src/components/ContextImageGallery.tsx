import type { ContextImage } from "../lib/api";
import SatelliteImage from "./SatelliteImage";

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

export default function ContextImageGallery({ images, onOpenEvent }: {
  images: ContextImage[];
  onOpenEvent?: (eventId: string) => void;
}) {
  if (!images.length) return null;
  return <section className="context-image-gallery" aria-label="Reused location imagery">
    <h3>More views of this location</h3>
    <p>Retained images from other investigations provide geographic context. Their dates and original sources are shown below.</p>
    <div className="context-image-grid">{images.map((image) => <figure key={image.id} className="context-image-card">
      <a href={image.preview_url} target="_blank" rel="noreferrer" aria-label={`View retained image: ${image.title}`}>
        <div className="context-image-frame" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
          <SatelliteImage sources={[image.thumbnail_url, image.preview_url]} alt={image.title} className="h-full w-full object-contain" />
        </div>
      </a>
      <figcaption>
        <span className="context-image-label">{image.kind === "satellite" ? "Stored satellite context" : "Earlier reporting image"}</span>
        <strong>{image.title}</strong>
        {image.location_name && <span>{image.location_name}</span>}
        <span>{image.match_reason === "rendered_area_contains_location" ? "Retained scene covers this location" : "Reporting about the same named location"}</span>
        <span>{image.captured_at ? <>Captured <time dateTime={image.captured_at}>{timestamp(image.captured_at)}</time></> : "Capture time and image location unverified"}</span>
        {image.published_at && <span>{image.kind === "news" ? "Article published" : "Scene published"} <time dateTime={image.published_at}>{timestamp(image.published_at)}</time></span>}
        {!image.captured_at && image.collected_at && <span>Retained <time dateTime={image.collected_at}>{timestamp(image.collected_at)}</time></span>}
        <span>{image.source_url ? <a href={image.source_url} target="_blank" rel="noreferrer">{image.attribution}</a> : image.attribution} · {image.license}</span>
        {image.source_event_id && onOpenEvent && <button type="button" onClick={() => onOpenEvent(image.source_event_id!)}>Original investigation{image.source_event_title ? `: ${image.source_event_title}` : ""}</button>}
        <p>{image.notice}</p>
      </figcaption>
    </figure>)}</div>
  </section>;
}
