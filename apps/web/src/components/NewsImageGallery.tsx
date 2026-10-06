import { useEffect, useState } from "react";
import { fetchNewsImages, type NewsImage } from "../lib/api";
import SatelliteImage from "./SatelliteImage";
import ImageAnalysisSummary from "./ImageAnalysisSummary";

export function NewsImageCards({ images }: { images: NewsImage[] }) {
  const [showBoxes, setShowBoxes] = useState(false);
  if (!images.length) return null;
  return <div className="news-image-library">
    <button type="button" className="news-image-detection-toggle" onClick={() => setShowBoxes(!showBoxes)} aria-pressed={showBoxes}>{showBoxes ? "Hide" : "Show"} detected objects</button>
    <div className="news-image-card-grid">{images.map((image) => <figure className="news-image-card" key={image.id}>
      <div className="news-image-frame" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
        <SatelliteImage sources={[image.preview_url]} alt={image.caption || image.article_title} className="absolute inset-0 h-full w-full object-contain" />
        {showBoxes && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="news-image-boxes" aria-label="Model object detections">{image.analysis?.object_counts?.flatMap((count) => count.status === "estimated" ? count.boxes.map(([x1, y1, x2, y2], index) => <rect key={`${count.object_type}:${count.area}:${index}`} x={x1 * 100} y={y1 * 100} width={(x2 - x1) * 100} height={(y2 - y1) * 100}><title>{count.object_type} · model estimate</title></rect>) : [])}</svg>}
      </div>
      <figcaption><a href={image.article_url} target="_blank" rel="noreferrer">{image.article_title}</a><small>{image.publisher} · {image.license} · <a href={image.image_url} target="_blank" rel="noreferrer">Source image</a></small><small>{image.notice}</small></figcaption>
      {image.analysis_model && <small>Image model: {image.analysis_model}</small>}
      {image.analysis?.summary && <p className="news-image-analysis-text">{image.analysis.summary}</p>}
      <ImageAnalysisSummary analysis={image.analysis} />
      {!image.analysis && <small>{image.analysis_status === "unavailable" ? "Image analysis unavailable after bounded retries." : "Image analysis pending availability and the daily request budget."}</small>}
    </figure>)}</div>
  </div>;
}
export default function NewsImageGallery({ eventId, country }: { eventId?: string | null; country?: string | null }) {
  const [images, setImages] = useState<NewsImage[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setImages([]); setError(null); setLoading(true);
    const debounce = setTimeout(() => {
      void fetchNewsImages({ eventId: eventId || undefined, country: eventId ? undefined : country || undefined, search, limit: 30 })
        .then((result) => { if (!cancelled) setImages(result); })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Image collection unavailable."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(debounce); };
  }, [eventId, country, search, refresh]);
  return <section className="app-card rounded-xl p-4 news-image-gallery" aria-label="News image collection">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">News image collection</h2><button type="button" onClick={() => setRefresh(refresh + 1)}>Refresh images</button></div>
    <p className="mt-1 text-xs text-[color:var(--shell-muted)]">Publisher photos retained for 14 days, with shared analysis for identical images. Capture time and location require verification.</p>
    <label className="my-3 block text-xs">Search image descriptions<input aria-label="Search news images" className="ml-2 rounded border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-1" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} /></label>
    {loading ? <p role="status">Loading images…</p> : error ? <p role="alert">{error}</p> : images.length ? <NewsImageCards images={images} /> : <p>No retained images match this scope yet. Images are collected automatically from recent reporting.</p>}
  </section>;
}
