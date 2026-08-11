import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, ExternalLink, ImageOff, Link2, RefreshCw, Satellite } from "lucide-react";
import {
  fetchEarthObservations,
  requestEarthObservationComparison,
  type EarthObservation,
  type EarthProviderStatus,
} from "../lib/api";
import { findDefensibleComparisonPair } from "./earthObservationComparison";
import SatelliteImage from "./SatelliteImage";
import {
  earthObservationProductLabel,
  isAnalyticalEarthProduct,
  sortEarthObservationsForDisplay,
} from "./earthObservationPresentation";

type Props = {
  eventId?: string | null;
  locationId?: string | null;
  onOpenEvent?: (eventId: string) => void;
};

function dateLabel(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function preview(observation: EarthObservation | undefined) {
  return observation?.assets?.find((asset) => asset.asset_type === "preview") ?? observation?.assets?.[0];
}

export default function EarthObservationWorkspace({ eventId, locationId, onOpenEvent }: Props) {
  const [observations, setObservations] = useState<EarthObservation[]>([]);
  const [providers, setProviders] = useState<EarthProviderStatus[]>([]);
  const [provider, setProvider] = useState("all");
  const [product, setProduct] = useState("all");
  const [slider, setSlider] = useState(50);
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEarthObservations({
        limit: 60,
        eventId: eventId || undefined,
        locationId: eventId ? undefined : locationId || undefined,
      });
      setObservations(data.observations);
      setProviders(data.providers);
      setProviderNotice(data.provider_notice ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [eventId, locationId]);

  useEffect(() => { void load(); }, [load]);

  const products = useMemo(() => [...new Set(observations.map((item) => item.product_type))].sort(), [observations]);
  const visibleObservations = useMemo(() => sortEarthObservationsForDisplay(
    observations.filter((item) => (
      (provider === "all" || item.provider === provider)
      && (product === "all" || item.product_type === product)
    )),
  ), [observations, product, provider]);
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
    requestEarthObservationComparison(comparePair.after.id)
      .then((value) => { if (active) setComparison(value); })
      .catch(() => { if (active) setComparison(null); });
    return () => { active = false; };
  }, [comparePair]);

  return (
    <div className="workspace-page min-w-0 space-y-4">
      <section className="app-card-hero rounded-xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">Evidence library · governed observation layer</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">{eventId ? "Imagery for the selected investigation" : locationId ? "Imagery for the selected location" : "Earth observation evidence library"}</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--shell-muted)]">
              Satellite imagery is most useful inside an event investigation: it can show physical change, extent, and conditions around a known time and place. It does not prove cause by itself.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="text-xs text-[color:var(--shell-muted)]">Provider<select value={provider} onChange={(event) => setProvider(event.target.value)} className="ml-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1.5 text-[color:var(--shell-ink)]"><option value="all">All</option>{providers.map((item) => <option key={item.provider} value={item.provider}>{item.provider.replace(/_/g, " ")}</option>)}</select></label>
          <label className="text-xs text-[color:var(--shell-muted)]">Product<select value={product} onChange={(event) => setProduct(event.target.value)} className="ml-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1.5 text-[color:var(--shell-ink)]"><option value="all">All</option>{products.map((item) => <option key={item} value={item}>{earthObservationProductLabel(item)}</option>)}</select></label>
          {eventId && onOpenEvent && <button type="button" onClick={() => onOpenEvent(eventId)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]"><Link2 className="h-3.5 w-3.5" />Back to event thread</button>}
        </div>
      </section>

      {!eventId && !locationId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Library mode shows governed source assets. Claritas only offers a before/after comparison when two observations share the same event or unassigned location, product, and provider, with a valid chronological order.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Earth observation provider status">
        {providers.map((item) => <div key={item.provider} className="app-card rounded-xl p-4"><div className="flex items-center justify-between gap-2"><div className="font-semibold capitalize text-[color:var(--shell-ink)]">{item.provider.replace(/_/g, " ")}</div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${item.state === "ready" ? "bg-emerald-100 text-emerald-700" : item.state === "disabled" || item.state === "not_configured" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>{item.state.replace(/_/g, " ")}</span></div><div className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{item.reason || item.attribution}{item.last_success_at ? ` · Last success ${dateLabel(item.last_success_at)}` : ""}</div></div>)}
      </section>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {comparePair && preview(comparePair.before) && preview(comparePair.after) && (
        <section className="app-card rounded-xl p-4 sm:p-5" aria-label="Defensible before and after comparison">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[color:var(--shell-ink)]">Before / after evidence</div><div className="mt-1 text-xs text-[color:var(--shell-muted)]">{comparePair.after.location_name || "Monitored location"} · same {comparePair.after.provider.replace(/_/g, " ")} provider and {comparePair.after.product_type.replace(/_/g, " ")} product</div></div><div className="text-xs text-[color:var(--shell-muted)]">{String(comparison?.status ?? "comparison checking").replace(/_/g, " ")}</div></div>
          <div className="relative mt-4 aspect-[16/7] overflow-hidden rounded-xl bg-slate-100">
            <SatelliteImage sources={[preview(comparePair.before)?.url]} alt={`Before observation captured ${dateLabel(comparePair.before.capture_start)}`} className="absolute inset-0 h-full w-full object-cover" fallbackClassName="absolute inset-0 flex items-center justify-center bg-slate-900" />
            <div className="absolute inset-y-0 left-0 overflow-hidden border-r-2 border-white" style={{ width: `${slider}%` }}><SatelliteImage sources={[preview(comparePair.after)?.url]} alt={`After observation captured ${dateLabel(comparePair.after.capture_start)}`} className="h-full max-w-none object-cover" fallbackClassName="flex h-full min-w-full items-center justify-center bg-slate-800" style={{ width: "calc(100vw - 2rem)", minWidth: "100%" }} /></div>
            <span className="absolute bottom-3 left-3 rounded-full bg-slate-950/75 px-3 py-1 text-xs text-white">After · {dateLabel(comparePair.after.capture_start)}</span><span className="absolute bottom-3 right-3 rounded-full bg-slate-950/75 px-3 py-1 text-xs text-white">Before · {dateLabel(comparePair.before.capture_start)}</span>
          </div>
          <input aria-label="Before and after comparison position" type="range" min="0" max="100" value={slider} onChange={(event) => setSlider(Number(event.target.value))} className="mt-3 w-full accent-slate-800" />
          <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{String(comparison?.notice ?? "Acquisition time, sensor, cloud, season, and viewing geometry can produce apparent differences.")}</p>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Earth observation assets">
        {!loading && visibleObservations.length === 0 && <div className="app-card col-span-full rounded-xl p-8 text-center"><ImageOff className="mx-auto h-7 w-7 text-[color:var(--shell-muted)]" /><div className="mt-3 text-sm font-semibold text-[color:var(--shell-ink)]">No event-specific observation assets in this scope</div><p className="mt-1 text-xs text-[color:var(--shell-muted)]">{providerNotice || "The investigation remains available while providers wait for a suitable, defensible scene."}</p></div>}
        {visibleObservations.map((item) => {
          const asset = preview(item);
          const analytical = isAnalyticalEarthProduct(item.product_type);
          return <article key={item.id} className="app-card overflow-hidden rounded-xl">{asset ? <SatelliteImage sources={[asset.url]} alt={`${earthObservationProductLabel(item.product_type)} observation of ${item.location_name || "monitored area"}`} className={`aspect-video w-full bg-slate-950 ${analytical ? "object-contain" : "object-cover"}`} fallbackClassName="flex aspect-video items-center justify-center bg-slate-900" /> : <div className="flex aspect-video items-center justify-center bg-slate-100"><ImageOff className="h-7 w-7 text-slate-400" /></div>}<div className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[color:var(--shell-ink)]">{item.location_name || "Monitored area"}</div><div className="mt-1 text-xs text-[color:var(--shell-muted)]">{earthObservationProductLabel(item.product_type)} · {item.mission}</div>{analytical && <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">Analytical layer · not natural color</div>}</div><Satellite className="h-4 w-4 text-[color:var(--signal-sky)]" /></div><div className="mt-3 space-y-1 text-xs text-[color:var(--shell-muted)]"><div>Captured {dateLabel(item.capture_start)}</div><div className="flex items-center gap-1"><Cloud className="h-3 w-3" />{item.cloud_cover == null ? "Cloud cover not reported" : `${Math.round(item.cloud_cover)}% cloud cover`}{item.resolution_m == null ? "" : ` · ${item.resolution_m} m`}</div><div>{item.provider} · {item.collection}</div></div><div className="mt-3 flex flex-wrap gap-3"><a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--signal-sky)]">Provider provenance <ExternalLink className="h-3 w-3" /></a>{item.event_id && onOpenEvent && <button type="button" onClick={() => onOpenEvent(item.event_id as string)} className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--signal-sky)]">Open event thread <Link2 className="h-3 w-3" /></button>}</div></div></article>;
        })}
      </section>
    </div>
  );
}
