import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  ExternalLink,
  Eye,
  ImageOff,
  Link2,
  Mail,
  MapPin,
  Newspaper,
  RefreshCw,
  Satellite,
  Sparkles,
} from "lucide-react";
import {
  acknowledgeIntelligenceAlert,
  deleteIntelligenceWatch,
  fetchEventGibsContext,
  fetchIntelligenceAlerts,
  fetchIntelligenceEvent,
  fetchIntelligenceEvents,
  fetchIntelligenceWatchlist,
  saveIntelligenceWatch,
  type GibsEventContext,
  type IntelligenceAlert,
  type IntelligenceEvent,
  type IntelligenceEventDetail,
  type IntelligenceEvidence,
  type IntelligenceSeverity,
  type IntelligenceWatch,
} from "../lib/api";
import SatelliteImage from "./SatelliteImage";
import {
  earthObservationProductLabel,
  isAnalyticalEarthProduct,
  sortEarthObservationsForDisplay,
} from "./earthObservationPresentation";
import { presentEventLinkage, signalDomainLabel } from "./eventLinkagePresentation";
import { presentEvent } from "./eventPresentation";

const severities: Array<IntelligenceSeverity | "all"> = ["all", "critical", "high", "medium", "low"];

type Props = {
  initialCountry?: string | null;
  initialEventId?: string | null;
  onSelectEvent?: (eventId: string) => void;
  onOpenImagery?: (eventId?: string) => void;
};

const relationshipLabels: Record<string, { label: string; explanation: string; className: string }> = {
  reported: {
    label: "Reported",
    explanation: "A source reported this development; it is not treated as physical confirmation.",
    className: "evidence-relationship-reported",
  },
  observed: {
    label: "Observed",
    explanation: "A sensor or official observation recorded this signal.",
    className: "evidence-relationship-observed",
  },
  corroborates: {
    label: "Corroborates",
    explanation: "This independently supports part of the event assessment.",
    className: "evidence-relationship-observed",
  },
  derived: {
    label: "Derived",
    explanation: "Claritas calculated this from source data using a stated method.",
    className: "evidence-relationship-derived",
  },
  model_interpretation: {
    label: "Model interpretation",
    explanation: "A model interpreted supplied evidence; this is not an independent observation.",
    className: "evidence-relationship-derived",
  },
  assessment: {
    label: "Assessment",
    explanation: "Claritas synthesized the evidence into an explicitly qualified assessment.",
    className: "evidence-relationship-assessment",
  },
  contradicts: {
    label: "Contradicts",
    explanation: "This evidence conflicts with part of the current assessment.",
    className: "evidence-relationship-contradicts",
  },
  context: {
    label: "Context",
    explanation: "This is relevant background, not proof of cause or impact.",
    className: "evidence-relationship-context",
  },
};

function dateLabel(value: string) {
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

function confidenceLabel(value: number) {
  return `${Math.round(Number(value) * 100)}%`;
}

function recordString(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function evidenceTitle(item: IntelligenceEvidence) {
  return item.title
    || item.source_title
    || recordString(item.metadata, "original_title")
    || recordString(item.metadata, "headline")
    || item.evidence_type.replace(/_/g, " ");
}

function evidenceSummary(item: IntelligenceEvidence) {
  return item.summary
    || item.source_summary
    || recordString(item.metadata, "original_summary")
    || recordString(item.metadata, "description")
    || null;
}

function evidenceUrl(item: IntelligenceEvidence) {
  return item.source_url || recordString(item.provenance, "url") || null;
}

function severityClass(severity: IntelligenceSeverity) {
  if (severity === "critical") return "event-severity-critical";
  if (severity === "high") return "event-severity-high";
  if (severity === "medium") return "event-severity-medium";
  return "event-severity-low";
}

export default function IntelligenceWorkspace({
  initialCountry,
  initialEventId,
  onSelectEvent,
  onOpenImagery,
}: Props) {
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialEventId ?? null);
  const [detail, setDetail] = useState<IntelligenceEventDetail | null>(null);
  const [gibsContext, setGibsContext] = useState<GibsEventContext | null>(null);
  const [severity, setSeverity] = useState<IntelligenceSeverity | "all">("all");
  const [includeExpired, setIncludeExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [watches, setWatches] = useState<IntelligenceWatch[]>([]);
  const [alerts, setAlerts] = useState<IntelligenceAlert[]>([]);
  const [watchPending, setWatchPending] = useState(false);
  const detailPanelRef = useRef<HTMLElement | null>(null);

  const selectEvent = useCallback((eventId: string) => {
    setDetail(null);
    setDetailError(null);
    setSelectedId(eventId);
    onSelectEvent?.(eventId);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1279px)").matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }, [onSelectEvent]);

  useEffect(() => {
    if (initialEventId !== undefined) setSelectedId(initialEventId);
  }, [initialEventId]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const optionalData = Promise.allSettled([
      fetchIntelligenceWatchlist(),
      fetchIntelligenceAlerts(),
    ]);
    try {
      const rows = await fetchIntelligenceEvents({
        limit: 60,
        country: initialCountry || undefined,
        severity: severity === "all" ? undefined : severity,
        includeExpired,
      });
      setEvents(rows);
      setSelectedId((current) => {
        if (initialEventId === null) return null;
        return current ?? initialEventId ?? rows[0]?.id ?? null;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
    const [watchResult, alertResult] = await optionalData;
    if (watchResult.status === "fulfilled") setWatches(watchResult.value);
    if (alertResult.status === "fulfilled") setAlerts(alertResult.value);
  }, [includeExpired, initialCountry, initialEventId, severity]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetchIntelligenceEvent(selectedId)
      .then((value) => {
        if (!active) return;
        setDetail(value);
        setEvents((current) => current.some((event) => event.id === value.event.id)
          ? current
          : [value.event, ...current]);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setDetail(null);
        setDetailError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detailRetry, selectedId]);

  useEffect(() => {
    let active = true;
    setGibsContext(null);
    if (!selectedId) return () => { active = false; };
    fetchEventGibsContext(selectedId)
      .then((value) => { if (active) setGibsContext(value); })
      .catch(() => { if (active) setGibsContext(null); });
    return () => { active = false; };
  }, [selectedId]);

  const evidenceThread = useMemo(
    () => [...(detail?.evidence ?? [])].sort((left, right) => (
      Date.parse(left.observed_at) - Date.parse(right.observed_at)
    )),
    [detail],
  );
  const linkedReporting = useMemo(
    () => evidenceThread.filter((item) => (
      item.domain.toLocaleLowerCase() === "news"
      || item.source_record_type.toLocaleLowerCase().includes("news")
      || item.evidence_type.toLocaleLowerCase().includes("news")
    )),
    [evidenceThread],
  );
  const linkedNews = useMemo(() => {
    if (detail?.linked_news) return detail.linked_news;
    return linkedReporting.map((item) => ({
      id: item.id,
      evidence_type: item.evidence_type,
      relationship: item.relationship,
      title: evidenceTitle(item),
      summary: evidenceSummary(item),
      url: evidenceUrl(item),
      publisher: item.source_name,
      published_at: item.published_at,
      observed_at: item.observed_at,
      confidence: item.confidence,
    }));
  }, [detail?.linked_news, linkedReporting]);
  const detailPresentation = useMemo(
    () => detail ? presentEvent(detail.event) : null,
    [detail],
  );
  const gibsTrueColor = gibsContext?.layers.find((layer) => (
    layer.category === "true_color" && Boolean(layer.preview_url)
  ));
  const displayedEarthObservations = useMemo(
    () => sortEarthObservationsForDisplay(detail?.earth_observations ?? []),
    [detail],
  );
  const satelliteAssessment = displayedEarthObservations.length > 0
    ? "Event-linked observation available"
    : gibsTrueColor
      ? "Regional browse context only"
      : "No usable scene available yet";
  const leadEarthObservation = displayedEarthObservations[0] ?? null;
  const leadEarthAsset = leadEarthObservation?.imagery?.preferred_asset
    ?? leadEarthObservation?.assets?.find((item) => item.asset_type === "preview")
    ?? leadEarthObservation?.assets?.[0]
    ?? null;
  const linkedSignalGroups = useMemo(() => {
    const groups = new Map<string, { label: string; count: number; first: IntelligenceEvidence }>();
    evidenceThread.forEach((item) => {
      const label = signalDomainLabel(item.domain, item.source_record_type);
      const existing = groups.get(label);
      if (existing) existing.count += 1;
      else groups.set(label, { label, count: 1, first: item });
    });
    return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }, [evidenceThread]);

  const watchTarget = detail?.event.primary_country_iso2
    ? { type: "country", key: detail.event.primary_country_iso2 }
    : detail ? { type: "event_type", key: detail.event.event_type } : null;
  const activeWatch = watchTarget
    ? watches.find((watch) => watch.watch_type === watchTarget.type && watch.watch_key === watchTarget.key)
    : undefined;
  const watchEmailEnabled = activeWatch?.metadata?.email_enabled === true;

  const toggleWatch = async () => {
    if (!watchTarget || watchPending) return;
    setWatchPending(true);
    try {
      if (activeWatch) await deleteIntelligenceWatch(activeWatch.id);
      else await saveIntelligenceWatch({ watch_type: watchTarget.type, watch_key: watchTarget.key, minimum_severity: "high", alerts_enabled: true });
      const watchRows = await fetchIntelligenceWatchlist();
      setWatches(watchRows);
      try {
        setAlerts(await fetchIntelligenceAlerts());
      } catch {
        // Alert delivery is optional; a successful watch mutation remains visible.
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWatchPending(false);
    }
  };

  const toggleWatchEmail = async () => {
    if (!watchTarget || !activeWatch || watchPending) return;
    setWatchPending(true);
    try {
      await saveIntelligenceWatch({
        watch_type: watchTarget.type,
        watch_key: watchTarget.key,
        minimum_severity: activeWatch.minimum_severity,
        alerts_enabled: activeWatch.alerts_enabled,
        metadata: { email_enabled: !watchEmailEnabled },
      });
      setWatches(await fetchIntelligenceWatchlist());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWatchPending(false);
    }
  };

  const openAlert = async (alert: IntelligenceAlert) => {
    selectEvent(alert.event_id);
    try {
      await acknowledgeIntelligenceAlert(alert.id);
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="workspace-page min-w-0 space-y-4">
      <section className="app-card-hero rounded-xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">Event investigation · shared evidence graph</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">Investigate the event, then trace every source</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--shell-muted)]">
              News, weather, transport, podcasts, official observations, markets, and satellite context are organized as one time-ordered evidence thread. Relationship labels distinguish reporting from observation and analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenImagery && (
              <button type="button" onClick={() => onOpenImagery(selectedId ?? undefined)} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]">
                <Satellite className="h-4 w-4" /> Satellite assessment
              </button>
            )}
            <button type="button" onClick={() => void loadEvents()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter investigations by severity">
          {severities.map((value) => (
            <button key={value} type="button" onClick={() => setSeverity(value)} aria-pressed={severity === value} className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${severity === value ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-[color:var(--shell-bg)]" : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"}`}>
              {value}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIncludeExpired((value) => !value)}
            aria-pressed={includeExpired}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${includeExpired ? "border-[color:var(--shell-accent)] bg-[color:var(--shell-accent)] text-[color:var(--shell-bg)]" : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"}`}
          >
            {includeExpired ? "Archive included" : "Current only"}
          </button>
        </div>
      </section>

      {error && <div role="alert" className="event-error rounded-xl border p-4 text-sm">{error}</div>}

      {alerts.length > 0 && (
        <section aria-label="Watchlist alerts" className="app-card rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Bell className="h-3.5 w-3.5" />Watchlist alerts · {alerts.length}</div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {alerts.slice(0, 6).map((alert) => (
              <button key={alert.id} type="button" onClick={() => void openAlert(alert)} className="rounded-lg border border-[color:var(--shell-border)] p-3 text-left hover:bg-[color:var(--shell-bg)]">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-[color:var(--shell-ink)]">{alert.title}</span><span className="text-[10px] font-semibold uppercase text-[color:var(--shell-muted)]">{alert.severity}</span></div>
                <div className="mt-1 line-clamp-2 text-xs text-[color:var(--shell-muted)]">{alert.body}</div>
                <div className="mt-2 text-[10px] text-[color:var(--shell-muted)]">{alert.location_name || alert.primary_country_iso2 || "Global"} · {dateLabel(alert.updated_at)}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid min-h-[34rem] gap-4 xl:grid-cols-[minmax(19rem,0.68fr)_minmax(0,1.32fr)]">
        <section className="app-card overflow-hidden rounded-xl" aria-label="Prioritized event investigations">
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--shell-border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
            <span>Prioritized investigations · {events.length}</span>
            <span className="event-list-selection-status">{selectedId ? "1 viewing" : "Choose one"}</span>
          </div>
          <div className="max-h-[42vh] overflow-y-auto sm:max-h-[34rem] xl:max-h-[72vh]">
            {!loading && events.length === 0 && <div className="p-6 text-sm text-[color:var(--shell-muted)]">No events meet this scope. Source explorers remain available without implying a cross-domain connection.</div>}
            {events.map((event) => {
              const presentation = presentEvent(event);
              const selected = selectedId === event.id;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => selectEvent(event.id)}
                  aria-current={selected ? "true" : undefined}
                  aria-pressed={selected}
                  aria-controls="selected-event-investigation"
                  aria-label={`${selected ? "Currently viewing" : "Open"} investigation: ${presentation.headline}`}
                  className={`event-list-row w-full border-b border-[color:var(--shell-border)] p-4 text-left ${selected ? "is-selected" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{presentation.typeLabel}</span>
                    <span className="flex items-center gap-1.5">
                      {selected && <span className="event-list-active-indicator">Viewing</span>}
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${severityClass(event.severity)}`}>{event.severity}</span>
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold leading-5 text-[color:var(--shell-ink)]">{presentation.headline}</div>
                  {presentation.focus && <div className="mt-1 line-clamp-1 text-[11px] text-[color:var(--shell-muted)]">Focus · {presentation.focus}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--shell-muted)]">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{presentation.locationLabel}</span>
                    <span>{event.evidence_count} linked</span>
                    {event.earth_observation_available && <span className="inline-flex items-center gap-1 text-[color:var(--signal-emerald)]"><Satellite className="h-3 w-3" />Imagery</span>}
                  </div>
                  <time dateTime={event.last_activity_time} className="mt-2 block text-[10px] tabular-nums text-[color:var(--shell-muted)]">
                    Latest evidence {dateLabel(event.last_activity_time)}
                  </time>
                  {event.expires_at && (
                    <time dateTime={event.expires_at} className={`mt-1 block text-[10px] tabular-nums ${event.freshness_state === "expired" ? "text-[color:var(--signal-coral)]" : "text-[color:var(--shell-muted)]"}`}>
                      {event.freshness_state === "expired" ? "Expired" : "Current until"} {dateLabel(event.expires_at)}
                    </time>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section ref={detailPanelRef} id="selected-event-investigation" className="app-card rounded-xl p-4 sm:p-5" aria-label="Selected event investigation" tabIndex={-1}>
          {detailLoading && <div role="status" className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading the selected investigation</div>}
          {!detailLoading && detailError && <div role="alert" className="event-error flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border p-5 text-center text-sm"><span>Unable to load this event’s evidence thread: {detailError}</span><button type="button" onClick={() => setDetailRetry((value) => value + 1)} className="rounded-full border border-current px-3 py-1.5 text-xs font-semibold">Retry event</button></div>}
          {!detailLoading && !detailError && (!detail || detail.event.id !== selectedId) && <div className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]">Select an event to inspect its evidence thread.</div>}
          {!detailLoading && detail?.event.id === selectedId && (
            <div className="space-y-6">
              <header>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                  <span className={`rounded-full px-2 py-1 font-semibold uppercase ${severityClass(detail.event.severity)}`}>{detail.event.severity}</span>
                  <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 uppercase">{detail.event.status}</span>
                  <span>{confidenceLabel(detail.event.confidence)} confidence</span>
                  <span>{detail.event.source_diversity} sources</span>
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-accent)]">{detailPresentation?.typeLabel}</div>
                    <h2 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">{detailPresentation?.headline}</h2>
                    {detailPresentation?.focus && <div className="mt-1 text-xs text-[color:var(--shell-muted)]">Signal focus · {detailPresentation.focus}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--shell-muted)]"><span className="inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{detailPresentation?.locationLabel}</span><span>Started {dateLabel(detail.event.start_time)}</span><span>Updated {dateLabel(detail.event.last_activity_time)}</span>{detail.event.expires_at && <span className={detail.event.freshness_state === "expired" ? "text-[color:var(--signal-coral)]" : ""}>{detail.event.freshness_state === "expired" ? "Expired" : "Current until"} {dateLabel(detail.event.expires_at)}</span>}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {watchTarget && <button type="button" disabled={watchPending} onClick={() => void toggleWatch()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50">{activeWatch ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}{activeWatch ? "Stop watching" : `Watch ${watchTarget.key}`}</button>}
                    {activeWatch && <button type="button" disabled={watchPending} onClick={() => void toggleWatchEmail()} aria-pressed={watchEmailEnabled} title="Requires a verified account email and email delivery enabled in your briefing profile." className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${watchEmailEnabled ? "border-[color:var(--shell-accent-2)] bg-[color:var(--signal-emerald-soft)] text-[color:var(--shell-ink)]" : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"}`}><Mail className="h-3.5 w-3.5" />Email important events · {watchEmailEnabled ? "On" : "Off"}</button>}
                  </div>
                </div>
              </header>

              {leadEarthObservation && leadEarthAsset && (
                <section className="event-visual-lead overflow-hidden rounded-xl border border-[color:var(--shell-border)]" aria-labelledby="event-visual-lead-heading">
                  <div className="grid md:grid-cols-[minmax(14rem,0.92fr)_minmax(0,1.08fr)]">
                    <div className="satellite-image-stage relative flex aspect-[4/3] min-h-56 items-center justify-center p-2 sm:aspect-[16/10] md:min-h-64">
                      <SatelliteImage
                        sources={[leadEarthAsset.url]}
                        alt={`${earthObservationProductLabel(leadEarthObservation.product_type)} visual context for the selected event: ${detailPresentation?.headline || detail.event.title}`}
                        className="h-full w-full rounded-lg object-contain"
                        fallbackClassName="flex h-full w-full items-center justify-center rounded-lg bg-[color:var(--shell-sidebar)]"
                        loading="eager"
                      />
                      <span className="event-visual-lead-badge">Visual context · selected event</span>
                    </div>
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">
                        <Satellite className="h-3.5 w-3.5 text-[color:var(--signal-emerald)]" /> Event-linked imagery
                        <span className="rounded-full border border-[color:var(--signal-emerald)] bg-[color:var(--signal-emerald-soft)] px-2 py-0.5 text-[9px] text-[color:var(--shell-ink)]">{leadEarthObservation.imagery?.quality_tier === "high_resolution_processed" ? "High-resolution scene" : "Linked scene"}</span>
                      </div>
                      <h3 id="event-visual-lead-heading" className="mt-2 text-base font-semibold text-[color:var(--shell-ink)]">{leadEarthObservation.imagery?.label || earthObservationProductLabel(leadEarthObservation.product_type)} · {leadEarthObservation.mission}</h3>
                      <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">Shown beside this investigation because the scene is attached to the event currently selected. It supplies visual context for the stated location; it does not establish cause or impact by itself.</p>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[color:var(--shell-muted)]">
                        <span>Captured {dateLabel(leadEarthObservation.capture_start)}</span>
                        {leadEarthObservation.resolution_m != null && <span>{leadEarthObservation.resolution_m} m native resolution</span>}
                        {leadEarthObservation.cloud_cover != null && <span>{Math.round(leadEarthObservation.cloud_cover)}% cloud</span>}
                      </div>
                      {leadEarthObservation.imagery?.interpretation && <p className="mt-3 border-l-2 border-[color:var(--shell-accent)] pl-2 text-xs leading-5 text-[color:var(--shell-ink)]">{leadEarthObservation.imagery.interpretation}</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {onOpenImagery && <button type="button" onClick={() => onOpenImagery(detail.event.id)} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">Inspect all imagery <Satellite className="h-3.5 w-3.5" /></button>}
                        <a href={leadEarthObservation.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">Scene provenance <ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <section className="event-situation-brief rounded-xl border border-[color:var(--shell-border)] p-4" aria-labelledby="situation-brief-heading">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Sparkles className="h-3.5 w-3.5 text-[color:var(--shell-accent)]" /><span id="situation-brief-heading">Situation brief</span></div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <article className="event-answer-card">
                    <div className="event-answer-label">What happened</div>
                    <p>{detail.understanding?.what_happened || detailPresentation?.summary}</p>
                  </article>
                  <article className="event-answer-card">
                    <div className="event-answer-label">Where</div>
                    <p className="inline-flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--shell-accent-2)]" /><span>{detail.understanding?.where || detailPresentation?.locationLabel}{detail.event.primary_country_iso2 && !detail.understanding?.where && detailPresentation?.locationLabel !== detail.event.primary_country_iso2 ? ` · ${detail.event.primary_country_iso2}` : ""}{detail.locations.length ? ` · ${detail.locations.length} linked ${detail.locations.length === 1 ? "location" : "locations"}` : ""}</span></p>
                    {detail.understanding?.coordinates && (
                      <p className="mt-2 text-xs text-[color:var(--shell-muted)]">
                        {detail.understanding.coordinates.label} · {detail.understanding.coordinates.basis === "source_observed" ? "source-observed geography" : "estimated mapped geography"}
                      </p>
                    )}
                    {!detail.understanding?.coordinates && detail.understanding?.location_basis === "unresolved" && (
                      <p className="mt-2 text-xs text-[color:var(--shell-muted)]">No defensible event coordinate is available yet.</p>
                    )}
                  </article>
                  <article className="event-answer-card">
                    <div className="event-answer-label">Why it matters</div>
                    <p>{detail.understanding?.why_interesting || detailPresentation?.why}</p>
                  </article>
                  <article className="event-answer-card">
                    <div className="event-answer-label">Evidence state</div>
                    <p>{detail.understanding?.linked_news_count ?? linkedNews.length} linked {(detail.understanding?.linked_news_count ?? linkedNews.length) === 1 ? "report" : "reports"} · {detail.understanding?.physical_observation_count ?? displayedEarthObservations.length} physical {(detail.understanding?.physical_observation_count ?? displayedEarthObservations.length) === 1 ? "observation" : "observations"} · {satelliteAssessment}.</p>
                  </article>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-border)]">
                  {[["Relevance", detail.event.relevance_score], ["Urgency", detail.event.urgency_score], ["Materiality", detail.event.materiality_score]].map(([label, value]) => <div key={String(label)} className="bg-[color:var(--shell-surface)] p-3"><div className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{label}</div><div className="mt-1 text-base font-semibold text-[color:var(--shell-ink)]">{confidenceLabel(Number(value))}</div></div>)}
                </div>
              </section>

              {linkedSignalGroups.length > 0 && (
                <section className="rounded-xl border border-[color:var(--shell-border)] p-4" aria-labelledby="linked-signals-heading">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Link2 className="h-3.5 w-3.5" />Likely linked signals</div>
                      <h3 id="linked-signals-heading" className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">What other signals are associated with this event?</h3>
                    </div>
                    <span className="text-xs text-[color:var(--shell-muted)]">{linkedSignalGroups.length} signal {linkedSignalGroups.length === 1 ? "type" : "types"}</span>
                  </div>
                  <p className="mt-2 max-w-3xl text-xs leading-5 text-[color:var(--shell-muted)]">News, weather, transport, podcasts, and other sources are shown only with their association rationale. Matching location, mapped geography, entities, and timing can explain a connection; none of those factors alone establishes causation.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {linkedSignalGroups.slice(0, 6).map((group) => {
                      const linkage = presentEventLinkage(group.first.correlation_score, group.first.correlation_factors);
                      return (
                        <article key={group.label} className="event-signal-group rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-[color:var(--shell-ink)]">{group.label}</span>
                            <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--shell-muted)]">{group.count} {group.count === 1 ? "item" : "items"}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-1.5"><span className="event-link-chip">{linkage.label}</span><span className="min-w-0 truncate text-[10px] text-[color:var(--shell-muted)]" title={linkage.shortReason}>{linkage.shortReason}</span></div>
                          <p className="mt-2 text-[10px] leading-4 text-[color:var(--shell-muted)]">Details and source provenance appear in the evidence timeline below.</p>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              <section aria-labelledby="linked-reporting-heading">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Newspaper className="h-3.5 w-3.5" />Likely linked reporting</div><h3 id="linked-reporting-heading" className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">Which reporting is likely associated with this event?</h3></div>
                  <span className="text-xs text-[color:var(--shell-muted)]">{detail.understanding?.linked_news_count ?? linkedNews.length} source {(detail.understanding?.linked_news_count ?? linkedNews.length) === 1 ? "record" : "records"}</span>
                </div>
                <p className="mt-2 max-w-3xl text-xs leading-5 text-[color:var(--shell-muted)]">A report can be relevant without confirming the event. Where matching factors are available, they are disclosed on each card.</p>
                {linkedNews.length > 0 ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {linkedNews.slice(0, 6).map((item) => {
                      const evidence = linkedReporting.find((candidate) => candidate.id === item.id);
                      const linkage = presentEventLinkage(evidence?.correlation_score, evidence?.correlation_factors);
                      return (
                        <article key={`report-${item.id}`} className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-4">
                          <div className="flex items-start justify-between gap-3 text-[10px] uppercase tracking-[0.12em] text-[color:var(--shell-muted)]">
                            <span>{item.publisher || "Reporting source"}</span>
                            <span className="text-right normal-case tracking-normal">
                              {item.published_at ? <>Published {dateLabel(item.published_at)}<br /></> : null}
                              <span>Received {dateLabel(item.observed_at)}</span>
                            </span>
                          </div>
                          <h4 className="mt-2 text-sm font-semibold leading-5 text-[color:var(--shell-ink)]">{item.title}</h4>
                          {item.summary && <p className="mt-1 line-clamp-3 text-xs leading-5 text-[color:var(--shell-muted)]">{item.summary}</p>}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[10px] text-[color:var(--shell-muted)]"><span className="event-link-chip">{linkage.label} report</span><span>{confidenceLabel(item.confidence)} source confidence</span>{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[color:var(--signal-sky)]">Read report <ExternalLink className="h-3 w-3" /></a>}</div>
                          <p className="event-link-explanation"><strong>Why shown:</strong> {linkage.explanation}</p>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-[color:var(--shell-border)] p-4 text-xs leading-5 text-[color:var(--shell-muted)]">No news record is explicitly linked to this event yet. Sensor and official evidence below remain available, but Claritas does not imply a reporting connection.</div>
                )}
              </section>

              <section aria-labelledby="evidence-thread-heading">
                <div className="flex items-end justify-between gap-3">
                  <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">Evidence timeline</div><h3 id="evidence-thread-heading" className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">Sources and observations in chronological order</h3></div>
                  <span className="text-xs text-[color:var(--shell-muted)]">{evidenceThread.length} items · {detail.event.domain_count} domains</span>
                </div>
                <p className="mt-2 max-w-3xl text-xs leading-5 text-[color:var(--shell-muted)]">Every item is labelled by what it contributes and why it is likely associated with the selected event. Association gives investigation context; it is not a causal conclusion.</p>
                <ol className="mt-4 space-y-3 border-l border-[color:var(--shell-border)] pl-4">
                  {evidenceThread.map((item) => {
                    const relationship = relationshipLabels[item.relationship] ?? relationshipLabels.context;
                    const sourceUrl = evidenceUrl(item);
                    const summary = evidenceSummary(item);
                    const linkage = presentEventLinkage(item.correlation_score, item.correlation_factors);
                    const domainLabel = signalDomainLabel(item.domain, item.source_record_type);
                    return (
                      <li id={`event-evidence-${item.id}`} key={item.id} className="relative rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-4 before:absolute before:-left-[1.31rem] before:top-5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-[color:var(--shell-surface)] before:bg-[color:var(--signal-sky)]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span title={relationship.explanation} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${relationship.className}`}>{relationship.label}</span>
                          <span title={linkage.explanation} className="event-link-chip">{linkage.label}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{domainLabel}</span>
                          <span className="ml-auto text-right text-[10px] leading-4 text-[color:var(--shell-muted)]">
                            {item.published_at ? <>Published {dateLabel(item.published_at)}<br /></> : null}
                            Evidence received {dateLabel(item.observed_at)}
                          </span>
                        </div>
                        <h4 className="mt-2 text-sm font-semibold capitalize text-[color:var(--shell-ink)]">{evidenceTitle(item)}</h4>
                        {summary && <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">{summary}</p>}
                        <p className="event-link-explanation"><strong>Why shown:</strong> {linkage.explanation}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[color:var(--shell-muted)]">
                          <span>{item.source_name || item.source_record_type}</span>
                          <span>{confidenceLabel(item.confidence)} confidence</span>
                          {item.attribution && <span>Attribution: {item.attribution}</span>}
                          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[color:var(--signal-sky)]">Open source <ExternalLink className="h-3 w-3" /></a>}
                          {item.native_route && <a href={item.native_route} className="inline-flex items-center gap-1 font-semibold text-[color:var(--signal-sky)]">Open source explorer <Link2 className="h-3 w-3" /></a>}
                        </div>
                      </li>
                    );
                  })}
                  {evidenceThread.length === 0 && <li className="text-sm text-[color:var(--shell-muted)]">No evidence records are available for this event.</li>}
                </ol>
              </section>

              <section className="rounded-xl border border-[color:var(--shell-border)] p-4" aria-labelledby="satellite-context-heading">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Satellite className="h-3.5 w-3.5" /><span id="satellite-context-heading">Satellite assessment</span></div><div className="mt-2 inline-flex rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--shell-ink)]">{satelliteAssessment}</div><p className="mt-2 max-w-2xl text-xs leading-5 text-[color:var(--shell-muted)]">Event-linked scenes may help assess visible conditions or change at the stated location. Browse layers provide regional context only; neither establishes cause by itself.</p></div>
                  {onOpenImagery && <button type="button" onClick={() => onOpenImagery(detail.event.id)} className="rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">Inspect event imagery</button>}
                </div>
                {gibsTrueColor && (
                  <article className="mt-3 grid overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] sm:grid-cols-[minmax(12rem,14rem)_minmax(0,1fr)]" aria-label="NASA GIBS true-color event context">
                    <div className="satellite-image-stage flex aspect-[16/10] min-h-48 items-center justify-center p-2 sm:aspect-auto sm:min-h-36">
                      <SatelliteImage
                        sources={[gibsTrueColor.preview_url]}
                        alt={`NASA GIBS true-color context for ${detailPresentation?.locationLabel || "the event location"} on ${gibsTrueColor.date}`}
                        className="h-full max-h-64 w-full rounded-md object-contain sm:max-h-44"
                        fallbackClassName="flex min-h-36 h-full w-full items-center justify-center rounded-md bg-[color:var(--shell-sidebar)]"
                      />
                    </div>
                    <div className="p-3 text-xs text-[color:var(--shell-muted)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[color:var(--signal-amber)] bg-[color:var(--signal-amber-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--shell-ink)]">Regional browse context · not proof</span>
                        <span>{gibsTrueColor.date}</span>
                      </div>
                      <div className="mt-2 font-semibold text-[color:var(--shell-ink)]">{gibsTrueColor.title}</div>
                      <p className="mt-1 leading-5">{gibsContext?.notice || "NASA GIBS browse imagery is contextual and is not proof of physical change or causation."}</p>
                      <p className="mt-1 leading-5">This lower-detail layer is intentionally shown at a bounded size. Use the imagery workspace for event-linked processed scenes.</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{gibsTrueColor.provenance.attribution}</span>
                        <a href={gibsTrueColor.provenance.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[color:var(--signal-sky)]">NASA GIBS provenance <ExternalLink className="h-3 w-3" /></a>
                      </div>
                    </div>
                  </article>
                )}
                {displayedEarthObservations.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {displayedEarthObservations.slice(0, 4).map((observation) => {
                      const asset = observation.imagery?.preferred_asset ?? observation.assets?.find((item) => item.asset_type === "preview") ?? observation.assets?.[0];
                      const analytical = isAnalyticalEarthProduct(observation.product_type);
                      return <article key={observation.id} className="overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)]">
                        <div className="satellite-image-stage flex aspect-[4/3] min-h-52 items-center justify-center p-2 sm:aspect-video">{asset ? <SatelliteImage sources={[asset.url]} alt={`${earthObservationProductLabel(observation.product_type)} observation at ${observation.location_name || "event location"}`} className="h-full w-full rounded-md object-contain" fallbackClassName="flex h-full w-full items-center justify-center rounded-md bg-[color:var(--shell-sidebar)]" /> : <div className="flex h-full w-full items-center justify-center"><ImageOff className="h-6 w-6 text-[color:var(--shell-muted)]" /></div>}</div>
                        <div className="p-3 text-xs text-[color:var(--shell-muted)]"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-[color:var(--shell-ink)]">{observation.imagery?.label || earthObservationProductLabel(observation.product_type)} · {observation.mission}</div><span className="rounded-full border border-[color:var(--signal-emerald)] bg-[color:var(--signal-emerald-soft)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--shell-ink)]">{observation.imagery?.quality_tier === "high_resolution_processed" ? "High-resolution · event linked" : "Event linked"}</span></div>{analytical && <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--signal-amber)]">Analytical layer · not natural color</div>}<div className="mt-1">Captured {dateLabel(observation.capture_start)}{observation.resolution_m == null ? "" : ` · ${observation.resolution_m} m native resolution`}{observation.imagery?.effective_pixel_size_m == null ? "" : ` · ${observation.imagery.effective_pixel_size_m} m effective pixel`}{observation.cloud_cover == null ? "" : ` · ${Math.round(observation.cloud_cover)}% cloud`}{asset ? ` · ${asset.width}×${asset.height} preview` : ""}</div>{observation.imagery?.interpretation && <p className="mt-2 leading-5 text-[color:var(--shell-ink)]">{observation.imagery.interpretation}</p>}{observation.analysis_summary && observation.analysis_summary_role !== "model_interpretation" && <p className="mt-2 leading-5">{observation.analysis_summary}</p>}{observation.model_interpretation && <div className="mt-3 rounded-lg border border-[color:var(--viz-violet)]/40 bg-[color:var(--shell-bg)] p-3"><div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--viz-violet)]"><Sparkles className="h-3 w-3" />Model interpretation · not an independent measurement</div>{observation.model_interpretation.summary && <p className="mt-1 leading-5 text-[color:var(--shell-ink)]">{observation.model_interpretation.summary}</p>}{observation.model_interpretation.findings?.[0] && <p className="mt-1 leading-5"><span className="font-semibold text-[color:var(--shell-ink)]">Observed feature:</span> {observation.model_interpretation.findings[0]}</p>}{observation.model_interpretation.possible_changes?.[0] && <p className="mt-1 leading-5"><span className="font-semibold text-[color:var(--shell-ink)]">Possible change:</span> {observation.model_interpretation.possible_changes[0]}</p>}<p className="mt-1 text-[10px] leading-4">{observation.model_interpretation.notice}</p></div>}{observation.event_context?.linkage?.limitation && <p className="mt-2 border-l-2 border-[color:var(--shell-accent)] pl-2 leading-5">{observation.event_context.linkage.limitation}</p>}<a href={observation.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[color:var(--signal-sky)]">Provider provenance <ExternalLink className="h-3 w-3" /></a></div>
                      </article>;
                    })}
                  </div>
                ) : (
                  <div className="mt-3 flex items-start gap-3 rounded-lg bg-[color:var(--shell-bg)] p-3 text-xs text-[color:var(--shell-muted)]"><ImageOff className="mt-0.5 h-4 w-4 shrink-0" /><span>{detail.event.earth_observation_available ? "Satellite metadata exists, but no usable asset is currently available in this response." : "No defensible event-specific satellite observation is available yet. The investigation remains supported by the labelled evidence above."}</span></div>
                )}
              </section>

              {detail.locations.length > 0 && (
                <section aria-labelledby="affected-locations-heading"><h3 id="affected-locations-heading" className="text-sm font-semibold text-[color:var(--shell-ink)]">Affected and exposed locations</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.locations.map((location) => <div key={`${location.id}-${location.relationship}`} className="rounded-lg border border-[color:var(--shell-border)] p-3"><div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--shell-ink)]"><MapPin className="h-3.5 w-3.5" />{location.canonical_name}</div><div className="mt-1 text-xs capitalize text-[color:var(--shell-muted)]">{location.relationship.replace(/_/g, " ")} · {confidenceLabel(location.confidence)} confidence · {location.location_type.replace(/_/g, " ")}</div></div>)}</div></section>
              )}

              {detail.related_events.length > 0 && (
                <section aria-labelledby="related-events-heading">
                  <h3 id="related-events-heading" className="text-sm font-semibold text-[color:var(--shell-ink)]">Likely related investigations</h3>
                  <p className="mt-1 text-xs text-[color:var(--shell-muted)]">These are qualified context links, not assertions that one event caused another. Open a card to inspect its own evidence and rationale.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {detail.related_events.map((event) => (
                      <button key={`${event.id}-${event.relationship}`} type="button" onClick={() => selectEvent(event.id)} aria-label={`Open likely related investigation: ${event.title}`} className="event-link-card rounded-lg border border-[color:var(--shell-border)] p-3 text-left">
                        <div className="flex items-center justify-between gap-2"><span className="event-link-chip">Likely linked investigation</span><span className="text-[10px] uppercase text-[color:var(--shell-muted)]">{event.severity}</span></div>
                        <div className="mt-2 text-sm font-semibold text-[color:var(--shell-ink)]">{event.title}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[color:var(--shell-muted)]">{event.relationship.replace(/_/g, " ")}</div>
                        {event.rationale && <div className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]"><strong className="font-semibold text-[color:var(--shell-ink)]">Why shown:</strong> {event.rationale}</div>}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="event-caution flex gap-2 rounded-lg border p-3 text-xs leading-5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{detail.epistemic_notice}</span></div>
              <div className="flex items-center gap-2 text-xs text-[color:var(--shell-muted)]"><Eye className="h-3.5 w-3.5" />Last activity {dateLabel(detail.event.last_activity_time)}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
