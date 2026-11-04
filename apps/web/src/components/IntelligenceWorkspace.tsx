import CountryFlag from "./CountryFlag";
import EventVisualContext from "./EventVisualContext";
import ContextImageGallery from "./ContextImageGallery";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  ExternalLink,
  Eye,
  ImageOff,
  Mail,
  MapPin,
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
import EventConnections from "./EventConnections";
import { eventOrigin, sourceFamilyLabel } from "./eventSourcePresentation";
import { presentEvent } from "./eventPresentation";
import HeadlineTranslation from "./HeadlineTranslation";
import { displayHeadline, translationStatusLabel } from "../lib/headlineTranslation";

const severities: Array<IntelligenceSeverity | "all"> = ["all", "critical", "high", "medium", "low"];

type Props = {
  embedded?: boolean;
  refreshVersion?: string | number;
  onEventLoaded?: (event: IntelligenceEvent) => void;
  initialCountry?: string | null;
  initialEventId?: string | null;
  onSelectEvent?: (eventId: string | null) => void;
  onOpenImagery?: (eventId?: string) => void;
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
  return displayHeadline(item, item.source_title
    || item.title
    || recordString(item.metadata, "original_title")
    || recordString(item.metadata, "headline")
    || item.evidence_type.replace(/_/g, " "));
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

const contextStatusLabels: Record<string, string> = {
  no_local_sample: "No local weather coverage",
  comparison_pending: "Transport comparison pending",
  no_nearby_coverage: "No nearby transport coverage",
  insufficient_comparable_coverage: "Insufficient nearby transport coverage",
};

function contextStatus(item: IntelligenceEvidence) {
  const declaredStatus = recordString(item.metadata, "coverage_status")
    ?? recordString(item.metadata, "classification")
    ?? recordString(item.correlation_factors, "coverage_status")
    ?? recordString(item.correlation_factors, "classification");
  if (declaredStatus && contextStatusLabels[declaredStatus]) return declaredStatus;

  // Older event-detail payloads did not always expose assessment metadata.
  // Keep their coverage records out of positive linkage counts by using the
  // governed evidence type and assessment wording as a conservative fallback.
  const evidenceType = item.evidence_type.toLocaleLowerCase();
  const assessmentText = [evidenceTitle(item), evidenceSummary(item)]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  if (evidenceType === "event_area_weather_unavailable") return "no_local_sample";
  if (evidenceType === "event_area_activity_comparison") {
    if (/comparison pending|complete post-event hour/.test(assessmentText)) return "comparison_pending";
    if (/no transport track points|no nearby (transport )?coverage/.test(assessmentText)) return "no_nearby_coverage";
    if (/baseline is too small|insufficient (comparable|nearby).*coverage/.test(assessmentText)) return "insufficient_comparable_coverage";
  }
  return null;
}

function isContextAssessment(item: IntelligenceEvidence) {
  return item.relationship.trim().toLocaleLowerCase() === "assessment" || contextStatus(item) !== null;
}

function severityClass(severity: IntelligenceSeverity) {
  if (severity === "critical") return "event-severity-critical";
  if (severity === "high") return "event-severity-high";
  if (severity === "medium") return "event-severity-medium";
  return "event-severity-low";
}

export default function IntelligenceWorkspace({
  embedded = false,
  refreshVersion,
  onEventLoaded,
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
  const [selectedFamily, setSelectedFamily] = useState("all");
  const [watches, setWatches] = useState<IntelligenceWatch[]>([]);
  const [alerts, setAlerts] = useState<IntelligenceAlert[]>([]);
  const [watchPending, setWatchPending] = useState(false);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const eventScopeRef = useRef<string | null>(null);
  const eventRequestIdRef = useRef(0);
  const selectedIdRef = useRef<string | null>(initialEventId ?? null);

  const selectEvent = useCallback((eventId: string) => {
    setDetail(null);
    setDetailError(null);
    selectedIdRef.current = eventId;
    setSelectedId(eventId);
    onSelectEvent?.(eventId);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1279px)").matches) {
      window.setTimeout(() => {
        detailPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        detailPanelRef.current?.focus?.({ preventScroll: true });
      }, 0);
    }
  }, [onSelectEvent]);

  useEffect(() => {
    if (initialEventId !== undefined) {
      selectedIdRef.current = initialEventId;
      setSelectedId(initialEventId);
    }
  }, [initialEventId]);

  const loadEvents = useCallback(async () => {
    const requestId = eventRequestIdRef.current + 1;
    eventRequestIdRef.current = requestId;
    const scopeKey = `${initialCountry ?? ""}:${severity}:${includeExpired ? "archive" : "current"}`;
    const scopeChanged = eventScopeRef.current !== null && eventScopeRef.current !== scopeKey;
    eventScopeRef.current = scopeKey;
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
      if (eventRequestIdRef.current !== requestId) return;
      setEvents(rows);
      const current = selectedIdRef.current;
      const requested = current ?? initialEventId;
      let nextSelection: string | null;
      if (initialEventId === null) {
        nextSelection = null;
      } else if (requested && rows.some((event) => event.id === requested)) {
        nextSelection = requested;
      } else if (!scopeChanged && requested && requested === initialEventId) {
        // An exact deep link or alert may not be present in the prioritised
        // list. Preserve it until the user changes the visible event scope;
        // filters must never leave hidden detail presented as active.
        nextSelection = requested;
      } else {
        nextSelection = rows[0]?.id ?? null;
      }
      if (nextSelection !== current) {
        selectedIdRef.current = nextSelection;
        setSelectedId(nextSelection);
        onSelectEvent?.(nextSelection);
      }
    } catch (reason) {
      if (eventRequestIdRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (eventRequestIdRef.current === requestId) setLoading(false);
    }
    const [watchResult, alertResult] = await optionalData;
    if (eventRequestIdRef.current !== requestId) return;
    if (watchResult.status === "fulfilled") setWatches(watchResult.value);
    if (alertResult.status === "fulfilled") setAlerts(alertResult.value);
  }, [includeExpired, initialCountry, initialEventId, onSelectEvent, severity]);

  useEffect(() => {
    if (!embedded) void loadEvents();
  }, [embedded, loadEvents]);

  useEffect(() => {
    if (!embedded) return;
    let active = true;
    void fetchIntelligenceWatchlist().then((rows) => {
      if (active) setWatches(rows);
    }).catch(() => { /* Following an event remains optional. */ });
    return () => { active = false; };
  }, [embedded]);

  useEffect(() => { setSelectedFamily("all"); }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    // Keep the same investigation mounted during background updates. This
    // preserves scroll position and decoded images through a slow refresh.
    setDetail((current) => current?.event.id === selectedId ? current : null);
    setDetailError(null);
    setDetailLoading(true);
    fetchIntelligenceEvent(selectedId)
      .then((value) => {
        if (!active) return;
        setDetail(value);
        onEventLoaded?.(value.event);
        setEvents((current) => current.some((event) => event.id === value.event.id)
          ? current
          : [value.event, ...current]);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setDetail((current) => current?.event.id === selectedId ? current : null);
        setDetailError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detailRetry, selectedId, refreshVersion, onEventLoaded]);

  useEffect(() => {
    let active = true;
    setGibsContext((current) => current?.event_id === selectedId ? current : null);
    if (!selectedId) return () => { active = false; };
    fetchEventGibsContext(selectedId)
      .then((value) => { if (active) setGibsContext(value); })
      .catch(() => { if (active) setGibsContext(null); });
    return () => { active = false; };
  }, [selectedId, refreshVersion]);

  const evidenceThread = useMemo(
    () => [...(detail?.evidence ?? [])].sort((left, right) => (
      Date.parse(left.observed_at) - Date.parse(right.observed_at)
    )),
    [detail],
  );
  const linkedReporting = useMemo(
    () => evidenceThread.filter((item) => (
      !isContextAssessment(item)
      && (item.domain.toLocaleLowerCase() === "news"
        || item.source_record_type.toLocaleLowerCase().includes("news")
        || item.evidence_type.toLocaleLowerCase().includes("news"))
    )),
    [evidenceThread],
  );
  const linkedNews = useMemo(() => {
    if (detail?.linked_news) {
      return detail.linked_news.filter((item) => item.relationship.trim().toLocaleLowerCase() !== "assessment");
    }
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
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedId) ?? detail?.event ?? null,
    [detail?.event, events, selectedId],
  );
  const selectedEventPresentation = useMemo(
    () => selectedEvent ? presentEvent(selectedEvent) : null,
    [selectedEvent],
  );

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
    <div className={`workspace-page min-w-0 space-y-4 ${embedded ? "event-context-embedded" : ""}`}>
      {!embedded && <section className="app-card-hero rounded-xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">One event · every source</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">Follow the event across sources</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--shell-muted)]">
              Start with what happened, explore the connected sources, then review the surrounding region. Events can begin with news, earth observation, imagery, transport, podcasts, socials or weather.
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
      </section>}

      {error && <div role="alert" className="event-error rounded-xl border p-4 text-sm">{error}</div>}

      {!embedded && alerts.length > 0 && (
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

      {!embedded && <section className="event-mobile-picker app-card rounded-xl xl:hidden" aria-label="Choose an event investigation">
        <div className="border-b border-[color:var(--shell-border)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-accent-2)]">Investigation navigator</div>
              <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                {selectedEventPresentation ? "Active investigation" : "Choose an event to investigate"}
              </div>
            </div>
            <span className="event-list-selection-status">{events.length} events</span>
          </div>
          <label className="mt-3 block text-xs font-semibold text-[color:var(--shell-muted)]" htmlFor="mobile-investigation-select">
            Event
          </label>
          <select
            id="mobile-investigation-select"
            value={selectedId ?? ""}
            onChange={(event) => {
              const eventId = event.currentTarget.value;
              if (eventId) selectEvent(eventId);
            }}
            className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2.5 text-sm font-semibold text-[color:var(--shell-ink)]"
          >
            <option value="">Select an investigation…</option>
            {events.map((event) => {
              const presentation = presentEvent(event);
              return <option key={event.id} value={event.id}>{presentation.headline} · {event.severity}</option>;
            })}
          </select>
        </div>
        {selectedEvent && selectedEventPresentation && (
          <button
            type="button"
            onClick={() => detailPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
            className="event-mobile-active w-full p-4 text-left"
            aria-controls="selected-event-investigation"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="event-list-active-indicator">Viewing now</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${severityClass(selectedEvent.severity)}`}>{selectedEvent.severity}</span>
            </div>
            <div className="mt-2 text-base font-semibold leading-6 text-[color:var(--shell-ink)]">{selectedEventPresentation.headline}</div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--shell-muted)]">
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{selectedEventPresentation.locationLabel}</span>
              <span>{selectedEvent.evidence_count} linked signals</span>
            </div>
            <div className="mt-3 text-xs font-semibold text-[color:var(--signal-sky)]">Jump to the selected evidence thread ↓</div>
          </button>
        )}
      </section>}

      <div className={embedded ? "min-w-0" : "grid min-h-[34rem] gap-4 xl:grid-cols-[minmax(19rem,0.68fr)_minmax(0,1.32fr)]"}>
        {!embedded && <section className="app-card hidden self-start overflow-hidden rounded-xl xl:sticky xl:top-24 xl:block" aria-label="Prioritized event investigations">
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--shell-border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
            <span>Prioritized investigations · {events.length}</span>
            <span className="event-list-selection-status">{selectedId ? "1 viewing" : "Choose one"}</span>
          </div>
          <div className="overflow-y-auto xl:max-h-[calc(100vh-12rem)]">
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
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /><CountryFlag country={event.primary_country_iso2} />{presentation.locationLabel}</span>
                    <span>{event.evidence_count} linked records</span>{eventOrigin(event) && <span>From {eventOrigin(event)}</span>}
                    {event.earth_observation_available && <span className="inline-flex items-center gap-1 text-[color:var(--signal-emerald)]"><Satellite className="h-3 w-3" />Imagery</span>}
                  </div>
                  <div className="event-source-chips mt-2">{(event.signal_domains ?? []).map((domain) => <span key={domain}>{sourceFamilyLabel(domain)}</span>)}</div>
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
        </section>}

        <section ref={detailPanelRef} id="selected-event-investigation" className="app-card rounded-xl p-4 sm:p-5" aria-label="Selected event investigation" tabIndex={-1}>
          {detailLoading && detail?.event.id !== selectedId && <div role="status" className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading the selected investigation</div>}
          {!detailLoading && detailError && detail?.event.id !== selectedId && <div role="alert" className="event-error flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border p-5 text-center text-sm"><span>Unable to load this event’s evidence thread: {detailError}</span><button type="button" onClick={() => setDetailRetry((value) => value + 1)} className="rounded-full border border-current px-3 py-1.5 text-xs font-semibold">Retry event</button></div>}
          {!detailLoading && !detailError && (!detail || detail.event.id !== selectedId) && <div className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]">Select an event to inspect its evidence thread.</div>}
          {detail?.event.id === selectedId && (
            <div className="space-y-6">
              {detailLoading && <p role="status" className="text-xs text-[color:var(--shell-muted)]">Refreshing this investigation…</p>}
              {!detailLoading && detailError && <div role="alert" className="event-error rounded-lg border p-3 text-xs"><p>Could not refresh this investigation. Showing the last loaded evidence. {detailError}</p><button type="button" onClick={() => setDetailRetry((value) => value + 1)} className="mt-2 rounded-full border border-current px-3 py-1.5 font-semibold">Retry event</button></div>}
              <header>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                  <span className={`rounded-full px-2 py-1 font-semibold uppercase ${severityClass(detail.event.severity)}`}>{detail.event.severity}</span>
                  <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 uppercase">{detail.event.status}</span>
                  <span>{confidenceLabel(detail.event.confidence)} confidence</span>
                  <span>{detail.event.source_diversity} sources</span>{eventOrigin(detail.event) && <span className="event-origin-chip">Started from {eventOrigin(detail.event)}</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-accent)]">{detailPresentation?.typeLabel}</div>
                    <h2 dir="auto" className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">{detailPresentation?.headline}</h2>
                    <HeadlineTranslation value={detail.event} showSummaryNotice />
                    {detailPresentation?.focus && <div className="mt-1 text-xs text-[color:var(--shell-muted)]">Signal focus · {detailPresentation.focus}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--shell-muted)]"><span className="inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /><CountryFlag country={detail.event.primary_country_iso2} />{detailPresentation?.locationLabel}</span><span>Started {dateLabel(detail.event.start_time)}</span><span>Updated {dateLabel(detail.event.last_activity_time)}</span>{detail.event.expires_at && <span className={detail.event.freshness_state === "expired" ? "text-[color:var(--signal-coral)]" : ""}>{detail.event.freshness_state === "expired" ? "Expired" : "Current until"} {dateLabel(detail.event.expires_at)}</span>}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {watchTarget && <button type="button" disabled={watchPending} onClick={() => void toggleWatch()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50">{activeWatch ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}{activeWatch ? "Stop watching" : `Watch ${watchTarget.key}`}</button>}
                    {activeWatch && <button type="button" disabled={watchPending} onClick={() => void toggleWatchEmail()} aria-pressed={watchEmailEnabled} title="Requires a verified account email and email delivery enabled in your briefing profile." className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${watchEmailEnabled ? "border-[color:var(--shell-accent-2)] bg-[color:var(--signal-emerald-soft)] text-[color:var(--shell-ink)]" : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"}`}><Mail className="h-3.5 w-3.5" />Email important events · {watchEmailEnabled ? "On" : "Off"}</button>}
                  </div>
                </div>
              </header>

              <section className="event-situation-brief rounded-xl border border-[color:var(--shell-border)] p-4" aria-labelledby="situation-brief-heading">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Sparkles className="h-3.5 w-3.5 text-[color:var(--shell-accent)]" /><span id="situation-brief-heading">1 · Understand the event</span></div>
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
                    <p>{linkedNews.length} linked {linkedNews.length === 1 ? "report" : "reports"} · {detail.understanding?.physical_observation_count ?? displayedEarthObservations.length} physical {(detail.understanding?.physical_observation_count ?? displayedEarthObservations.length) === 1 ? "observation" : "observations"}.</p>
                  </article>
                </div>
                {detail.event.priority_reasons?.length ? <div className="event-priority-reasons"><strong>Why this event is prioritised</strong><ul>{detail.event.priority_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>Priority describes attention and potential impact. Confidence describes the evidence; related background and unverified claims do not establish confirmation.</p></div> : null}
                <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-border)]">
                  {[["Relevance", detail.event.relevance_score], ["Urgency", detail.event.urgency_score], ["Materiality", detail.event.materiality_score]].map(([label, value]) => <div key={String(label)} className="bg-[color:var(--shell-surface)] p-3"><div className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{label}</div><div className="mt-1 text-base font-semibold text-[color:var(--shell-ink)]">{confidenceLabel(Number(value))}</div></div>)}
                </div>
              </section>

              <EventVisualContext key={`visual-${detail.event.id}`} detail={detail} showLocationMap={!embedded} onSelectFamily={(family) => {
                setSelectedFamily(family);
                document.getElementById("event-connection-records")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
              }} />
              <ContextImageGallery images={detail.context_images ?? []} onOpenEvent={selectEvent} />
              <EventConnections key={`connections-${detail.event.id}`} detail={detail} selectedFamily={selectedFamily} onSelectFamily={setSelectedFamily} onOpenImagery={onOpenImagery} />

              <details open={Boolean(gibsTrueColor || displayedEarthObservations.length)} id="event-imagery-assessment" className="event-imagery-disclosure rounded-xl border border-[color:var(--shell-border)] p-4">
                <summary>Imagery assessment · {satelliteAssessment}</summary>
                <div className="mt-4">
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
                </div>
              </details>

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
                        {translationStatusLabel(event) && <div className="mt-1 text-xs text-[color:var(--shell-muted)]">{translationStatusLabel(event)}</div>}
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
