import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Cloud, MapPin, RefreshCw, Satellite, ScanSearch } from "lucide-react";
import {
  fetchEventGibsContext,
  fetchIntelligenceEvent,
  fetchIntelligenceEvents,
  type IntelligenceEvent,
} from "../lib/api";
import SatelliteImage from "./SatelliteImage";
import { earthObservationProductLabel, selectOverviewObservation } from "./earthObservationPresentation";
import { presentEvent } from "./eventPresentation";

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
  imageWidth?: number;
  imageHeight?: number;
  resolutionM?: number | null;
  cloudCover?: number | null;
  effectiveResolutionM?: number | null;
  qualityTier?: "high_resolution_processed" | "standard_processed" | "regional_browse_context";
  interpretation?: string | null;
  displayGuidance?: string | null;
  linkedNewsCount?: number | null;
  linkageLimitation?: string | null;
  modelInterpretation?: {
    summary?: string | null;
    findings?: string[];
    possible_changes?: string[];
    limitations?: string[];
    confidence?: number | null;
    model?: string | null;
    notice: string;
  } | null;
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
        const asset = observation?.imagery?.preferred_asset
          ?? observation?.assets.find((item) => item.asset_type === "preview")
          ?? observation?.assets[0];
        const sources = [asset?.url, gibsLayer?.preview_url].filter((value): value is string => Boolean(value));
        if (!sources.length) return null;
        if (asset && observation) {
          return {
            id: `observation-${observation.id}`,
            event,
            // Do not silently replace event-linked evidence with a regional browse
            // layer while retaining the stronger processed-observation label.
            sources: [asset.url],
            capturedAt: observation.capture_start,
            sourceLabel: `${observation.mission} · ${earthObservationProductLabel(observation.product_type)}`,
            observationKind: "processed_observation",
            notice: observation.analysis_summary_role !== "model_interpretation" && observation.analysis_summary
              ? observation.analysis_summary
              : "A processed, event-scoped observation. Sensor, cloud and acquisition differences still limit comparison.",
            attribution: observation.attribution || "Contains modified Copernicus Sentinel data.",
            imageWidth: asset.width,
            imageHeight: asset.height,
            resolutionM: observation.imagery?.native_resolution_m ?? observation.resolution_m,
            cloudCover: observation.cloud_cover,
            effectiveResolutionM: observation.imagery?.effective_pixel_size_m,
            qualityTier: observation.imagery?.quality_tier,
            interpretation: observation.imagery?.interpretation,
            displayGuidance: observation.imagery?.display_guidance,
            linkedNewsCount: observation.event_context?.news?.count,
            linkageLimitation: observation.event_context?.linkage?.limitation,
            modelInterpretation: observation.model_interpretation,
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
          resolutionM: gibsLayer?.native_resolution_m,
          qualityTier: gibsLayer?.quality_tier,
          interpretation: "Regional browse imagery for geographic and environmental context, not detailed event verification.",
          displayGuidance: gibsLayer?.display_guidance,
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
  const currentEvent = current ? presentEvent(current.event) : null;
  const heading = country ? `Satellite context · ${country.toUpperCase()}` : "Satellite context · priority events";
  const imageHeight = compact ? "min-h-48" : "min-h-[20rem]";
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
            Event-linked observations take priority. Regional NASA browse layers stay bounded and are never presented as event proof.
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
        <div className={`${imageHeight} grid min-h-0 gap-0 sm:grid-cols-[minmax(15rem,0.9fr)_minmax(17rem,1.1fr)]`}>
          <div className="satellite-image-stage relative flex min-h-56 items-center justify-center overflow-hidden border-b border-[color:var(--shell-border)] p-3 sm:border-b-0 sm:border-r">
            <SatelliteImage
              sources={current.sources}
              alt={`${current.sourceLabel} for ${currentEvent?.headline || current.event.title}`}
              className="max-h-[24rem] w-full rounded-lg object-contain"
              fallbackClassName="flex h-full min-h-56 w-full items-center justify-center rounded-lg bg-[color:var(--shell-sidebar)]"
              loading="eager"
            />
            <div className="absolute left-5 top-5 rounded-full border border-white/20 bg-[rgba(5,18,23,0.82)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-100 backdrop-blur-md">
              {current.observationKind === "processed_observation" ? "Event-linked observation" : "Regional browse context"}
            </div>
          </div>
          <div className="flex min-w-0 flex-col p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">
              <span className={current.observationKind === "processed_observation" ? "text-[color:var(--signal-emerald)]" : "text-[color:var(--signal-amber)]"}>
                {current.observationKind === "processed_observation" ? "Satellite assessment available" : "Context only · not proof"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatDate(current.capturedAt)}</span>
            </div>
            <h3 className="mt-3 text-lg font-semibold leading-6 text-[color:var(--shell-ink)]">{currentEvent?.headline || current.event.title}</h3>
            {currentEvent?.focus && <p className="mt-1 text-xs text-[color:var(--shell-muted)]">Signal focus · {currentEvent.focus}</p>}
            <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--shell-ink)]"><MapPin className="h-3.5 w-3.5 text-[color:var(--shell-accent-2)]" />{currentEvent?.locationLabel || "Event geography"}</div>
            {currentEvent && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-accent)]">What happened</div><p className="mt-1 line-clamp-3 text-[11px] leading-4 text-[color:var(--shell-ink)]">{currentEvent.summary}</p></div>
                <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-accent)]">Why it ranks</div><p className="mt-1 text-[11px] leading-4 text-[color:var(--shell-ink)]">{Math.round(current.event.relevance_score * 100)}% relevance · {current.linkedNewsCount == null ? `${current.event.evidence_count} linked evidence` : `${current.linkedNewsCount} linked ${current.linkedNewsCount === 1 ? "report" : "reports"}`}</p></div>
              </div>
            )}
            <p className="mt-3 text-xs leading-5 text-[color:var(--shell-muted)]">{current.interpretation || current.notice}</p>
            {current.interpretation && current.notice !== current.interpretation && <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">{current.notice}</p>}
            {current.linkageLimitation && <p className="mt-2 border-l-2 border-[color:var(--shell-accent)] pl-2 text-[10px] leading-4 text-[color:var(--shell-muted)]">{current.linkageLimitation}</p>}
            {current.modelInterpretation && (
              <div className="mt-3 rounded-lg border border-[color:var(--viz-violet)]/40 bg-[color:var(--shell-bg)] p-3">
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--viz-violet)]">Model interpretation · not a sensor measurement</div>
                {current.modelInterpretation.summary && <p className="mt-1 text-[11px] leading-4 text-[color:var(--shell-ink)]">{current.modelInterpretation.summary}</p>}
                {current.modelInterpretation.findings?.[0] && <p className="mt-1 text-[10px] leading-4 text-[color:var(--shell-muted)]"><span className="font-semibold text-[color:var(--shell-ink)]">Observed feature:</span> {current.modelInterpretation.findings[0]}</p>}
                {current.modelInterpretation.possible_changes?.[0] && <p className="mt-1 text-[10px] leading-4 text-[color:var(--shell-muted)]"><span className="font-semibold text-[color:var(--shell-ink)]">Possible change:</span> {current.modelInterpretation.possible_changes[0]}</p>}
                <p className="mt-1 text-[9px] leading-4 text-[color:var(--shell-muted)]">
                  {[current.modelInterpretation.model, current.modelInterpretation.confidence == null ? null : `${Math.round(current.modelInterpretation.confidence * 100)}% model confidence`].filter(Boolean).join(" · ") || current.modelInterpretation.notice}
                </p>
              </div>
            )}
            <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-muted)]"><ScanSearch className="h-3.5 w-3.5" />Image context</div>
              <div className="mt-1 text-xs font-semibold text-[color:var(--shell-ink)]">{current.sourceLabel}</div>
              <div className="mt-1 text-[10px] leading-4 text-[color:var(--shell-muted)]">
                {current.observationKind === "processed_observation"
                  ? [current.qualityTier === "high_resolution_processed" ? "High-resolution processed scene" : "Processed scene", current.resolutionM != null ? `${current.resolutionM} m native resolution` : null, current.effectiveResolutionM != null ? `${current.effectiveResolutionM} m effective pixel size` : null, current.imageWidth && current.imageHeight ? `${current.imageWidth}×${current.imageHeight} preview` : null, current.cloudCover != null ? `${Math.round(current.cloudCover)}% cloud` : null].filter(Boolean).join(" · ")
                  : current.displayGuidance || "Regional NASA browse layer shown at a bounded size; inspect imagery for scene-level evidence when available."}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] text-[color:var(--shell-muted)]">
              <span>{current.attribution}</span>
              {current.observationKind === "processed_observation" && <span className="inline-flex items-center gap-1"><Cloud className="h-3 w-3" />Sensor-derived evidence</span>}
            </div>
            {thumbnails.length > 1 && (
              <div className="mt-4 grid grid-cols-5 gap-2" aria-label="Available satellite contexts">
                {thumbnails.map((slide, index) => (
                  <button key={slide.id} type="button" onClick={() => setSelected(index)} aria-label={`Show imagery for ${presentEvent(slide.event).headline}`} className={`aspect-video overflow-hidden rounded-md border bg-[color:var(--shell-sidebar)] ${selected === index ? "border-[color:var(--shell-accent)] ring-1 ring-[color:var(--shell-accent)]" : "border-[color:var(--shell-border)]"}`}>
                    <SatelliteImage sources={slide.sources} alt="" className="h-full w-full object-contain" fallbackClassName="h-full w-full bg-[color:var(--shell-sidebar)]" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <button type="button" onClick={() => onOpenEvent(current.event.id)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">
                Open evidence thread <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onOpenImagery(current.event.id)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">
                Inspect imagery <Satellite className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
