import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Cloud, Images, MapPin, Maximize2, RefreshCw, Satellite, ScanSearch } from "lucide-react";
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
  onContextEventChange?: (eventId: string | null) => void;
};

type SatelliteSlide = {
  id: string;
  event: IntelligenceEvent;
  sources: string[];
  capturedAt: string;
  capturedAtPrecision: "instant" | "date";
  processedAt?: string | null;
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
  linkedNews: Array<{
    id: string;
    title: string;
    url?: string | null;
    publisher?: string | null;
    publishedAt?: string | null;
  }>;
  whyInteresting?: string | null;
  eventStartTime?: string | null;
  evidenceRole?: "visual_context" | "sensor_derived_signal" | "regional_browse_context";
  visualClass?: "natural" | "enhanced" | "analytical" | "radar" | "browse";
  naturalColor?: boolean;
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

function observationAlignment(
  capturedAt: string,
  eventStartTime?: string | null,
  capturedAtPrecision: SatelliteSlide["capturedAtPrecision"] = "instant",
) {
  if (!eventStartTime) return "Event start time is unresolved, so acquisition alignment cannot yet be assessed.";
  const captured = Date.parse(capturedAt);
  const started = Date.parse(eventStartTime);
  if (Number.isNaN(captured) || Number.isNaN(started)) {
    return "Acquisition timing could not be aligned with the event timeline.";
  }
  if (capturedAtPrecision === "date") {
    const capturedDay = capturedAt.slice(0, 10);
    const eventDay = new Date(started).toISOString().slice(0, 10);
    if (capturedDay === eventDay) {
      return "The browse layer and event share the same UTC day, but the provider supplies no exact capture time; their order within that day cannot be established.";
    }
    return capturedDay > eventDay
      ? "The browse layer is dated after the event's UTC start day. Its exact acquisition time is unavailable, so it is day-level post-event context only."
      : "The browse layer is dated before the event's UTC start day. Its exact acquisition time is unavailable, so it is day-level baseline context only.";
  }
  const minutes = Math.round(Math.abs(captured - started) / 60_000);
  const interval = minutes < 60
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : minutes < 2_880
      ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"}`
      : `${Math.round(minutes / 1_440)} day${Math.round(minutes / 1_440) === 1 ? "" : "s"}`;
  return captured >= started
    ? `Acquired ${interval} after the recorded event start; this is post-start context, not proof of impact or cause.`
    : `Acquired ${interval} before the recorded event start; use it only as possible baseline context.`;
}

function imageConclusion(slide: SatelliteSlide) {
  if (slide.observationKind === "browse_context") {
    return "This regional browse image locates the wider setting. Its scale cannot establish event conditions, damage, or cause.";
  }
  if (slide.modelInterpretation) {
    return "A model has interpreted this scene, but its findings remain hypotheses for human review—not an independent observation or impact confirmation.";
  }
  if (slide.evidenceRole === "sensor_derived_signal" || slide.visualClass === "analytical") {
    return "This derived sensor product can highlight spectral conditions at the mapped area. It does not directly show flames, damage, impact, or causation.";
  }
  if (slide.naturalColor) {
    return "This natural-colour scene shows visible surface conditions at the mapped area. Seeing fields, forest, water, or buildings does not confirm or disprove the reported event; no visual impact conclusion is available without interpreted change evidence.";
  }
  return "This event-aligned scene supplies visual context only. No visible impact conclusion has been established from the image.";
}

function eventRank(event: IntelligenceEvent) {
  return (event.earth_observation_available ? 2 : 0)
    + ({ critical: 4, high: 3, medium: 2, low: 1 }[event.severity] ?? 0)
    + Number(event.relevance_score ?? 0);
}

function formatExactTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(parsed));
}

function friendlyContextError() {
  return "Satellite context is temporarily unavailable. Retry shortly.";
}

function observationAttributionFallback(
  provider?: string | null,
  mission?: string | null,
) {
  const sourceIdentity = [provider, mission]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return sourceIdentity.length > 0
    ? `Source: ${sourceIdentity.join(" · ")}. Formal attribution was not supplied in this observation record.`
    : "Formal source attribution was not supplied in this observation record.";
}

const MAX_PROCESSED_EVENT_DETAILS = 3;
const MAX_BROWSE_CONTEXTS = 2;
const MAX_CONTEXT_CANDIDATES = 6;

export default function SatelliteContextPanel({
  country,
  compact = false,
  onOpenEvent,
  onOpenImagery,
  onContextEventChange,
}: Props) {
  const [slides, setSlides] = useState<SatelliteSlide[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestedScope = country?.toUpperCase() || "Global";

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const events = await fetchIntelligenceEvents({
        limit: 10,
        country: country?.toUpperCase() || undefined,
      });
      if (requestId.current !== currentRequest) return;
      const candidates = [...events]
        .sort((left, right) => eventRank(right) - eventRank(left))
        .slice(0, MAX_CONTEXT_CANDIDATES);

      // The event list already carries the governed imagery-availability state.
      // Hydrate only a few eligible events, rather than requesting detail and
      // GIBS for every card (the former implementation could issue 17 calls).
      const processedCandidates = candidates
        .filter((event) => event.earth_observation_available)
        .slice(0, MAX_PROCESSED_EVENT_DETAILS);
      const detailResults = await Promise.allSettled(
        processedCandidates.map((event) => fetchIntelligenceEvent(event.id)),
      );
      if (requestId.current !== currentRequest) return;
      const detailByEventId = new Map(detailResults.flatMap((result, index) => (
        result.status === "fulfilled" && processedCandidates[index]
          ? [[processedCandidates[index].id, result.value] as const]
          : []
      )));
      const processedSlides = detailResults.flatMap((result, index): SatelliteSlide[] => {
        if (result.status !== "fulfilled") return [];
        const event = processedCandidates[index];
        if (!event) return [];
        const detail = result.value;
        const observation = selectOverviewObservation(detail.earth_observations ?? [], false);
        const asset = observation?.imagery?.preferred_asset
          ?? observation?.assets.find((item) => item.asset_type === "preview")
          ?? observation?.assets[0];
        if (!asset || !observation) return [];
        return [{
          id: `observation-${observation.id}`,
          event,
          // Do not silently replace event-linked evidence with a regional browse
          // layer while retaining the stronger processed-observation label.
          sources: [asset.url],
          capturedAt: observation.capture_start,
          capturedAtPrecision: "instant",
          processedAt: asset.generated_at,
          sourceLabel: `${observation.mission} · ${earthObservationProductLabel(observation.product_type)}`,
          observationKind: "processed_observation",
          notice: observation.analysis_summary_role !== "model_interpretation" && observation.analysis_summary
            ? observation.analysis_summary
            : "A processed, event-scoped observation. Sensor, cloud and acquisition differences still limit comparison.",
          attribution: observation.attribution?.trim()
            || observationAttributionFallback(observation.provider, observation.mission),
          imageWidth: asset.width,
          imageHeight: asset.height,
          resolutionM: observation.imagery?.native_resolution_m ?? observation.resolution_m,
          cloudCover: observation.cloud_cover,
          effectiveResolutionM: observation.imagery?.effective_pixel_size_m,
          qualityTier: observation.imagery?.quality_tier,
          interpretation: observation.imagery?.interpretation,
          displayGuidance: observation.imagery?.display_guidance,
          linkedNewsCount: detail.understanding?.linked_news_count
            ?? observation.event_context?.news?.count
            ?? detail.linked_news?.length,
          linkedNews: (detail.linked_news ?? []).slice(0, 3).map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            publisher: item.publisher,
            publishedAt: item.published_at,
          })),
          whyInteresting: detail.understanding?.why_interesting ?? null,
          eventStartTime: detail.event.start_time,
          evidenceRole: observation.imagery?.evidence_role,
          visualClass: observation.imagery?.visual_class,
          naturalColor: observation.imagery?.natural_color,
          linkageLimitation: observation.event_context?.linkage?.limitation,
          modelInterpretation: observation.model_interpretation,
        }];
      });

      const processedEventIds = new Set(processedSlides.map((slide) => slide.event.id));
      // Browse layers are a fallback, not an additional fan-out once enough
      // event-linked processed observations are already available.
      const browseSlots = Math.max(0, MAX_BROWSE_CONTEXTS - processedSlides.length);
      const browseCandidates = candidates
        .filter((event) => !processedEventIds.has(event.id))
        .slice(0, browseSlots);
      const browseResults = await Promise.allSettled(
        browseCandidates.map(async (event) => {
          const knownDetail = detailByEventId.get(event.id);
          const [gibsResult, detailResult] = await Promise.allSettled([
            fetchEventGibsContext(event.id),
            knownDetail ? Promise.resolve(knownDetail) : fetchIntelligenceEvent(event.id),
          ]);
          if (gibsResult.status === "rejected") throw gibsResult.reason;
          return {
            gibs: gibsResult.value,
            detail: detailResult.status === "fulfilled" ? detailResult.value : null,
          };
        }),
      );
      const browseSlides = browseResults.flatMap((result, index): SatelliteSlide[] => {
        if (result.status !== "fulfilled" || !result.value.gibs) return [];
        const event = browseCandidates[index];
        if (!event) return [];
        const { gibs, detail } = result.value;
        const gibsLayer = gibs.layers.find((layer) => layer.category === "true_color" && layer.preview_url);
        if (!gibsLayer) return [];
        return [{
          id: `gibs-${event.id}`,
          event,
          sources: [gibsLayer.preview_url],
          capturedAt: gibsLayer.date,
          capturedAtPrecision: "date",
          sourceLabel: gibs?.context_scope === "location" ? "NASA GIBS · linked location" : "NASA GIBS · event context",
          observationKind: "browse_context",
          notice: gibs?.notice || "Browse context is not proof of event change or causation.",
          attribution: gibsLayer.provenance.attribution || "NASA EOSDIS GIBS",
          resolutionM: gibsLayer.native_resolution_m,
          qualityTier: gibsLayer.quality_tier,
          interpretation: "Regional browse imagery for geographic and environmental context, not detailed event verification.",
          displayGuidance: gibsLayer.display_guidance,
          linkedNewsCount: detail?.understanding?.linked_news_count ?? detail?.linked_news?.length ?? null,
          linkedNews: (detail?.linked_news ?? []).slice(0, 3).map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            publisher: item.publisher,
            publishedAt: item.published_at,
          })),
          whyInteresting: detail?.understanding?.why_interesting ?? null,
          eventStartTime: detail?.event.start_time ?? event.start_time,
          evidenceRole: "regional_browse_context",
          visualClass: "browse",
          naturalColor: true,
        }];
      });
      const rows = [...processedSlides, ...browseSlides]
        .sort((left, right) => {
          if (left.observationKind !== right.observationKind) {
            return left.observationKind === "processed_observation" ? -1 : 1;
          }
          return eventRank(right.event) - eventRank(left.event);
        });
      const rejectedChildren = [...detailResults, ...browseResults]
        .filter((result) => result.status === "rejected").length;
      if (rows.length === 0 && rejectedChildren > 0) {
        // A failed provider/detail request means an empty result is not evidence
        // that this scope has no imagery. Preserve the prior complete view and
        // present a retryable operational state instead.
        throw new Error("Satellite child request failed.");
      }
      if (requestId.current !== currentRequest) return;
      setSlides(rows);
      setSelected(0);
      setLoadedScope(country?.toUpperCase() || "Global");
      setLoadedAt(new Date().toISOString());
    } catch {
      if (requestId.current !== currentRequest) return;
      // Keep the last complete view in place. A reverse-proxy body or provider
      // exception is operational detail and must never become page content.
      setError(friendlyContextError());
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [country]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const current = slides[Math.min(selected, Math.max(0, slides.length - 1))] ?? null;
  const currentEvent = current ? presentEvent(current.event) : null;
  const heading = country ? `Satellite context · ${country.toUpperCase()}` : "Satellite context · priority events";
  const imageHeight = compact ? "min-h-32" : "min-h-[20rem]";
  const thumbnails = useMemo(() => slides.slice(0, 5), [slides]);
  const stale = Boolean(current && (error || (loadedScope && loadedScope !== requestedScope)));

  useEffect(() => {
    onContextEventChange?.(current?.event.id ?? null);
    return () => onContextEventChange?.(null);
  }, [current?.event.id, onContextEventChange]);

  const selectPrevious = () => {
    setSelected((value) => (value <= 0 ? slides.length - 1 : value - 1));
  };
  const selectNext = () => {
    setSelected((value) => (value + 1) % slides.length);
  };
  const processedCount = slides.filter((slide) => slide.observationKind === "processed_observation").length;
  const selectionReason = current?.observationKind === "processed_observation"
    ? `Shown because it is one of ${processedCount} event-linked processed ${processedCount === 1 ? "scene" : "scenes"} in this scope. The initial scene is ranked by event severity and relevance.`
    : "Shown as regional browse context because no higher-ranked processed scene fills this position. It is location context, not event confirmation.";
  const mapLinkExplanation = currentEvent?.coordinateLabel
    ? "The outlined event marker on the map refers to this image."
    : "No defensible point marker is available; the image remains scoped to the event's trusted linked geography.";

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
        <button type="button" onClick={() => void load()} aria-label="Refresh satellite context" className="rounded-full border border-[color:var(--shell-border)] p-2 text-[color:var(--shell-muted)]">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {current && (loading || stale) && (
        <div role={error ? "alert" : "status"} className="flex items-center justify-between gap-3 border-b border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-4 py-2 text-[10px] leading-4 text-[color:var(--shell-muted)]">
          <span>
            {loading
              ? `Updating ${requestedScope} satellite context; the last complete view remains visible.`
              : `${error} Showing the last successful ${loadedScope || "available"} context${loadedAt ? ` loaded ${formatExactTimestamp(loadedAt)}` : ""}.`}
          </span>
          {!loading && <button type="button" onClick={() => void load()} className="shrink-0 rounded-full border border-[color:var(--shell-border)] px-2 py-1 font-semibold text-[color:var(--shell-ink)]">Retry</button>}
        </div>
      )}

      {loading && !current && (
        <div className={`${imageHeight} flex items-center justify-center text-xs text-[color:var(--shell-muted)]`}>
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading event imagery
        </div>
      )}
      {!loading && error && !current && (
        <div role="alert" className={`${imageHeight} flex flex-col items-center justify-center gap-3 p-5 text-center text-xs text-[color:var(--shell-muted)]`}>
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 font-semibold text-[color:var(--shell-ink)]">Retry satellite context</button>
        </div>
      )}
      {!loading && !error && !current && (
        <div className={`${imageHeight} flex items-center justify-center p-6 text-center text-xs leading-5 text-[color:var(--shell-muted)]`}>
          No defensible event or linked-location imagery is available in this scope yet. The event investigation remains available without substituting a country-centroid image.
        </div>
      )}
      {current && (
        <div className={`${imageHeight} grid min-h-0 gap-0 ${compact ? "grid-cols-1" : "sm:grid-cols-[minmax(15rem,0.9fr)_minmax(17rem,1.1fr)]"}`}>
          <div className={`satellite-image-stage relative flex items-center justify-center overflow-hidden border-b border-[color:var(--shell-border)] ${compact ? "aspect-[16/9] min-h-52 p-2" : "min-h-56 p-3 sm:border-b-0 sm:border-r"}`}>
            <button
              type="button"
              onClick={() => onOpenImagery(current.event.id)}
              className="group/image flex h-full w-full items-center justify-center overflow-hidden rounded-lg"
              aria-label={`Open full imagery assessment for ${currentEvent?.headline || current.event.title}`}
            >
              <SatelliteImage
                sources={current.sources}
                alt={`${current.sourceLabel} for ${currentEvent?.headline || current.event.title}`}
                className={`${compact ? "h-full max-h-[20rem]" : "max-h-[24rem]"} w-full rounded-lg object-contain transition-transform duration-200 group-hover/image:scale-[1.015]`}
                fallbackClassName={`flex h-full w-full items-center justify-center rounded-lg bg-[color:var(--shell-sidebar)] ${compact ? "min-h-52" : "min-h-56"}`}
                loading="eager"
              />
            </button>
            <div className={`pointer-events-none absolute rounded-full border border-white/20 bg-[rgba(5,18,23,0.84)] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-stone-100 backdrop-blur-md ${compact ? "left-3 top-3" : "left-5 top-5"}`}>
              Map highlight · {selected + 1} of {slides.length} · {current.observationKind === "processed_observation" ? "event-linked" : "browse context"}
            </div>
            <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/20 bg-[rgba(5,18,23,0.84)] px-2 py-1 text-[8px] font-semibold text-stone-100 backdrop-blur-md">
              <Maximize2 className="h-3 w-3" /> Open assessment
            </div>
            {slides.length > 1 && (
              <div className="absolute bottom-3 right-3 flex items-center overflow-hidden rounded-full border border-white/20 bg-[rgba(5,18,23,0.88)] text-stone-100 shadow-lg backdrop-blur-md">
                <button type="button" onClick={selectPrevious} className="p-2 hover:bg-white/10" aria-label="Show previous satellite context"><ChevronLeft className="h-4 w-4" /></button>
                <span className="min-w-12 text-center text-[10px] font-semibold">{selected + 1}/{slides.length}</span>
                <button type="button" onClick={selectNext} className="p-2 hover:bg-white/10" aria-label="Show next satellite context"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
          {compact && slides.length > 1 && (
            <div className="satellite-context-picker app-scroll-panel flex gap-2 overflow-x-auto border-b border-[color:var(--shell-border)] p-2" aria-label="Available map-linked satellite contexts">
              {thumbnails.map((slide, index) => {
                const slideEvent = presentEvent(slide.event);
                return (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => setSelected(index)}
                    aria-label={`Show imagery for ${slideEvent.headline}`}
                    className={`grid w-36 shrink-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 rounded-lg border p-1.5 text-left ${selected === index ? "border-[color:var(--shell-accent)] bg-[color:var(--signal-sky-soft)]" : "border-[color:var(--shell-border)] bg-[color:var(--shell-bg)]"}`}
                  >
                    <SatelliteImage sources={slide.sources} alt="" className="h-10 w-12 rounded object-cover" fallbackClassName="h-10 w-12 rounded bg-[color:var(--shell-sidebar)]" />
                    <span className="min-w-0">
                      <strong className="line-clamp-2 block text-[9px] leading-3 text-[color:var(--shell-ink)]">{slideEvent.headline}</strong>
                      <small className="mt-0.5 block text-[8px] uppercase tracking-wide text-[color:var(--shell-muted)]">{slide.observationKind === "processed_observation" ? "Processed" : "Browse"}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className={`app-scroll-panel flex min-w-0 flex-col ${compact ? "max-h-[24rem] overflow-y-auto p-3" : "p-4 sm:p-5"}`}>
            <div className="mb-2 rounded-lg border border-[color:var(--shell-accent-2)]/35 bg-[color:var(--signal-sky-soft)] p-2.5">
              <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-accent-2)]"><Images className="h-3.5 w-3.5" />Why this scene is shown</div>
              <p className="mt-1 text-[10px] leading-4 text-[color:var(--shell-ink)]">{selectionReason} {mapLinkExplanation}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">
              <span className={current.observationKind === "processed_observation" ? "text-[color:var(--signal-emerald)]" : "text-[color:var(--signal-amber)]"}>
                {current.modelInterpretation
                  ? "Model interpretation available · review required"
                  : current.observationKind === "processed_observation"
                    ? "Event-aligned imagery · impact not established"
                    : "Context only · not proof"}
              </span>
            </div>
            <div className="mt-1 space-y-0.5 text-[9px] leading-4 text-[color:var(--shell-muted)]">
              {current.capturedAtPrecision === "instant" ? (
                <div>Captured <time dateTime={current.capturedAt}>{formatExactTimestamp(current.capturedAt)}</time></div>
              ) : (
                <div>Provider observation day <time dateTime={current.capturedAt}>{current.capturedAt}</time> · exact capture time unavailable</div>
              )}
              {current.processedAt && <div>Processed <time dateTime={current.processedAt}>{formatExactTimestamp(current.processedAt)}</time></div>}
              <div>Event updated <time dateTime={current.event.last_activity_time}>{formatExactTimestamp(current.event.last_activity_time)}</time></div>
            </div>
            <h3 className={`${compact ? "mt-2 text-sm leading-5" : "mt-3 text-lg leading-6"} font-semibold text-[color:var(--shell-ink)]`}>{currentEvent?.headline || current.event.title}</h3>
            {currentEvent?.focus && <p className="mt-1 text-xs text-[color:var(--shell-muted)]">Signal focus · {currentEvent.focus}</p>}
            <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--shell-ink)]"><MapPin className="h-3.5 w-3.5 text-[color:var(--shell-accent-2)]" />{currentEvent?.locationLabel || "Event geography"}</div>
            {currentEvent?.coordinateLabel && <div className="mt-1 pl-5 text-[10px] leading-4 text-[color:var(--shell-muted)]">{currentEvent.locationBasis} · {currentEvent.coordinateLabel}</div>}
            {currentEvent && (
              <div className={`mt-3 grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
                <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-accent)]">What happened</div><p className="mt-1 line-clamp-3 text-[11px] leading-4 text-[color:var(--shell-ink)]">{currentEvent.summary}</p></div>
                <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-accent)]">Why it matters</div><p className="mt-1 line-clamp-3 text-[11px] leading-4 text-[color:var(--shell-ink)]">{current.whyInteresting || `${Math.round(current.event.relevance_score * 100)}% relevance across ${current.event.domain_count} linked ${current.event.domain_count === 1 ? "domain" : "domains"}. Impact has not been independently established.`}</p></div>
              </div>
            )}
            <div className="mt-2 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">Linked reporting</div>
              {current.linkedNews.length ? (
                <div className="mt-1 space-y-1.5">
                  {current.linkedNews.slice(0, compact ? 1 : 3).map((item) => (
                    <div key={item.id} className="text-[10px] leading-4 text-[color:var(--shell-ink)]">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[color:var(--signal-sky)] hover:underline"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="font-semibold">{item.title}</span>
                      )}
                      <span className="text-[color:var(--shell-muted)]"> · {item.publisher || "Publisher unavailable"}{item.publishedAt ? ` · ${formatExactTimestamp(item.publishedAt)}` : " · publication time unavailable"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[10px] leading-4 text-[color:var(--shell-muted)]">
                  {current.linkedNewsCount && current.linkedNewsCount > 0
                    ? `${current.linkedNewsCount} linked publisher ${current.linkedNewsCount === 1 ? "report is" : "reports are"} recorded; open the evidence thread for the publisher details. No impact is inferred from the image alone.`
                    : "No publisher report is explicitly linked to this event yet. The alert is currently sensor- or source-led, so impact remains uncontextualised by reporting."}
                </p>
              )}
            </div>
            <div className="mt-2 rounded-lg border border-[color:var(--signal-amber)]/40 bg-[color:var(--signal-amber-soft)] p-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-accent)]">What this image adds</div>
              <p className="mt-1 text-[10px] leading-4 text-[color:var(--shell-ink)]">{imageConclusion(current)}</p>
              <p className="mt-1 text-[9px] leading-4 text-[color:var(--shell-muted)]">{observationAlignment(current.capturedAt, current.eventStartTime, current.capturedAtPrecision)}</p>
            </div>
            <p className={`${compact ? "mt-2 line-clamp-2 text-[10px] leading-4" : "mt-3 text-xs leading-5"} text-[color:var(--shell-muted)]`}>{current.interpretation || current.notice}</p>
            {current.interpretation && current.notice !== current.interpretation && !compact && <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">{current.notice}</p>}
            {current.linkageLimitation && <p className="mt-2 border-l-2 border-[color:var(--shell-accent)] pl-2 text-[10px] leading-4 text-[color:var(--shell-muted)]">{current.linkageLimitation}</p>}
            {current.modelInterpretation && !compact && (
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
            {!compact && <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-muted)]"><ScanSearch className="h-3.5 w-3.5" />Image context</div>
              <div className="mt-1 text-xs font-semibold text-[color:var(--shell-ink)]">{current.sourceLabel}</div>
              <div className="mt-1 text-[10px] leading-4 text-[color:var(--shell-muted)]">
                {current.observationKind === "processed_observation"
                  ? [current.qualityTier === "high_resolution_processed" ? "High-resolution processed scene" : "Processed scene", current.resolutionM != null ? `${current.resolutionM} m native resolution` : null, current.effectiveResolutionM != null ? `${current.effectiveResolutionM} m effective pixel size` : null, current.imageWidth && current.imageHeight ? `${current.imageWidth}×${current.imageHeight} preview` : null, current.cloudCover != null ? `${Math.round(current.cloudCover)}% cloud` : null].filter(Boolean).join(" · ")
                  : current.displayGuidance || "Regional NASA browse layer shown at a bounded size; inspect imagery for scene-level evidence when available."}
              </div>
            </div>}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] text-[color:var(--shell-muted)]">
              <span>{current.attribution}</span>
              {current.observationKind === "processed_observation" && <span className="inline-flex items-center gap-1"><Cloud className="h-3 w-3" />Sensor-derived evidence</span>}
            </div>
            {thumbnails.length > 1 && !compact && (
              <div className="mt-4 grid grid-cols-5 gap-2" aria-label="Available satellite contexts">
                {thumbnails.map((slide, index) => (
                  <button key={slide.id} type="button" onClick={() => setSelected(index)} aria-label={`Show imagery for ${presentEvent(slide.event).headline}`} className={`aspect-video overflow-hidden rounded-md border bg-[color:var(--shell-sidebar)] ${selected === index ? "border-[color:var(--shell-accent)] ring-1 ring-[color:var(--shell-accent)]" : "border-[color:var(--shell-border)]"}`}>
                    <SatelliteImage sources={slide.sources} alt="" className="h-full w-full object-contain" fallbackClassName="h-full w-full bg-[color:var(--shell-sidebar)]" />
                  </button>
                ))}
              </div>
            )}
            <div className={`mt-auto flex flex-wrap gap-2 ${compact ? "pt-2" : "pt-4"}`}>
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
