import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, ExternalLink, ImageOff, RefreshCw, Satellite } from "lucide-react";
import {
  fetchEarthObservations,
  requestEarthObservationComparison,
  type EarthObservation,
  type EarthProviderStatus,
} from "../lib/api";

function dateLabel(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function preview(observation: EarthObservation | undefined) {
  return observation?.assets?.find((asset) => asset.asset_type === "preview") ?? observation?.assets?.[0];
}

export default function EarthObservationWorkspace() {
  const [observations, setObservations] = useState<EarthObservation[]>([]);
  const [providers, setProviders] = useState<EarthProviderStatus[]>([]);
  const [provider, setProvider] = useState("all");
  const [product, setProduct] = useState("all");
  const [slider, setSlider] = useState(50);
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEarthObservations({ limit: 60, provider: provider === "all" ? undefined : provider, product: product === "all" ? undefined : product });
      setObservations(data.observations);
      setProviders(data.providers);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [product, provider]);

  useEffect(() => { void load(); }, [load]);

  const products = useMemo(() => [...new Set(observations.map((item) => item.product_type))].sort(), [observations]);
  const comparePair = useMemo(() => {
    const withAssets = observations.filter((item) => preview(item));
    if (withAssets.length < 2) return null;
    const after = withAssets[0];
    const before = withAssets.find((item) => item.id !== after.id && item.location_id === after.location_id && item.product_type === after.product_type) ?? withAssets[1];
    return { before, after };
  }, [observations]);

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
          <div><div className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">Governed observation layer</div><h1 className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">Earth observation context</h1><p className="mt-2 max-w-3xl text-sm text-[color:var(--shell-muted)]">Bounded areas of interest, ranked scenes, explicit acquisition quality, and reproducible provider provenance. Imagery is contextual evidence, not automatic proof of cause.</p></div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-sm text-[color:var(--shell-ink)]"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="text-xs text-[color:var(--shell-muted)]">Provider<select value={provider} onChange={(event) => setProvider(event.target.value)} className="ml-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1.5 text-[color:var(--shell-ink)]"><option value="all">All</option>{providers.map((item) => <option key={item.provider} value={item.provider}>{item.provider}</option>)}</select></label>
          <label className="text-xs text-[color:var(--shell-muted)]">Product<select value={product} onChange={(event) => setProduct(event.target.value)} className="ml-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1.5 text-[color:var(--shell-ink)]"><option value="all">All</option>{products.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {providers.map((item) => <div key={item.provider} className="app-card rounded-xl p-4"><div className="flex items-center justify-between gap-2"><div className="font-semibold capitalize text-[color:var(--shell-ink)]">{item.provider.replace(/_/g, " ")}</div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${item.state === "ready" ? "bg-emerald-100 text-emerald-700" : item.state === "disabled" || item.state === "not_configured" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>{item.state.replace(/_/g, " ")}</span></div><div className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{item.reason || item.attribution}{item.last_success_at ? ` · Last success ${dateLabel(item.last_success_at)}` : ""}</div></div>)}
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {comparePair && preview(comparePair.before) && preview(comparePair.after) && (
        <section className="app-card rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[color:var(--shell-ink)]">Before / after context</div><div className="mt-1 text-xs text-[color:var(--shell-muted)]">{comparePair.after.location_name || "Monitored location"} · {comparePair.after.product_type.replace(/_/g, " ")}</div></div><div className="text-xs text-[color:var(--shell-muted)]">{String(comparison?.status ?? "comparison checking").replace(/_/g, " ")}</div></div>
          <div className="relative mt-4 aspect-[16/7] overflow-hidden rounded-xl bg-slate-100">
            <img src={preview(comparePair.before)?.url} alt={`Before observation captured ${dateLabel(comparePair.before.capture_start)}`} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-y-0 left-0 overflow-hidden border-r-2 border-white" style={{ width: `${slider}%` }}><img src={preview(comparePair.after)?.url} alt={`After observation captured ${dateLabel(comparePair.after.capture_start)}`} className="h-full max-w-none object-cover" style={{ width: "calc(100vw - 2rem)", minWidth: "100%" }} /></div>
            <span className="absolute bottom-3 left-3 rounded-full bg-slate-950/75 px-3 py-1 text-xs text-white">After · {dateLabel(comparePair.after.capture_start)}</span><span className="absolute bottom-3 right-3 rounded-full bg-slate-950/75 px-3 py-1 text-xs text-white">Before · {dateLabel(comparePair.before.capture_start)}</span>
          </div>
          <input aria-label="Before and after comparison position" type="range" min="0" max="100" value={slider} onChange={(event) => setSlider(Number(event.target.value))} className="mt-3 w-full accent-slate-800" />
          <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{String(comparison?.notice ?? "Acquisition time, sensor, cloud, season, and viewing geometry can produce apparent differences.")}</p>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!loading && observations.length === 0 && <div className="app-card col-span-full rounded-xl p-8 text-center"><ImageOff className="mx-auto h-7 w-7 text-[color:var(--shell-muted)]" /><div className="mt-3 text-sm font-semibold text-[color:var(--shell-ink)]">No observation assets in this scope</div><p className="mt-1 text-xs text-[color:var(--shell-muted)]">Core intelligence remains available while optional providers are disabled, rate limited, or waiting for a suitable scene.</p></div>}
        {observations.map((item) => { const asset = preview(item); return <article key={item.id} className="app-card overflow-hidden rounded-xl">{asset ? <img src={asset.url} alt={`${item.product_type.replace(/_/g, " ")} observation of ${item.location_name || "monitored area"}`} className="aspect-video w-full bg-slate-100 object-cover" loading="lazy" /> : <div className="flex aspect-video items-center justify-center bg-slate-100"><ImageOff className="h-7 w-7 text-slate-400" /></div>}<div className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[color:var(--shell-ink)]">{item.location_name || "Monitored area"}</div><div className="mt-1 text-xs capitalize text-[color:var(--shell-muted)]">{item.product_type.replace(/_/g, " ")} · {item.mission}</div></div><Satellite className="h-4 w-4 text-[color:var(--signal-sky)]" /></div><div className="mt-3 space-y-1 text-xs text-[color:var(--shell-muted)]"><div>Captured {dateLabel(item.capture_start)}</div><div className="flex items-center gap-1"><Cloud className="h-3 w-3" />{item.cloud_cover == null ? "Cloud cover not reported" : `${Math.round(item.cloud_cover)}% cloud cover`}{item.resolution_m == null ? "" : ` · ${item.resolution_m} m`}</div><div>{item.provider} · {item.collection}</div></div><a href={item.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--signal-sky)]">Provider provenance <ExternalLink className="h-3 w-3" /></a></div></article>; })}
      </section>
    </div>
  );
}
