import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  ImageOff,
  Link2,
  MapPin,
  RefreshCw,
  Satellite,
  ShieldCheck,
} from "lucide-react";
import {
  fetchEarthObservations,
  fetchIntelligenceEvent,
  requestEarthObservationComparison,
  type EarthObservation,
  type EarthProviderStatus,
  type IntelligenceEventDetail,
} from "../lib/api";
import { findDefensibleComparisonPair, reconcileValidatedComparisonPair } from "./earthObservationComparison";
import SatelliteImage from "./SatelliteImage";
import {
  earthObservationProductLabel,
  isAnalyticalEarthProduct,
  sortEarthObservationsForDisplay,
} from "./earthObservationPresentation";
import {
  earthObservationEvidenceLabel,
  earthObservationQualityLabel,
  earthObservationTimestamp,
  summarizeEarthObservationScope,
} from "./earthObservationWorkspacePresentation";

type Props = {
  eventId?: string | null;
  locationId?: string | null;
  onOpenEvent?: (eventId: string) => void;
};

function preview(observation: EarthObservation | undefined) {
  return observation?.imagery?.preferred_asset
    ?? observation?.assets?.find((asset) => asset.asset_type === "preview")
    ?? observation?.assets?.[0];
}

function text(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function providerStateClass(state: string) {
  if (state === "ready") return "bg-emerald-100 text-emerald-800";
  if (state === "disabled" || state === "not_configured") return "bg-slate-100 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

function observationAlignment(capturedAt: string, eventStartTime?: string | null) {
  if (!eventStartTime) return "Event start time is unresolved; acquisition alignment cannot yet be assessed.";
  const captured = Date.parse(capturedAt);
  const started = Date.parse(eventStartTime);
  if (Number.isNaN(captured) || Number.isNaN(started)) return "Acquisition timing could not be aligned with the event timeline.";
  const minutes = Math.round(Math.abs(captured - started) / 60_000);
  const amount = minutes < 60
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : minutes < 2_880
      ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"}`
      : `${Math.round(minutes / 1_440)} day${Math.round(minutes / 1_440) === 1 ? "" : "s"}`;
  return captured >= started
    ? `Captured ${amount} after the recorded event start · post-start context, not proof of impact.`
    : `Captured ${amount} before the recorded event start · possible baseline context only.`;
}

function sceneConclusion(observation: EarthObservation) {
  if (observation.model_interpretation) {
    return "A model has flagged possible features for human review. Its interpretation is not an independent observation and does not confirm event impact.";
  }
  if (observation.imagery?.evidence_role === "sensor_derived_signal" || isAnalyticalEarthProduct(observation.product_type)) {
    return "This analytical product can highlight sensor-derived conditions or change at the mapped area. It does not directly show flames, damage, impact, or cause.";
  }
  if (observation.imagery?.natural_color) {
    return "This natural-colour scene shows visible surface conditions at the mapped area. A view of fields, vegetation, water, or buildings neither confirms nor disproves the reported event without interpreted change evidence.";
  }
  return "This image is event-aligned visual context. No visible impact conclusion has been established from it.";
}

export default function EarthObservationWorkspace({ eventId, locationId, onOpenEvent }: Props) {
  const scoped = Boolean(eventId || locationId);
  const [observations, setObservations] = useState<EarthObservation[]>([]);
  const [providers, setProviders] = useState<EarthProviderStatus[]>([]);
  const [provider, setProvider] = useState("all");
  const [product, setProduct] = useState("all");
  const [slider, setSlider] = useState(50);
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(scoped);
  const [error, setError] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<IntelligenceEventDetail | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!eventId && !locationId) {
      setObservations([]);
      setProviders([]);
      setEventDetail(null);
      setProviderNotice(null);
      setComparison(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // Never leave assets from a prior event visible under a newly selected
    // scope. Provider readiness is also reloaded so every visible value belongs
    // to the current request.
    setObservations([]);
    setProviders([]);
    setEventDetail(null);
    setProviderNotice(null);
    setComparison(null);
    try {
      const [observationResult, detailResult] = await Promise.allSettled([
        fetchEarthObservations({
          limit: 60,
          eventId: eventId || undefined,
          locationId: eventId ? undefined : locationId || undefined,
        }),
        eventId ? fetchIntelligenceEvent(eventId) : Promise.resolve(null),
      ]);
      if (requestId.current !== currentRequest) return;

      const failures: string[] = [];
      if (observationResult.status === "fulfilled") {
        setObservations(observationResult.value.observations);
        setProviders(observationResult.value.providers);
        setProviderNotice(observationResult.value.provider_notice ?? null);
      } else {
        failures.push(observationResult.reason instanceof Error
          ? observationResult.reason.message
          : "Earth-observation assets could not be loaded.");
      }

      if (detailResult.status === "fulfilled") {
        setEventDetail(detailResult.value);
      } else {
        const observationCarriesContext = observationResult.status === "fulfilled"
          && observationResult.value.observations.some((item) => Boolean(item.event_context));
        if (!observationCarriesContext) {
          failures.push(detailResult.reason instanceof Error
            ? detailResult.reason.message
            : "Event context could not be loaded.");
        }
      }
      setError(failures.length ? failures.join(" ") : null);
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [eventId, locationId]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  useEffect(() => {
    setProvider("all");
    setProduct("all");
    setSlider(50);
  }, [eventId, locationId]);

  const products = useMemo(
    () => [...new Set(observations.map((item) => item.product_type))].sort(),
    [observations],
  );
  const visibleObservations = useMemo(() => sortEarthObservationsForDisplay(
    observations.filter((item) => (
      (provider === "all" || item.provider === provider)
      && (product === "all" || item.product_type === product)
    )),
  ), [observations, product, provider]);
  const readableObservations = useMemo(
    () => visibleObservations.filter((item) => Boolean(preview(item))),
    [visibleObservations],
  );
  const pendingObservations = useMemo(
    () => visibleObservations.filter((item) => !preview(item)),
    [visibleObservations],
  );
  const eventContext = useMemo(
    () => observations.find((item) => item.event_context?.id === eventId)?.event_context
      ?? observations.find((item) => item.event_context)?.event_context
      ?? null,
    [eventId, observations],
  );
  const quality = useMemo(
    () => summarizeEarthObservationScope(visibleObservations),
    [visibleObservations],
  );
  const comparePair = useMemo(
    () => findDefensibleComparisonPair(visibleObservations, eventId),
    [eventId, visibleObservations],
  );

  useEffect(() => {
    if (!comparePair) {
      setComparison(null);
      return;
    }
    let active = true;
    setComparison({ status: "checking" });
    requestEarthObservationComparison(comparePair.after.id)
      .then((value) => { if (active) setComparison(value); })
      .catch((reason) => {
        if (active) setComparison({
          status: "unavailable",
          reason: reason instanceof Error ? reason.message : "Comparison validation failed.",
        });
      });
    return () => { active = false; };
  }, [comparePair]);

  const validatedComparePair = useMemo(
    () => reconcileValidatedComparisonPair(visibleObservations, comparison, eventId),
    [comparison, eventId, visibleObservations],
  );
  const comparisonStatus = String(comparison?.status ?? "idle");

  if (!scoped) {
    return (
      <div className="workspace-page min-w-0">
        <section className="app-card-hero rounded-xl p-6 sm:p-8">
          <div className="mx-auto max-w-4xl text-center">
            <Satellite className="mx-auto h-8 w-8 text-[color:var(--signal-sky)]" />
            <div className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
              Earth observation · event evidence
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
              Choose an event before inspecting satellite imagery
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[color:var(--shell-muted)]">
              An isolated image is rarely actionable. Claritas binds imagery to a named event, mapped place, acquisition time, linked reporting, and a clear evidence role before asking what the pixels add.
            </p>
            <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
              <article className="app-card rounded-xl p-4"><strong className="text-sm text-[color:var(--shell-ink)]">What happened?</strong><p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">Start with the canonical event and linked publisher reporting.</p></article>
              <article className="app-card rounded-xl p-4"><strong className="text-sm text-[color:var(--shell-ink)]">Where and when?</strong><p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">Use mapped geometry and exact acquisition time to judge relevance.</p></article>
              <article className="app-card rounded-xl p-4"><strong className="text-sm text-[color:var(--shell-ink)]">What can imagery support?</strong><p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">Separate physical observation, browse context, and model interpretation.</p></article>
            </div>
            <a href="/" className="mt-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-4 py-2 text-sm font-semibold text-[color:var(--shell-ink)]">
              Open the global event overview <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </section>
      </div>
    );
  }

  const contextTitle = text(
    eventContext?.title ?? eventDetail?.event.title,
    eventId ? "Selected event investigation" : "Location awaiting event linkage",
  );
  const contextLocation = text(
    eventContext?.location?.name
      ?? eventDetail?.understanding?.where
      ?? eventDetail?.event.location_name
      ?? observations[0]?.location_name,
    eventContext?.location?.country_iso2
      ?? eventDetail?.event.primary_country_iso2
      ?? "Location is still being resolved",
  );
  const linkage = eventContext?.linkage;
  const linkedNewsCount = eventContext?.news?.count
    ?? eventDetail?.understanding?.linked_news_count
    ?? eventDetail?.linked_news?.length
    ?? 0;
  const contextSummary = eventContext?.summary
    ?? eventDetail?.understanding?.what_happened
    ?? eventDetail?.event.summary;
  const contextSeverity = eventContext?.severity ?? eventDetail?.event.severity;
  const contextStatus = eventContext?.status ?? eventDetail?.event.status;
  const contextStartTime = eventContext?.start_time ?? eventDetail?.event.start_time;
  const contextCoordinates = eventDetail?.understanding?.coordinates;
  const contextWhy = eventDetail?.understanding?.why_interesting
    ?? "This event is prioritised from its relevance, urgency, materiality, and cross-source evidence. Those scores do not establish real-world impact by themselves.";
  const linkedNews = eventDetail?.linked_news ?? (eventContext?.news?.items ?? []).flatMap((item, index) => {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) return [];
    return [{
      id: typeof item.evidence_id === "string" ? item.evidence_id : `observation-news-${index}`,
      title,
      url: typeof item.url === "string" ? item.url : null,
      publisher: typeof item.source_name === "string" ? item.source_name : null,
      published_at: typeof item.published_at === "string" ? item.published_at : null,
    }];
  });

  return (
    <div className="workspace-page min-w-0 space-y-4">
      <section className="app-card-hero rounded-xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
              {eventId ? "Event evidence workspace" : "Location-scoped candidate imagery"}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">{contextTitle}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{contextLocation}</span>
              {contextSeverity && <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 font-semibold uppercase">{contextSeverity}</span>}
              {contextStatus && <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 capitalize">{contextStatus}</span>}
              <span>{linkedNewsCount} linked news {linkedNewsCount === 1 ? "report" : "reports"}</span>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--shell-muted)]">
              {text(contextSummary, "Imagery is scoped to this mapped investigation. Treat it as physical or regional context, not automatic proof of cause.")}
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh evidence
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Event imagery context">
          <article className="app-card rounded-xl p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">What</div><p className="mt-2 text-sm leading-5 text-[color:var(--shell-ink)]">{text(contextSummary, (eventContext?.event_type ?? eventDetail?.event.event_type) ? `A ${(eventContext?.event_type ?? eventDetail?.event.event_type ?? "event").replace(/_/g, " ")} event under review.` : "Event definition is being resolved from linked evidence.")}</p></article>
          <article className="app-card rounded-xl p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">Where and when</div><p className="mt-2 text-sm leading-5 text-[color:var(--shell-ink)]">{contextLocation}</p>{contextCoordinates && <p className="mt-1 text-xs text-[color:var(--shell-muted)]">{contextCoordinates.label} · {contextCoordinates.basis === "source_observed" ? "source-observed geography" : "estimated mapped geography"}</p>}<p className="mt-1 text-xs text-[color:var(--shell-muted)]">Event start {earthObservationTimestamp(contextStartTime)}</p></article>
          <article className="app-card rounded-xl p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">Why it matters</div><p className="mt-2 text-sm leading-5 text-[color:var(--shell-ink)]">{contextWhy}</p></article>
          <article className="app-card rounded-xl p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">Linked reporting</div>
            {linkedNews.length ? (
              <div className="mt-2 space-y-2">
                {linkedNews.slice(0, 2).map((item) => (
                  <div key={item.id} className="text-xs leading-5 text-[color:var(--shell-ink)]">
                    {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-[color:var(--signal-sky)]">{item.title}</a> : <strong>{item.title}</strong>}
                    <div className="text-[10px] text-[color:var(--shell-muted)]">{item.publisher || "Publisher unavailable"} · {item.published_at ? earthObservationTimestamp(item.published_at) : "publication time unavailable"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">
                {linkedNewsCount > 0
                  ? `${linkedNewsCount} linked publisher ${linkedNewsCount === 1 ? "report is" : "reports are"} recorded; open the event thread for publisher details. No impact is inferred from imagery alone.`
                  : "No publisher report is explicitly linked yet. The event is currently sensor- or source-led, so reported impact is not independently contextualised by news."}
              </p>
            )}
          </article>
        </div>

        <div className="mt-3 rounded-xl border border-[color:var(--signal-amber)]/40 bg-[color:var(--signal-amber-soft)] px-4 py-3 text-xs leading-5 text-[color:var(--shell-ink)]">
          <strong>Imagery assessment boundary.</strong> {text(linkage?.limitation, "The scenes can provide location- and time-aligned physical context. They do not automatically show the reported event, quantify impact, or establish causation.")}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="text-xs text-[color:var(--shell-muted)]">Provider<select value={provider} onChange={(change) => setProvider(change.target.value)} className="ml-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1.5 text-[color:var(--shell-ink)]"><option value="all">All</option>{providers.map((item) => <option key={item.provider} value={item.provider}>{item.provider.replace(/_/g, " ")}</option>)}</select></label>
          <label className="text-xs text-[color:var(--shell-muted)]">Product<select value={product} onChange={(change) => setProduct(change.target.value)} className="ml-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1.5 text-[color:var(--shell-ink)]"><option value="all">All</option>{products.map((item) => <option key={item} value={item}>{earthObservationProductLabel(item)}</option>)}</select></label>
          {eventId && onOpenEvent && <button type="button" onClick={() => onOpenEvent(eventId)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]"><Link2 className="h-3.5 w-3.5" />Open event thread</button>}
        </div>
      </section>

      {!eventId && locationId && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Location context is not yet an event conclusion.</strong> These scenes share a location, but Claritas will not infer that they describe the same incident. Open an event from the overview before using imagery as corroborating evidence.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Imagery quality summary">
        <article className="app-card rounded-xl p-4"><div className="text-xs uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">Readable assets</div><strong className="mt-2 block text-xl text-[color:var(--shell-ink)]">{quality.readable}/{quality.total}</strong><small className="text-[color:var(--shell-muted)]">{quality.pending} queued or metadata-only</small></article>
        <article className="app-card rounded-xl p-4"><div className="text-xs uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">Natural colour</div><strong className="mt-2 block text-xl text-[color:var(--shell-ink)]">{quality.natural}</strong><small className="text-[color:var(--shell-muted)]">Human-readable visual context</small></article>
        <article className="app-card rounded-xl p-4"><div className="text-xs uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">Analytical layers</div><strong className="mt-2 block text-xl text-[color:var(--shell-ink)]">{quality.analytical}</strong><small className="text-[color:var(--shell-muted)]">False-colour or derived signal</small></article>
        <article className="app-card rounded-xl p-4"><div className="text-xs uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">Average cloud</div><strong className="mt-2 block text-xl text-[color:var(--shell-ink)]">{quality.averageCloud == null ? "Not reported" : `${Math.round(quality.averageCloud)}%`}</strong><small className="text-[color:var(--shell-muted)]">Across readable scenes that report cloud</small></article>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Earth observation provider readiness">
        {providers.map((item) => (
          <div key={item.provider} className="app-card rounded-xl p-4">
            <div className="flex items-center justify-between gap-2"><div className="font-semibold capitalize text-[color:var(--shell-ink)]">{item.provider.replace(/_/g, " ")}</div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${providerStateClass(item.state)}`}>{item.state.replace(/_/g, " ")}</span></div>
            <div className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{item.reason || item.attribution}{item.last_success_at ? ` · Last success ${earthObservationTimestamp(item.last_success_at)}` : ""}</div>
          </div>
        ))}
      </section>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

      {validatedComparePair && preview(validatedComparePair.before) && preview(validatedComparePair.after) && (
        <section className="app-card rounded-xl p-4 sm:p-5" aria-label="Defensible before and after comparison">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[color:var(--shell-ink)]">Validated before / after context</div><div className="mt-1 text-xs text-[color:var(--shell-muted)]">{validatedComparePair.after.location_name || contextLocation} · same {validatedComparePair.after.provider.replace(/_/g, " ")} provider and {earthObservationProductLabel(validatedComparePair.after.product_type)} product</div></div><div className="text-xs text-[color:var(--shell-muted)]">{comparisonStatus.replace(/_/g, " ")}</div></div>
          <div className="relative mt-4 aspect-[16/7] overflow-hidden rounded-xl bg-slate-950">
            <SatelliteImage sources={[preview(validatedComparePair.before)?.url]} alt={`Before observation captured ${earthObservationTimestamp(validatedComparePair.before.capture_start)}`} className={`absolute inset-0 h-full w-full ${isAnalyticalEarthProduct(validatedComparePair.before.product_type) ? "object-contain" : "object-cover"}`} fallbackClassName="absolute inset-0 flex items-center justify-center bg-slate-900" />
            <SatelliteImage sources={[preview(validatedComparePair.after)?.url]} alt={`After observation captured ${earthObservationTimestamp(validatedComparePair.after.capture_start)}`} className={`absolute inset-0 h-full w-full ${isAnalyticalEarthProduct(validatedComparePair.after.product_type) ? "object-contain" : "object-cover"}`} fallbackClassName="absolute inset-0 flex h-full w-full items-center justify-center bg-slate-800" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${slider}%` }} />
            <span className="absolute bottom-3 left-3 rounded-full bg-slate-950/80 px-3 py-1 text-xs text-white">After · {earthObservationTimestamp(validatedComparePair.after.capture_start)}</span><span className="absolute bottom-3 right-3 rounded-full bg-slate-950/80 px-3 py-1 text-xs text-white">Before · {earthObservationTimestamp(validatedComparePair.before.capture_start)}</span>
          </div>
          <input aria-label="Before and after comparison position" type="range" min="0" max="100" value={slider} onChange={(change) => setSlider(Number(change.target.value))} className="mt-3 w-full accent-slate-800" />
          <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{String(comparison?.notice ?? "Acquisition time, sensor, cloud, season, and viewing geometry can produce apparent differences. A visual difference is not automatically an event-caused change.")}</p>
        </section>
      )}

      {comparePair && !validatedComparePair && comparison && (
        <section className="app-card rounded-xl p-4 text-xs leading-5 text-[color:var(--shell-muted)]" aria-label="Comparison validation status">
          <div className="font-semibold text-[color:var(--shell-ink)]">Before / after comparison {comparisonStatus === "checking" ? "is being validated" : "is unavailable"}</div>
          <p className="mt-1">{comparisonStatus === "checking" ? "Claritas is checking event timing, acquisition order, provider, product, and image availability before showing pixels." : String(comparison.reason ?? comparison.notice ?? "No defensible before/after pair is currently available for this event.")}</p>
        </section>
      )}

      <section aria-label="Event-linked earth observation assets">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Event-linked observations</div><h2 className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">What the available imagery can add</h2></div>
          <small className="text-[color:var(--shell-muted)]">Showing {Math.min(12, readableObservations.length)} of {readableObservations.length} readable assets</small>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {!loading && readableObservations.length === 0 && <div className="app-card col-span-full rounded-xl p-8 text-center"><ImageOff className="mx-auto h-7 w-7 text-[color:var(--shell-muted)]" /><div className="mt-3 text-sm font-semibold text-[color:var(--shell-ink)]">No readable event imagery is available yet</div><p className="mx-auto mt-1 max-w-2xl text-xs leading-5 text-[color:var(--shell-muted)]">{providerNotice || "The event thread remains useful while providers wait for a suitable acquisition. Metadata-only scenes are listed compactly below instead of appearing as blank image cards."}</p></div>}
          {readableObservations.slice(0, 12).map((item) => {
            const asset = preview(item)!;
            const analytical = isAnalyticalEarthProduct(item.product_type);
            return (
              <article key={item.id} className="app-card overflow-hidden rounded-xl">
                <div className="relative bg-slate-950">
                  <SatelliteImage sources={[asset.url]} alt={`${earthObservationProductLabel(item.product_type)} observation of ${item.location_name || contextLocation}`} className={`aspect-[16/10] w-full ${analytical ? "object-contain" : "object-cover"}`} fallbackClassName="flex aspect-[16/10] items-center justify-center bg-slate-900" />
                  <span className="absolute bottom-3 left-3 rounded-full bg-slate-950/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">{item.imagery?.label ?? earthObservationProductLabel(item.product_type)}</span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[color:var(--shell-ink)]">{item.location_name || contextLocation}</div><div className="mt-1 text-xs text-[color:var(--shell-muted)]">{earthObservationEvidenceLabel(item)}</div></div>{analytical ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />}</div>
                  <div className="mt-3 space-y-1 text-xs leading-5 text-[color:var(--shell-muted)]">
                    <div><strong className="text-[color:var(--shell-ink)]">Acquired:</strong> {earthObservationTimestamp(item.capture_start)}</div>
                    <div><strong className="text-[color:var(--shell-ink)]">Timeline:</strong> {observationAlignment(item.capture_start, contextStartTime)}</div>
                    <div className="flex items-center gap-1"><Cloud className="h-3 w-3" />{item.cloud_cover == null ? "Cloud cover not reported" : `${Math.round(item.cloud_cover)}% cloud cover`}</div>
                    <div>{earthObservationQualityLabel(item)}</div>
                    <div>{item.provider.replace(/_/g, " ")} · {item.mission} · {item.collection}</div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[color:var(--shell-muted)]">{text(item.imagery?.interpretation ?? item.imagery?.display_guidance, analytical ? "This is a derived analytical layer; colours are not a natural view of the scene." : "Use as visual context alongside event timing and linked reporting.")}</p>
                  <div className="mt-3 rounded-lg border border-[color:var(--signal-amber)]/40 bg-[color:var(--signal-amber-soft)] p-3 text-xs leading-5 text-[color:var(--shell-ink)]"><strong className="block">What this scene can support</strong>{sceneConclusion(item)}</div>
                  {item.analysis_summary && item.analysis_summary_role !== "model_interpretation" && <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] p-3 text-xs leading-5 text-[color:var(--shell-muted)]"><strong className="block text-[color:var(--shell-ink)]">Observation note</strong>{item.analysis_summary}</div>}
                  {item.model_interpretation?.summary && <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong className="block">Model interpretation · not a sensor measurement</strong>{item.model_interpretation.summary}<small className="mt-1 block">{item.model_interpretation.notice}</small></div>}
                  <div className="mt-3 border-t border-[color:var(--shell-border)] pt-3 text-[10px] leading-4 text-[color:var(--shell-muted)]"><ShieldCheck className="mr-1 inline h-3 w-3" />{item.attribution || item.provider}{item.license ? ` · ${item.license}` : ""}</div>
                  <div className="mt-3 flex flex-wrap gap-3"><a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--signal-sky)]">Provider provenance <ExternalLink className="h-3 w-3" /></a>{item.event_id && onOpenEvent && <button type="button" onClick={() => onOpenEvent(item.event_id as string)} className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--signal-sky)]">Open event evidence <Link2 className="h-3 w-3" /></button>}</div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {pendingObservations.length > 0 && (
        <section className="app-card rounded-xl p-4 sm:p-5" aria-label="Pending earth observation assets">
          <div className="flex items-center gap-2"><ImageOff className="h-4 w-4 text-[color:var(--shell-muted)]" /><h2 className="text-sm font-semibold text-[color:var(--shell-ink)]">Queued or metadata-only observations</h2></div>
          <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">These records are not rendered as image cards because no readable asset is currently available.</p>
          <div className="mt-3 divide-y divide-[color:var(--shell-border)]">
            {pendingObservations.slice(0, 12).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"><div><strong className="text-[color:var(--shell-ink)]">{item.location_name || contextLocation}</strong><span className="ml-2 text-[color:var(--shell-muted)]">{earthObservationProductLabel(item.product_type)} · {item.provider}</span></div><span className="text-[color:var(--shell-muted)]">{item.status.replace(/_/g, " ")} · {earthObservationTimestamp(item.capture_start)}</span></div>)}
          </div>
        </section>
      )}
    </div>
  );
}
