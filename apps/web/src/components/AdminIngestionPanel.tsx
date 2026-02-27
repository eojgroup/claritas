import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Play, RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchAdminIngestionMetrics,
  fetchAdminIngestionRun,
  fetchAdminIngestionRuns,
  triggerAdminNewsIngestion,
  triggerAdminWeatherIngestion,
  type AdminIngestionLog,
  type AdminIngestionMetricsPoint,
  type AdminIngestionMetricsTotal,
  type AdminIngestionRun,
  type IngestionPipeline,
} from "../lib/api";

type AdminIngestionPanelProps = {
  dark: boolean;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getStatNumber(stats: unknown, paths: string[]): number {
  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = stats;
    for (const part of parts) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    const numeric =
      typeof current === "number"
        ? current
        : typeof current === "string"
          ? Number(current)
          : Number.NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString();
}

function formatDurationMs(run: AdminIngestionRun): string {
  const duration = getStatNumber(run.stats, ["duration_ms"]);
  if (duration > 0) return `${Math.round(duration / 1000)}s`;
  if (!run.finished_at) return "Running";
  const started = Date.parse(run.started_at);
  const finished = Date.parse(run.finished_at);
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) return "—";
  return `${Math.round((finished - started) / 1000)}s`;
}

function statusClasses(status: AdminIngestionRun["status"]): string {
  if (status === "success") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "running") return "bg-sky-50 text-sky-700 border-sky-200";
  if (status === "queued") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function pipelineLabel(pipeline: IngestionPipeline): string {
  return pipeline === "news" ? "News" : "Weather";
}

function sourceLabel(sourceName: string): string {
  const normalized = sourceName.trim().toLowerCase();
  if (normalized === "newsapi") return "NewsAPI";
  if (normalized === "thenewsapi") return "TheNewsAPI";
  if (normalized === "openweather") return "OpenWeather";
  return sourceName;
}

function buildZeroChartData(days: number): Array<{
  date: string;
  news_inserted: number;
  weather_inserted: number;
  news_runs: number;
  weather_runs: number;
  news_failed: number;
  weather_failed: number;
}> {
  const out: Array<{
    date: string;
    news_inserted: number;
    weather_inserted: number;
    news_runs: number;
    weather_runs: number;
    news_failed: number;
    weather_failed: number;
  }> = [];
  const now = new Date();
  for (let idx = days - 1; idx >= 0; idx -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - idx);
    out.push({
      date: d.toISOString().slice(0, 10),
      news_inserted: 0,
      weather_inserted: 0,
      news_runs: 0,
      weather_runs: 0,
      news_failed: 0,
      weather_failed: 0,
    });
  }
  return out;
}

export default function AdminIngestionPanel({ dark }: AdminIngestionPanelProps) {
  const [runs, setRuns] = useState<AdminIngestionRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<AdminIngestionRun | null>(null);
  const [logs, setLogs] = useState<AdminIngestionLog[]>([]);
  const [points, setPoints] = useState<AdminIngestionMetricsPoint[]>([]);
  const [totals, setTotals] = useState<AdminIngestionMetricsTotal[]>([]);
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isTriggeringNews, setIsTriggeringNews] = useState(false);
  const [isTriggeringWeather, setIsTriggeringWeather] = useState(false);
  const [metricsDays, setMetricsDays] = useState<7 | 30 | 90>(30);
  const [pipelineFilter, setPipelineFilter] = useState<"all" | IngestionPipeline>("all");

  const [runEverything, setRunEverything] = useState(true);
  const [runTopHeadlines, setRunTopHeadlines] = useState(true);
  const [newsQuery, setNewsQuery] = useState("OpenAI");
  const [newsLanguage, setNewsLanguage] = useState("en");
  const [newsCountry, setNewsCountry] = useState("us");
  const [newsCategory, setNewsCategory] = useState("technology");
  const [weatherCountry, setWeatherCountry] = useState("");

  const refreshOverview = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoadingOverview(true);
      if (!silent) setOverviewError(null);
      const selectedPipeline = pipelineFilter === "all" ? undefined : pipelineFilter;
      const [runsRes, metricsRes] = await Promise.allSettled([
        fetchAdminIngestionRuns({ pipeline: selectedPipeline, limit: 100 }),
        fetchAdminIngestionMetrics({ pipeline: selectedPipeline, days: metricsDays }),
      ]);

      const errors: string[] = [];
      if (runsRes.status === "fulfilled") {
        const nextRuns = runsRes.value;
        setRuns(nextRuns);
        setSelectedRunId((current) => {
          if (current && nextRuns.some((run) => run.id === current)) return current;
          return nextRuns[0]?.id ?? null;
        });
      } else {
        errors.push(`Runs: ${toErrorMessage(runsRes.reason)}`);
      }

      if (metricsRes.status === "fulfilled") {
        setPoints(metricsRes.value.points);
        setTotals(metricsRes.value.totals);
      } else {
        errors.push(`Metrics: ${toErrorMessage(metricsRes.reason)}`);
      }

      setOverviewError(errors.length > 0 ? errors.join(" | ") : null);
      if (!silent) setIsLoadingOverview(false);
    },
    [metricsDays, pipelineFilter],
  );

  const refreshSelectedRun = useCallback(async (runId: number, silent = false) => {
    if (!silent) setRunError(null);
    try {
      const detail = await fetchAdminIngestionRun(runId, { logLimit: 400 });
      setSelectedRun(detail.run);
      setLogs(detail.logs);
      setRuns((previous) =>
        previous.map((run) => (run.id === detail.run.id ? detail.run : run)),
      );
    } catch (error) {
      setRunError(toErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refreshOverview(false);
  }, [refreshOverview]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshOverview(true);
    }, 8000);
    return () => window.clearInterval(id);
  }, [refreshOverview]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      setLogs([]);
      return;
    }
    void refreshSelectedRun(selectedRunId, false);
  }, [refreshSelectedRun, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    const intervalMs =
      selectedRun?.status === "running" || selectedRun?.status === "queued"
        ? 2000
        : 8000;
    const id = window.setInterval(() => {
      void refreshSelectedRun(selectedRunId, true);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [refreshSelectedRun, selectedRun?.status, selectedRunId]);

  const handleTriggerNews = useCallback(async () => {
    if (!runEverything && !runTopHeadlines) {
      setActionError("Enable at least one News step.");
      return;
    }
    setIsTriggeringNews(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const payload: Parameters<typeof triggerAdminNewsIngestion>[0] = {
        everything: runEverything
          ? {
              q: newsQuery.trim() || "OpenAI",
              language: newsLanguage.trim() || undefined,
              pageSize: 50,
              maxPages: 2,
            }
          : false,
        topHeadlines: runTopHeadlines
          ? {
              country: newsCountry.trim() || "us",
              category: newsCategory.trim() || "technology",
              pageSize: 50,
              maxPages: 2,
            }
          : false,
      };
      const created = await triggerAdminNewsIngestion(payload);
      setActionNotice(`News ingestion run #${created.run.id} was queued.`);
      setSelectedRunId(created.run.id);
      setSelectedRun(created.run);
      setLogs(created.logs);
      await refreshOverview(true);
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsTriggeringNews(false);
    }
  }, [
    newsCategory,
    newsCountry,
    newsLanguage,
    newsQuery,
    refreshOverview,
    runEverything,
    runTopHeadlines,
  ]);

  const handleTriggerWeather = useCallback(async () => {
    setIsTriggeringWeather(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const country = weatherCountry.trim();
      const created = await triggerAdminWeatherIngestion(
        country ? { country } : undefined,
      );
      setActionNotice(`Weather ingestion run #${created.run.id} was queued.`);
      setSelectedRunId(created.run.id);
      setSelectedRun(created.run);
      setLogs(created.logs);
      await refreshOverview(true);
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsTriggeringWeather(false);
    }
  }, [refreshOverview, weatherCountry]);

  const chartData = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        news_inserted: number;
        weather_inserted: number;
        news_runs: number;
        weather_runs: number;
        news_failed: number;
        weather_failed: number;
      }
    >();
    points.forEach((point) => {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, {
          date: point.date,
          news_inserted: 0,
          weather_inserted: 0,
          news_runs: 0,
          weather_runs: 0,
          news_failed: 0,
          weather_failed: 0,
        });
      }
      const row = byDate.get(point.date)!;
      if (point.pipeline === "news") {
        row.news_inserted = point.inserted;
        row.news_runs = point.run_count;
        row.news_failed = point.failed_count;
      } else {
        row.weather_inserted = point.inserted;
        row.weather_runs = point.run_count;
        row.weather_failed = point.failed_count;
      }
    });
    const resolved = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (resolved.length > 0) return resolved;
    return buildZeroChartData(metricsDays);
  }, [metricsDays, points]);

  const summaryByPipeline = useMemo(() => {
    const summary = new Map<IngestionPipeline, AdminIngestionMetricsTotal>();
    totals.forEach((total) => summary.set(total.pipeline, total));
    return summary;
  }, [totals]);

  const chartGridColor = dark ? "#334155" : "#e2e8f0";

  return (
    <div className="admin-panel grid gap-3 sm:gap-4">
      <section className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
              Admin ingestion
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Trigger and observe News + Weather pipelines
            </div>
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-2 text-sm sm:w-auto sm:text-xs">
            <button
              type="button"
              onClick={() => setPipelineFilter("all")}
              className={`rounded-full border px-3 py-1 transition ${
                pipelineFilter === "all"
                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                  : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setPipelineFilter("news")}
              className={`rounded-full border px-3 py-1 transition ${
                pipelineFilter === "news"
                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                  : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
              }`}
            >
              News
            </button>
            <button
              type="button"
              onClick={() => setPipelineFilter("weather")}
              className={`rounded-full border px-3 py-1 transition ${
                pipelineFilter === "weather"
                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                  : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
              }`}
            >
              Weather
            </button>
            <button
              type="button"
              onClick={() => void refreshOverview(false)}
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-[color:var(--shell-muted)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {overviewError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {overviewError}
          </div>
        )}
        {actionError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {actionError}
          </div>
        )}
        {actionNotice && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {actionNotice}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              News run
            </div>
            <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
              Runs NewsAPI and TheNewsAPI (when `THENEWSAPI_API_TOKEN` is configured).
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-[color:var(--shell-muted)]">
                Query
                <input
                  value={newsQuery}
                  onChange={(event) => setNewsQuery(event.currentTarget.value)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
              <label className="text-xs text-[color:var(--shell-muted)]">
                Language
                <input
                  value={newsLanguage}
                  onChange={(event) => setNewsLanguage(event.currentTarget.value)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
              <label className="text-xs text-[color:var(--shell-muted)]">
                Top country
                <input
                  value={newsCountry}
                  onChange={(event) => setNewsCountry(event.currentTarget.value)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
              <label className="text-xs text-[color:var(--shell-muted)]">
                Top category
                <input
                  value={newsCategory}
                  onChange={(event) => setNewsCategory(event.currentTarget.value)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={runEverything}
                  onChange={(event) => setRunEverything(event.currentTarget.checked)}
                />
                Everything
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={runTopHeadlines}
                  onChange={(event) =>
                    setRunTopHeadlines(event.currentTarget.checked)
                  }
                />
                Top headlines
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerNews()}
              disabled={isTriggeringNews}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringNews ? "Starting…" : "Run News"}
            </button>
          </div>

          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Weather run
            </div>
            <label className="mt-3 block text-xs text-[color:var(--shell-muted)]">
              Country (optional ISO2)
              <input
                value={weatherCountry}
                onChange={(event) => setWeatherCountry(event.currentTarget.value)}
                placeholder="e.g. us"
                className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
              />
            </label>
            <div className="mt-2 text-xs text-[color:var(--shell-muted)]">
              Blank = global sample ingest.
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerWeather()}
              disabled={isTriggeringWeather}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringWeather ? "Starting…" : "Run Weather"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
            News totals ({metricsDays}d)
          </div>
          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
            {summaryByPipeline.get("news")?.inserted ?? 0}
          </div>
          <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
            rows inserted · {summaryByPipeline.get("news")?.run_count ?? 0} runs
          </div>
        </div>
        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
            Weather totals ({metricsDays}d)
          </div>
          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
            {summaryByPipeline.get("weather")?.inserted ?? 0}
          </div>
          <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
            rows inserted · {summaryByPipeline.get("weather")?.run_count ?? 0} runs
          </div>
        </div>
        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
            Window
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setMetricsDays(days as 7 | 30 | 90)}
                className={`rounded-full border px-3 py-1 ${
                  metricsDays === days
                    ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                    : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-[color:var(--shell-muted)]">
            {isLoadingOverview ? "Refreshing metrics…" : `${points.length} pipeline points loaded`}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-[color:var(--shell-ink)]">
            Ingested rows by day
          </div>
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="news_inserted"
                  name="News inserted"
                  stroke="#0f766e"
                  fill="#99f6e4"
                  fillOpacity={0.45}
                />
                <Area
                  type="monotone"
                  dataKey="weather_inserted"
                  name="Weather inserted"
                  stroke="#0369a1"
                  fill="#bae6fd"
                  fillOpacity={0.45}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-[color:var(--shell-ink)]">
            Run volume and failures
          </div>
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="news_runs"
                  name="News runs"
                  stroke="#0f766e"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="weather_runs"
                  name="Weather runs"
                  stroke="#0369a1"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="news_failed"
                  name="News failures"
                  stroke="#be123c"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="weather_failed"
                  name="Weather failures"
                  stroke="#b91c1c"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-[color:var(--shell-muted)]" />
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Recent runs
            </div>
          </div>
          <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1 sm:max-h-[420px]">
            {runs.length === 0 && (
              <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs text-[color:var(--shell-muted)]">
                No ingestion runs available.
              </div>
            )}
            {runs.map((run) => {
              const inserted = getStatNumber(run.stats, ["totals.inserted", "inserted"]);
              const skipped = getStatNumber(run.stats, ["totals.skipped", "skipped"]);
              const isActive = selectedRunId === run.id;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isActive
                      ? "border-[color:var(--shell-ink)] bg-slate-800/40"
                      : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:border-slate-400"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                      {pipelineLabel(run.pipeline)} #{run.id}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      {sourceLabel(run.source_name)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(run.status)}`}
                    >
                      {run.status}
                    </span>
                    <span className="ml-auto text-xs text-[color:var(--shell-muted)]">
                      {formatDurationMs(run)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
                    Started {formatDateTime(run.started_at)}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
                    Inserted {inserted} · Skipped {skipped} · Logs {run.log_count}
                  </div>
                  {run.error && (
                    <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                      {run.error}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Run logs
            </div>
            {selectedRun && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(selectedRun.status)}`}
              >
                {pipelineLabel(selectedRun.pipeline)} #{selectedRun.id} · {selectedRun.status}
              </span>
            )}
          </div>
          {runError && (
            <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
              {runError}
            </div>
          )}
          {!selectedRun && (
            <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs text-[color:var(--shell-muted)]">
              Select a run to view details and logs.
            </div>
          )}
          {selectedRun && (
            <>
              <div className="mb-3 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs text-[color:var(--shell-muted)]">
                <div>Source: {sourceLabel(selectedRun.source_name)}</div>
                <div>Started: {formatDateTime(selectedRun.started_at)}</div>
                <div>Finished: {formatDateTime(selectedRun.finished_at)}</div>
                <div>Requested by: {selectedRun.requested_by_email ?? "Unknown"}</div>
                <div>
                  Totals: inserted{" "}
                  {getStatNumber(selectedRun.stats, ["totals.inserted", "inserted"])} · updated{" "}
                  {getStatNumber(selectedRun.stats, ["totals.updated", "updated"])} · skipped{" "}
                  {getStatNumber(selectedRun.stats, ["totals.skipped", "skipped"])}
                </div>
              </div>
              <div className="h-[300px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-100 sm:h-[360px]">
                {logs.length === 0 && (
                  <div className="text-slate-400">No log lines yet for this run.</div>
                )}
                {logs.map((log) => {
                  const contextText = log.context ? ` ${JSON.stringify(log.context)}` : "";
                  return (
                    <div key={log.id} className="whitespace-pre-wrap break-words">
                      [{new Date(log.logged_at).toLocaleTimeString()}] {log.level.toUpperCase()} {log.message}
                      {contextText}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
