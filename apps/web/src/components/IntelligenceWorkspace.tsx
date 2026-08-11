import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, BellOff, Eye, Layers3, MapPin, RefreshCw, Satellite } from "lucide-react";
import {
  acknowledgeIntelligenceAlert,
  deleteIntelligenceWatch,
  fetchIntelligenceAlerts,
  fetchIntelligenceEvent,
  fetchIntelligenceEvents,
  fetchIntelligenceWatchlist,
  saveIntelligenceWatch,
  type IntelligenceEvent,
  type IntelligenceAlert,
  type IntelligenceEventDetail,
  type IntelligenceSeverity,
  type IntelligenceWatch,
} from "../lib/api";

const severities: Array<IntelligenceSeverity | "all"> = ["all", "critical", "high", "medium", "low"];

function dateLabel(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function confidenceLabel(value: number) {
  return `${Math.round(Number(value) * 100)}%`;
}

export default function IntelligenceWorkspace({ initialCountry }: { initialCountry?: string | null }) {
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntelligenceEventDetail | null>(null);
  const [severity, setSeverity] = useState<IntelligenceSeverity | "all">("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watches, setWatches] = useState<IntelligenceWatch[]>([]);
  const [alerts, setAlerts] = useState<IntelligenceAlert[]>([]);
  const [watchPending, setWatchPending] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, watchRows, alertRows] = await Promise.all([
        fetchIntelligenceEvents({
          limit: 60,
          country: initialCountry || undefined,
          severity: severity === "all" ? undefined : severity,
        }),
        fetchIntelligenceWatchlist(),
        fetchIntelligenceAlerts(),
      ]);
      setEvents(rows);
      setWatches(watchRows);
      setAlerts(alertRows);
      setSelectedId((current) => current && rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [initialCountry, severity]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    fetchIntelligenceEvent(selectedId)
      .then((value) => { if (active) setDetail(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  const evidenceByDomain = useMemo(() => {
    const grouped = new Map<string, IntelligenceEventDetail["evidence"]>();
    for (const item of detail?.evidence ?? []) {
      grouped.set(item.domain, [...(grouped.get(item.domain) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [detail]);

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
      const [watchRows, alertRows] = await Promise.all([fetchIntelligenceWatchlist(), fetchIntelligenceAlerts()]);
      setWatches(watchRows);
      setAlerts(alertRows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWatchPending(false);
    }
  };

  const openAlert = async (alert: IntelligenceAlert) => {
    setSelectedId(alert.event_id);
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
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">Shared event graph</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">Evidence-led intelligence events</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--shell-muted)]">
              Reported, observed, derived, and assessed signals stay separately labelled. Correlation indicates supporting context, not causation.
            </p>
          </div>
          <button type="button" onClick={() => void loadEvents()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {severities.map((value) => (
            <button key={value} type="button" onClick={() => setSeverity(value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${severity === value ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-[color:var(--shell-bg)]" : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"}`}>
              {value}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

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

      <div className="grid min-h-[34rem] gap-4 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.28fr)]">
        <section className="app-card overflow-hidden rounded-xl">
          <div className="border-b border-[color:var(--shell-border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Prioritized stream · {events.length}</div>
          <div className="max-h-[68vh] overflow-y-auto">
            {!loading && events.length === 0 && <div className="p-6 text-sm text-[color:var(--shell-muted)]">No events meet this scope. Source dashboards and ingestion continue normally.</div>}
            {events.map((event) => (
              <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className={`w-full border-b border-[color:var(--shell-border)] p-4 text-left transition ${selectedId === event.id ? "bg-[color:var(--signal-sky-soft)]" : "hover:bg-[color:var(--shell-bg)]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">{event.event_type.replace(/_/g, " ")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${event.severity === "critical" ? "bg-rose-100 text-rose-700" : event.severity === "high" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{event.severity}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-[color:var(--shell-ink)]">{event.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--shell-muted)]">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{event.location_name || event.primary_country_iso2 || "Global"}</span>
                  <span>{event.evidence_count} evidence</span><span>{dateLabel(event.last_activity_time)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="app-card rounded-xl p-4 sm:p-5">
          {detailLoading && <div className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading evidence graph</div>}
          {!detailLoading && !detail && <div className="flex h-48 items-center justify-center text-sm text-[color:var(--shell-muted)]">Select an event to inspect its evidence.</div>}
          {!detailLoading && detail && (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]"><span className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 uppercase">{detail.event.status}</span><span>{confidenceLabel(detail.event.confidence)} confidence</span><span>{detail.event.source_diversity} sources</span><span>{detail.event.domain_count} domains</span></div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3"><h2 className="text-2xl font-semibold text-[color:var(--shell-ink)]">{detail.event.title}</h2>{watchTarget && <button type="button" disabled={watchPending} onClick={() => void toggleWatch()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50">{activeWatch ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}{activeWatch ? "Stop watching" : `Watch ${watchTarget.key}`}</button>}</div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--shell-muted)]">{detail.event.summary}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[['Relevance', detail.event.relevance_score], ['Urgency', detail.event.urgency_score], ['Materiality', detail.event.materiality_score]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-[color:var(--shell-border)] p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">{label}</div><div className="mt-1 text-lg font-semibold text-[color:var(--shell-ink)]">{confidenceLabel(Number(value))}</div></div>)}
                </div>
              </div>

              {detail.earth_observations.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--shell-ink)]"><Satellite className="h-4 w-4" />Earth observation context</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {detail.earth_observations.slice(0, 4).map((observation) => {
                      const asset = observation.assets?.find((item) => item.asset_type === "preview") ?? observation.assets?.[0];
                      return <article key={observation.id} className="overflow-hidden rounded-lg border border-[color:var(--shell-border)]">
                        {asset && <img src={asset.url} alt={`${observation.product_type} observation at ${observation.location_name || "event location"}`} className="aspect-video w-full bg-slate-100 object-cover" loading="lazy" />}
                        <div className="p-3 text-xs text-[color:var(--shell-muted)]"><div className="font-semibold text-[color:var(--shell-ink)]">{observation.product_type.replace(/_/g, " ")} · {observation.mission}</div><div className="mt-1">Captured {dateLabel(observation.capture_start)}{observation.cloud_cover == null ? "" : ` · ${Math.round(observation.cloud_cover)}% cloud`}</div><a href={observation.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[color:var(--signal-sky)]">Provider record</a></div>
                      </article>;
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--shell-ink)]"><Layers3 className="h-4 w-4" />Evidence by domain</div>
                <div className="space-y-3">
                  {evidenceByDomain.map(([domain, items]) => <details key={domain} open className="rounded-lg border border-[color:var(--shell-border)] p-3"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-ink)]">{domain.replace(/_/g, " ")} · {items.length}</summary><div className="mt-3 space-y-2">{items.map((item) => <div key={item.id} className="rounded-lg bg-[color:var(--shell-bg)] p-3 text-xs text-[color:var(--shell-muted)]"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-[color:var(--shell-ink)]">{item.evidence_type.replace(/_/g, " ")} · {item.relationship.replace(/_/g, " ")}</span><span>{confidenceLabel(item.confidence)} confidence</span></div><div className="mt-1">{item.source_name || item.source_record_type} · {dateLabel(item.observed_at)}</div>{item.attribution && <div className="mt-1">Attribution: {item.attribution}</div>}</div>)}</div></details>)}
                </div>
              </div>

              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{detail.epistemic_notice}</span></div>
              <div className="flex items-center gap-2 text-xs text-[color:var(--shell-muted)]"><Eye className="h-3.5 w-3.5" />Last activity {dateLabel(detail.event.last_activity_time)}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
