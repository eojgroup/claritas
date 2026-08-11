import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Cloud, RefreshCw, Satellite } from "lucide-react";
import {
  fetchEventGibsContext,
  fetchIntelligenceEvent,
  fetchIntelligenceEvents,
  type IntelligenceEvent,
} from "../lib/api";
import SatelliteImage from "./SatelliteImage";
import { earthObservationProductLabel, selectOverviewObservation } from "./earthObservationPresentation";

type Props = {
  country?: string | null;
  compact?: boolean;
  onOpenEvent: (eventId: string) => void;
  onOpenImagery: (eventId: string) => void;
};

type SatelliteSlide = {
  id: string;
  event: IntelligenceEvent;
  sources: string[];
  capturedAt: string;
  sourceLabel: string;
  observationKind: "processed_observation" | "browse_context";
  notice: string;
  attribution: string;
};

function eventRank(event: IntelligenceEvent) {
  return (event.earth_observation_available ? 2 : 0)
    + ({ critical: 4, high: 3, medium: 2, low: 1 }[event.severity] ?? 0)
    + Number(event.relevance_score ?? 0);
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

export default function SatelliteContextPanel({
  country,
  compact = false,
  onOpenEvent,
  onOpenImagery,
}: Props) {
  const [slides, setSlides] = useState<SatelliteSlide[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const events = await fetchIntelligenceEvents({
        limit: 12,
        country: country?.toUpperCase() || undefined,
      });
      const candidates = [...events]
        .sort((left, right) => eventRank(right) - eventRank(left))
        .slice(0, 8);
      const rows = await Promise.all(candidates.map(async (event): Promise<SatelliteSlide | null> => {
        const [detailResult, gibsResult] = await Promise.allSettled([
          event.earth_observation_available ? fetchIntelligenceEvent(event.id) : Promise.resolve(null),
          fetchEventGibsContext(event.id),
        ]);
        const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
        const gibs = gibsResult.status === "fulfilled" ? gibsResult.value : null;
        const gibsLayer = gibs?.layers.find((layer) => layer.category === "true_color" && layer.preview_url);
        const observation = selectOverviewObservation(
          detail?.earth_observations ?? [],
          Boolean(gibsLayer),
        );
        const asset = observation?.assets.find((item) => item.asset_type === "preview")
          ?? observation?.assets[0];
        const sources = [asset?.url, gibsLayer?.preview_url].filter((value): value is string => Boolean(value));
        if (!sources.length) return null;
        if (asset && observation) {
          return {
            id: `observation-${observation.id}`,
            event,
            sources,
            capturedAt: observation.capture_start,
            sourceLabel: `${observation.mission} · ${earthObservationProductLabel(observation.product_type)}`,
            observationKind: "processed_observation",
            notice: observation.analysis_summary
              || "A processed, event-scoped observation. Sensor, cloud and acquisition differences still limit comparison.",
            attribution: observation.attribution || "Contains modified Copernicus Sentinel data.",
          };
        }
        return {
          id: `gibs-${event.id}`,
          event,
          sources,
          capturedAt: gibsLayer?.date ?? event.start_time,
          sourceLabel: gibs?.context_scope === "location" ? "NASA GIBS · linked location" : "NASA GIBS · event context",
          observationKind: "browse_context",
          notice: gibs?.notice || "Browse context is not proof of event change or causation.",
          attribution: gibsLayer?.provenance.attribution || "NASA EOSDIS GIBS",
        };
      }));
      setSlides(rows.filter((row): row is SatelliteSlide => Boolean(row)));
      setSelected(0);
    } catch (reason) {
      setSlides([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const current = slides[Math.min(selected, Math.max(0, slides.length - 1))] ?? null;
  const heading = country ? `Satellite context · ${country.toUpperCase()}` : "Satellite context · priority events";
  const imageHeight = compact ? "h-48" : "h-[clamp(18rem,42vh,28rem)]";
  const thumbnails = useMemo(() => slides.slice(0, 5), [slides]);

  return (
    <section className="flex min-h-0 flex-col" aria-label={heading}>
      <div className="flex items-start justify-between gap-3 border-b border-[color:var(--shell-border)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-[color:var(--shell-muted)]">
            <Satellite className="h-3.5 w-3.5" /> Earth observation
          </div>
          <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">{heading}</div>
          <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">
            Processed observations take priority; NASA browse imagery provides clearly labelled context while scenes are queued.
          </p>
        </div>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh satellite context" className="rounded-full border border-[color:var(--shell-border)] p-2 text-[color:var(--shell-muted)]">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !current && (
        <div className={`${imageHeight} flex items-center justify-center text-xs text-[color:var(--shell-muted)]`}>
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading event imagery
        </div>
      )}
      {!loading && error && (
        <div role="alert" className={`${imageHeight} flex items-center justify-center p-5 text-center text-xs text-rose-600`}>
          Satellite context could not load: {error}
        </div>
      )}
      {!loading && !error && !current && (
        <div className={`${imageHeight} flex items-center justify-center p-6 text-center text-xs leading-5 text-[color:var(--shell-muted)]`}>
          No defensible event or linked-location imagery is available in this scope yet. The Signal Desk remains available without substituting a country-centroid image.
        </div>
      )}
      {current && (
        <>
          <div className={`${imageHeight} relative overflow-hidden bg-slate-950`}>
            <SatelliteImage
              sources={current.sources}
              alt={`${current.sourceLabel} for ${current.event.title}`}
              className="h-full w-full object-cover"
              fallbackClassName="flex h-full w-full items-center justify-center bg-slate-950"
              loading="eager"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/75 to-transparent p-4 pt-12 text-white">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/70">
                <span className="rounded-full border border-white/30 bg-black/30 px-2 py-1">
                  {current.observationKind === "processed_observation" ? "Processed observation" : "Browse context · not proof"}
                </span>
                <span>{current.sourceLabel}</span>
                <span>{formatDate(current.capturedAt)}</span>
              </div>
              <div className="mt-2 line-clamp-2 text-base font-semibold">{current.event.title}</div>
              <div className="mt-1 text-xs text-white/75">{current.event.location_name || current.event.primary_country_iso2 || "Event geography"}</div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <p className="text-xs leading-5 text-[color:var(--shell-muted)]">{current.notice}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] text-[color:var(--shell-muted)]">
              <span>{current.attribution}</span>
              {current.observationKind === "processed_observation" && <span className="inline-flex items-center gap-1"><Cloud className="h-3 w-3" />Sensor-derived evidence</span>}
            </div>
            {thumbnails.length > 1 && (
              <div className="grid grid-cols-5 gap-2" aria-label="Available satellite contexts">
                {thumbnails.map((slide, index) => (
                  <button key={slide.id} type="button" onClick={() => setSelected(index)} aria-label={`Show imagery for ${slide.event.title}`} className={`aspect-video overflow-hidden rounded-md border ${selected === index ? "border-[color:var(--shell-ink)] ring-1 ring-[color:var(--shell-ink)]" : "border-[color:var(--shell-border)]"}`}>
                    <SatelliteImage sources={slide.sources} alt="" className="h-full w-full object-cover" fallbackClassName="h-full w-full bg-slate-800" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onOpenEvent(current.event.id)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">
                Open evidence thread <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onOpenImagery(current.event.id)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">
                Inspect imagery <Satellite className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
