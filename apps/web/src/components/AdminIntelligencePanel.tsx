import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Play, RefreshCw, RotateCcw, Satellite } from "lucide-react";
import {
  fetchIntelligenceAdminStatus,
  fetchIntelligenceLocations,
  retryEarthObservationJob,
  runIntelligenceProvider,
  type IntelligenceAdminStatus,
  type IntelligenceLocation,
} from "../lib/api";

const ACTIVE_QUEUE_STATES = new Set(["pending", "queued", "processing", "running", "failed", "budget_deferred"]);

function providerLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace("Usgs", "USGS").replace("Nasa", "NASA");
}

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
      setNotice(`${providerLabel(provider)} run accepted.`);
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

  const providers = useMemo(
    () => [...(status?.rapid_sources ?? []), ...(status?.earth_observation.providers ?? [])]
      .filter((provider, index, rows) => rows.findIndex((candidate) => candidate.provider === provider.provider) === index),
    [status],
  );
  const failedJobs = useMemo(
    () => status?.earth_observation.recent_jobs.filter((job) => ["failed", "dead_letter", "budget_deferred"].includes(job.status)) ?? [],
    [status],
  );
  const eventBacklog = status?.backbone.outbox
    .filter((item) => ACTIVE_QUEUE_STATES.has(item.status))
    .reduce((sum, item) => sum + Number(item.count), 0) ?? 0;
  const activeEoJobs = status?.earth_observation.queue
    .filter((item) => ACTIVE_QUEUE_STATES.has(item.status))
    .reduce((sum, item) => sum + Number(item.count), 0) ?? 0;
  const providerIssues = providers.filter((provider) => !["ready", "disabled"].includes(provider.state)).length;
  const attention = Number(status?.backbone.unresolved_dead_letters ?? 0) + failedJobs.length + providerIssues;
  const pushAccepted = status?.apns?.deliveries.find((item) => item.status === "accepted")?.count ?? 0;

  return (
    <section className="app-card rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-[color:var(--shell-ink)]"><Activity className="h-4 w-4" />System health</div>
          <p className="mt-1 text-xs text-[color:var(--shell-muted)]">The few signals that need operator attention, followed by provider state and optional manual controls.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-1.5 text-xs text-[color:var(--shell-ink)]"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button>
      </div>

      {notice && <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3 text-xs text-[color:var(--shell-muted)]">{notice}</div>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Event backlog", value: eventBacklog, detail: "Queued or processing", warn: eventBacklog > 0 },
          { label: "EO work", value: activeEoJobs, detail: "Active, deferred, or retrying", warn: failedJobs.length > 0 },
          { label: "Usable images", value: status?.earth_observation.assets.count ?? 0, detail: "Retained observation assets", warn: false },
          { label: "Needs attention", value: attention, detail: "Provider, job, or dead-letter issues", warn: attention > 0 },
        ].map((metric) => (
          <div key={metric.label} className={`rounded-lg border p-3 ${metric.warn ? "border-amber-300 bg-amber-50/70" : "border-[color:var(--shell-border)]"}`}>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">{metric.warn ? <AlertTriangle className="h-3 w-3 text-amber-600" /> : <CheckCircle2 className="h-3 w-3 text-emerald-600" />}{metric.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[color:var(--shell-ink)]">{metric.value}</div>
            <div className="mt-1 text-[10px] text-[color:var(--shell-muted)]">{metric.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">Providers</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <div key={provider.provider} className="rounded-lg border border-[color:var(--shell-border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[color:var(--shell-ink)]">{providerLabel(provider.provider)}</span>
                <span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${provider.state === "ready" ? "bg-emerald-100 text-emerald-700" : provider.state === "disabled" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>{provider.state.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-[color:var(--shell-muted)]">{provider.last_error || provider.reason || provider.attribution}</p>
              <div className="mt-2 text-[10px] text-[color:var(--shell-muted)]">{provider.last_success_at ? `Last success ${new Date(provider.last_success_at).toLocaleString()}` : "No successful operation recorded"}</div>
            </div>
          ))}
        </div>
      </div>

      {status?.apns && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--shell-border)] p-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">Apple push delivery</div>
            <div className="mt-1 text-xs text-[color:var(--shell-muted)]">{status.apns.devices.active} active devices · {pushAccepted} accepted requests · {status.apns.reason || status.apns.semantics}</div>
          </div>
          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${status.apns.state === "ready" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{status.apns.state.replace(/_/g, " ")}</span>
        </div>
      )}

      <details className="mt-4 rounded-lg border border-[color:var(--shell-border)]">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold text-[color:var(--shell-ink)]"><Play className="h-4 w-4" />Manual provider runs <ChevronDown className="ml-auto h-4 w-4" /></summary>
        <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--shell-border)] p-3">
          {(["usgs", "nasa-firms"] as const).map((provider) => <button key={provider} type="button" disabled={running !== null} onClick={() => void run(provider)} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50"><Play className="h-3.5 w-3.5" />Run {providerLabel(provider)}</button>)}
          <select aria-label="Monitored Earth Observation location" value={locationId} onChange={(event) => setLocationId(event.target.value)} className="max-w-xs rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs text-[color:var(--shell-ink)]">{locations.map((location) => <option key={location.id} value={location.id}>Tier {location.monitoring_tier} · {location.canonical_name}</option>)}</select>
          <button type="button" disabled={running !== null || !locationId} onClick={() => void run("copernicus")} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] px-3 py-2 text-xs font-semibold text-[color:var(--shell-ink)] disabled:opacity-50"><Satellite className="h-3.5 w-3.5" />Discover scenes</button>
        </div>
      </details>

      {failedJobs.length > 0 && (
        <details className="mt-3 rounded-lg border border-amber-300 bg-amber-50/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />{failedJobs.length} EO jobs need review <ChevronDown className="ml-auto h-4 w-4" /></summary>
          <div className="overflow-x-auto border-t border-amber-200"><table className="w-full min-w-[640px] text-left text-xs"><thead className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--shell-muted)]"><tr><th className="px-3 py-2">Job</th><th className="px-3 py-2">Location</th><th className="px-3 py-2">Attempts</th><th className="px-3 py-2">Error</th><th className="px-3 py-2">Action</th></tr></thead><tbody>{failedJobs.slice(0, 12).map((job) => <tr key={job.id} className="border-t border-amber-200"><td className="px-3 py-2 text-[color:var(--shell-ink)]">{job.job_type.replace(/_/g, " ")} · {job.status.replace(/_/g, " ")}</td><td className="px-3 py-2 text-[color:var(--shell-muted)]">{job.location_name || "Event AOI"}</td><td className="px-3 py-2 text-[color:var(--shell-muted)]">{job.attempts}/{job.max_attempts}</td><td className="max-w-md truncate px-3 py-2 text-[color:var(--shell-muted)]">{job.last_error || "Budget deferred"}</td><td className="px-3 py-2"><button type="button" disabled={running !== null} onClick={() => void retry(job.id)} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] px-2 py-1 text-[color:var(--shell-ink)]"><RotateCcw className="h-3 w-3" />Retry</button></td></tr>)}</tbody></table></div>
        </details>
      )}
    </section>
  );
}
