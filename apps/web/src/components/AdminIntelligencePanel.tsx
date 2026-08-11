import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Play, RefreshCw, RotateCcw } from "lucide-react";
import {
  fetchIntelligenceAdminStatus,
  fetchIntelligenceLocations,
  retryEarthObservationJob,
  runIntelligenceProvider,
  type IntelligenceAdminStatus,
  type IntelligenceLocation,
} from "../lib/api";

export default function AdminIntelligencePanel() {
  const [status, setStatus] = useState<IntelligenceAdminStatus | null>(null);
  const [locations, setLocations] = useState<IntelligenceLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextLocations] = await Promise.all([
        fetchIntelligenceAdminStatus(),
        fetchIntelligenceLocations({ limit: 100 }),
      ]);
      setStatus(nextStatus);
      setLocations(nextLocations);
      setLocationId((current) => current || nextLocations[0]?.id || "");
      setNotice(null);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (provider: "usgs" | "nasa-firms" | "copernicus") => {
    setRunning(provider);
    try {
      const payload = provider === "copernicus" ? { location_id: locationId } : {};
      await runIntelligenceProvider(provider, payload);
      setNotice(`${provider} run accepted.`);
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(null);
    }
  };

  const retry = async (jobId: string) => {
    setRunning(jobId);
    try {
      await retryEarthObservationJob(jobId);
      setNotice("Job returned to the bounded queue.");
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(null);
    }
  };

  const failedJobs = useMemo(
    () => status?.earth_observation.recent_jobs.filter((job) => ["failed", "dead_letter", "budget_deferred"].includes(job.status)) ?? [],
    [status],
  );
  const queued = status?.earth_observation.queue.reduce((sum, item) => sum + Number(item.count), 0) ?? 0;
  const outbox = status?.backbone.outbox.reduce((sum, item) => sum + Number(item.count), 0) ?? 0;
  const pushAccepted = status?.apns?.deliveries.find((item) => item.status === "accepted")?.count ?? 0;

  return (
    <section className="app-card rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--shell-ink)]"><Activity className="h-4 w-4" />Signal, Earth observation, and delivery operations</div><p className="mt-1 text-xs text-[color:var(--shell-muted)]">Outbox delivery, bounded jobs, provider state, budgets, usage, push readiness, and inspected retries.</p></div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs text-[color:var(--shell-ink)]"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button>
      </div>
      {notice && <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3 text-xs text-[color:var(--shell-muted)]">{notice}</div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[["Outbox", outbox], ["Dead letters", status?.backbone.unresolved_dead_letters ?? 0], ["EO jobs", queued], ["Assets", status?.earth_observation.assets.count ?? 0], ["Alert candidates", status?.alert_candidates.length ?? 0], ["Active push devices", status?.apns?.devices.active ?? 0]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-[color:var(--shell-border)] p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">{label}</div><div className="mt-1 text-xl font-semibold text-[color:var(--shell-ink)]">{value}</div></div>)}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {[...(status?.rapid_sources ?? []), ...(status?.earth_observation.providers ?? [])]
          .filter((provider, index, providers) => providers.findIndex((candidate) => candidate.provider === provider.provider) === index)
          .map((provider) => <div key={provider.provider} className="rounded-lg border border-[color:var(--shell-border)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold capitalize text-[color:var(--shell-ink)]">{provider.provider.replace(/_/g, " ")}</span><span className="text-[10px] font-semibold uppercase text-[color:var(--shell-muted)]">{provider.state.replace(/_/g, " ")}</span></div><div className="mt-2 text-xs text-[color:var(--shell-muted)]">{provider.last_error || provider.reason || provider.attribution}</div><div className="mt-2 text-[10px] text-[color:var(--shell-muted)]">{provider.last_success_at ? `Last success ${new Date(provider.last_success_at).toLocaleString()}` : "No successful poll recorded"} · {provider.consecutive_failures ?? 0} failures</div></div>)}
      </div>
      {status?.apns && (
        <div className="mt-4 rounded-lg border border-[color:var(--shell-border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[color:var(--shell-ink)]">Apple Push Notification delivery</div>
              <div className="mt-1 text-xs text-[color:var(--shell-muted)]">{status.apns.topic} · {status.apns.devices.active}/{status.apns.devices.total} active devices · {pushAccepted} accepted requests</div>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${status.apns.state === "ready" ? "bg-emerald-100 text-emerald-700" : status.apns.state === "degraded" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{status.apns.state.replace(/_/g, " ")}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">{status.apns.reason || status.apns.semantics}</p>
          <p className="mt-1 text-[10px] text-[color:var(--shell-muted)]">{status.apns.verification.last_verified_at ? `Current credentials verified ${new Date(status.apns.verification.last_verified_at).toLocaleString()}` : "Current credentials have no verified APNs acceptance"}{status.apns.verification.last_provider_failure_at ? ` · Last provider failure ${new Date(status.apns.verification.last_provider_failure_at).toLocaleString()}` : ""} · Per-user active cap {status.apns.limits.max_active_devices_per_user}</p>
          {status.apns.deliveries.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{status.apns.deliveries.map((delivery) => <span key={delivery.status} className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 text-[10px] text-[color:var(--shell-muted)]">{delivery.status.replace(/_/g, " ")} · {delivery.count}</span>)}</div>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["usgs", "nasa-firms"] as const).map((provider) => <button key={provider} type="button" disabled={running !== null} onClick={() => void run(provider)} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50"><Play className="h-3.5 w-3.5" />Run {provider}</button>)}
        <select aria-label="Monitored Earth Observation location" value={locationId} onChange={(event) => setLocationId(event.target.value)} className="max-w-xs rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs text-[color:var(--shell-ink)]">{locations.map((location) => <option key={location.id} value={location.id}>Tier {location.monitoring_tier} · {location.canonical_name}</option>)}</select>
        <button type="button" disabled={running !== null || !locationId} onClick={() => void run("copernicus")} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50"><Play className="h-3.5 w-3.5" />Discover scenes</button>
      </div>
      {failedJobs.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--shell-muted)]"><tr><th className="px-2 py-2">Failed job</th><th className="px-2 py-2">Location</th><th className="px-2 py-2">Attempts</th><th className="px-2 py-2">Error</th><th className="px-2 py-2">Action</th></tr></thead><tbody>{failedJobs.slice(0, 12).map((job) => <tr key={job.id} className="border-t border-[color:var(--shell-border)]"><td className="px-2 py-2 text-[color:var(--shell-ink)]">{job.job_type.replace(/_/g, " ")} · {job.status.replace(/_/g, " ")}</td><td className="px-2 py-2 text-[color:var(--shell-muted)]">{job.location_name || "—"}</td><td className="px-2 py-2 text-[color:var(--shell-muted)]">{job.attempts}/{job.max_attempts}</td><td className="max-w-sm truncate px-2 py-2 text-[color:var(--shell-muted)]">{job.last_error || "Budget deferred"}</td><td className="px-2 py-2"><button type="button" disabled={running !== null} onClick={() => void retry(job.id)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-2 py-1 text-[color:var(--shell-ink)]"><RotateCcw className="h-3 w-3" />Retry</button></td></tr>)}</tbody></table></div>}
    </section>
  );
}
