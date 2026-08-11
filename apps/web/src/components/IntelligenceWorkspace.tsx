import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  ExternalLink,
  Eye,
  ImageOff,
  Link2,
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
    className: "border-sky-200 bg-sky-50 text-sky-800",
  },
  observed: {
    label: "Observed",
    explanation: "A sensor or official observation recorded this signal.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  corroborates: {
    label: "Corroborates",
    explanation: "This independently supports part of the event assessment.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  derived: {
    label: "Derived",
    explanation: "Claritas calculated this from source data using a stated method.",
    className: "border-violet-200 bg-violet-50 text-violet-800",
  },
  model_interpretation: {
    label: "Model interpretation",
    explanation: "A model interpreted supplied evidence; this is not an independent observation.",
    className: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  },
  assessment: {
    label: "Assessment",
    explanation: "Claritas synthesized the evidence into an explicitly qualified assessment.",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  contradicts: {
    label: "Contradicts",
    explanation: "This evidence conflicts with part of the current assessment.",
    className: "border-rose-200 bg-rose-50 text-rose-800",
  },
  context: {
    label: "Context",
    explanation: "This is relevant background, not proof of cause or impact.",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
};

function dateLabel(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
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
  if (severity === "critical") return "bg-rose-100 text-rose-700";
  if (severity === "high") return "bg-amber-100 text-amber-700";
  if (severity === "medium") return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-700";
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
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [watches, setWatches] = useState<IntelligenceWatch[]>([]);
  const [alerts, setAlerts] = useState<IntelligenceAlert[]>([]);
  const [watchPending, setWatchPending] = useState(false);

  const selectEvent = useCallback((eventId: string) => {
    setDetail(null);
    setDetailError(null);
    setSelectedId(eventId);
    onSelectEvent?.(eventId);
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
  }, [initialCountry, initialEventId, severity]);

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
  const gibsTrueColor = gibsContext?.layers.find((layer) => (
    layer.category === "true_color" && Boolean(layer.preview_url)
  ));

  const watchTarget = detail?.event.primary_country_iso2
    ? { type: "country", key: detail.event.primary_country_iso2 }
    : detail ? { type: "event_type", key: detail.event.event_type } : null;
  const activeWatch = watchTarget
    ? watches.find((watch) => watch.watch_type === watchTarget.type && watch.watch_key === watchTarget.key)
    : undefined;

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
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">Signal Desk · shared event graph</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">Investigate the event, then trace every source</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--shell-muted)]">
              News, official observations, transport, markets, and satellite context are organized as one time-ordered evidence thread. Relationship labels distinguish reporting from observation and analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenImagery && (
              <button type="button" onClick={() => onOpenImagery(selectedId ?? undefined)} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]">
                <Satellite className="h-4 w-4" /> Imagery library
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
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

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
          <div className="border-b border-[color:var(--shell-border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Prioritized investigations · {events.length}</div>
          <div className="max-h-[72vh] overflow-y-auto">
            {!loading && events.length === 0 && <div className="p-6 text-sm text-[color:var(--shell-muted)]">No events meet this scope. Source explorers remain available without implying a cross-domain connection.</div>}
            {events.map((event) => (
              <button key={event.id} type="button" onClick={() => selectEvent(event.id)} aria-current={selectedId === event.id ? "true" : undefined} className={`w-full border-b border-[color:var(--shell-border)] p-4 text-left transition ${selectedId === event.id ? "bg-[color:var(--signal-sky-soft)]" : "hover:bg-[color:var(--shell-bg)]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{event.event_type.replace(/_/g, " ")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${severityClass(event.severity)}`}>{event.severity}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-[color:var(--shell-ink)]">{event.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--shell-muted)]">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{event.location_name || event.primary_country_iso2 || "Global"}</span>
                  <span>{event.domain_count} domains</span><span>{event.evidence_count} evidence</span>
                  {event.earth_observation_available && <span className="inline-flex items-center gap-1"><Satellite className="h-3 w-3" />Imagery</span>}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="app-card rounded-xl p-4 sm:p-5" aria-label="Selected event investigation">
          {detailLoading && <div className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading evidence thread</div>}
          {!detailLoading && detailError && <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-5 text-center text-sm text-rose-700"><span>Unable to load this event’s evidence thread: {detailError}</span><button type="button" onClick={() => setDetailRetry((value) => value + 1)} className="rounded-full border border-rose-300 px-3 py-1.5 text-xs font-semibold">Retry event</button></div>}
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
                    <h2 className="text-2xl font-semibold text-[color:var(--shell-ink)]">{detail.event.title}</h2>
                    <div className="mt-2 flex items-center gap-2 text-xs text-[color:var(--shell-muted)]"><MapPin className="h-3.5 w-3.5" />{detail.event.location_name || detail.event.primary_country_iso2 || "Global"} · Active {dateLabel(detail.event.last_activity_time)}</div>
                  </div>
                  {watchTarget && <button type="button" disabled={watchPending} onClick={() => void toggleWatch()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50">{activeWatch ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}{activeWatch ? "Stop watching" : `Watch ${watchTarget.key}`}</button>}
                </div>
              </header>

              <section className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-4" aria-labelledby="why-it-matters">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Sparkles className="h-3.5 w-3.5" /><span id="why-it-matters">Why this matters</span></div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--shell-ink)]">{detail.event.summary}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[["Relevance", detail.event.relevance_score], ["Urgency", detail.event.urgency_score], ["Materiality", detail.event.materiality_score]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">{label}</div><div className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">{confidenceLabel(Number(value))}</div></div>)}
                </div>
              </section>

              <section aria-labelledby="evidence-thread-heading">
                <div className="flex items-end justify-between gap-3">
                  <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">Red thread</div><h3 id="evidence-thread-heading" className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">Evidence in chronological order</h3></div>
                  <span className="text-xs text-[color:var(--shell-muted)]">{evidenceThread.length} items · {detail.event.domain_count} domains</span>
                </div>
                <ol className="mt-4 space-y-3 border-l border-[color:var(--shell-border)] pl-4">
                  {evidenceThread.map((item) => {
                    const relationship = relationshipLabels[item.relationship] ?? relationshipLabels.context;
                    const sourceUrl = evidenceUrl(item);
                    const summary = evidenceSummary(item);
                    return (
                      <li key={item.id} className="relative rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-4 before:absolute before:-left-[1.31rem] before:top-5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-[color:var(--shell-surface)] before:bg-[color:var(--signal-sky)]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span title={relationship.explanation} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${relationship.className}`}>{relationship.label}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{item.domain.replace(/_/g, " ")}</span>
                          <span className="ml-auto text-[10px] text-[color:var(--shell-muted)]">{dateLabel(item.observed_at)}</span>
                        </div>
                        <h4 className="mt-2 text-sm font-semibold capitalize text-[color:var(--shell-ink)]">{evidenceTitle(item)}</h4>
                        {summary && <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">{summary}</p>}
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
                  <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]"><Satellite className="h-3.5 w-3.5" /><span id="satellite-context-heading">Satellite evidence</span></div><p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--shell-muted)]">Imagery can confirm physical change, extent, or environmental conditions at the event location. It does not establish cause by itself.</p></div>
                  {onOpenImagery && <button type="button" onClick={() => onOpenImagery(detail.event.id)} className="rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]">Inspect event imagery</button>}
                </div>
                {gibsTrueColor && (
                  <article className="mt-3 grid overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] sm:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)]" aria-label="NASA GIBS true-color event context">
                    <SatelliteImage
                      sources={[gibsTrueColor.preview_url]}
                      alt={`NASA GIBS true-color context for ${detail.event.location_name || detail.event.primary_country_iso2 || "the event location"} on ${gibsTrueColor.date}`}
                      className="aspect-video h-full w-full bg-slate-100 object-cover"
                      fallbackClassName="flex aspect-video h-full w-full items-center justify-center bg-slate-900"
                    />
                    <div className="p-3 text-xs text-[color:var(--shell-muted)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">Context · not proof</span>
                        <span>{gibsTrueColor.date}</span>
                      </div>
                      <div className="mt-2 font-semibold text-[color:var(--shell-ink)]">{gibsTrueColor.title}</div>
                      <p className="mt-1 leading-5">{gibsContext?.notice || "NASA GIBS browse imagery is contextual and is not proof of physical change or causation."}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{gibsTrueColor.provenance.attribution}</span>
                        <a href={gibsTrueColor.provenance.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[color:var(--signal-sky)]">NASA GIBS provenance <ExternalLink className="h-3 w-3" /></a>
                      </div>
                    </div>
                  </article>
                )}
                {detail.earth_observations.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {detail.earth_observations.slice(0, 4).map((observation) => {
                      const asset = observation.assets?.find((item) => item.asset_type === "preview") ?? observation.assets?.[0];
                      return <article key={observation.id} className="overflow-hidden rounded-lg border border-[color:var(--shell-border)]">
                        {asset ? <SatelliteImage sources={[asset.url, gibsTrueColor?.preview_url]} alt={`${observation.product_type} observation at ${observation.location_name || "event location"}`} className="aspect-video w-full bg-slate-100 object-cover" fallbackClassName="flex aspect-video items-center justify-center bg-slate-900" /> : <div className="flex aspect-video items-center justify-center bg-slate-100"><ImageOff className="h-6 w-6 text-slate-400" /></div>}
                        <div className="p-3 text-xs text-[color:var(--shell-muted)]"><div className="font-semibold capitalize text-[color:var(--shell-ink)]">{observation.product_type.replace(/_/g, " ")} · {observation.mission}</div><div className="mt-1">Captured {dateLabel(observation.capture_start)}{observation.cloud_cover == null ? "" : ` · ${Math.round(observation.cloud_cover)}% cloud`}</div>{observation.analysis_summary && <p className="mt-2 leading-5">{observation.analysis_summary}</p>}<a href={observation.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[color:var(--signal-sky)]">Provider provenance <ExternalLink className="h-3 w-3" /></a></div>
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
                <section aria-labelledby="related-events-heading"><h3 id="related-events-heading" className="text-sm font-semibold text-[color:var(--shell-ink)]">Related investigations</h3><p className="mt-1 text-xs text-[color:var(--shell-muted)]">Relationships are qualified context, not asserted causation.</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.related_events.map((event) => <button key={`${event.id}-${event.relationship}`} type="button" onClick={() => selectEvent(event.id)} className="rounded-lg border border-[color:var(--shell-border)] p-3 text-left hover:bg-[color:var(--shell-bg)]"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase text-[color:var(--shell-muted)]">{event.relationship.replace(/_/g, " ")}</span><span className="text-[10px] uppercase text-[color:var(--shell-muted)]">{event.severity}</span></div><div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">{event.title}</div>{event.rationale && <div className="mt-1 text-xs text-[color:var(--shell-muted)]">{event.rationale}</div>}</button>)}</div></section>
              )}

              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{detail.epistemic_notice}</span></div>
              <div className="flex items-center gap-2 text-xs text-[color:var(--shell-muted)]"><Eye className="h-3.5 w-3.5" />Last activity {dateLabel(detail.event.last_activity_time)}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
