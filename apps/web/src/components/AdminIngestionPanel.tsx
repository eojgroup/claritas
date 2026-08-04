import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, FileText, Play, RefreshCw, Sparkles } from "lucide-react";
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
  fetchAdminIngestionAutomation,
  fetchAdminIngestionRun,
  fetchAdminIngestionRuns,
  fetchAdminDailyBriefingGeneratorConfig,
  fetchAdminDailySignalBriefingGenerationJob,
  startAdminDailySignalBriefingGeneration,
  testAdminDailyBriefingGeneratorConnection,
  triggerAdminMarketIngestion,
  triggerAdminPodcastIngestion,
  triggerAdminLeadershipIngestion,
  triggerAdminNewsIngestion,
  triggerAdminWeatherIngestion,
  updateAdminIngestionAutomationRule,
  type AdminIngestionAutomationRule,
  type AdminIngestionAutomationStatus,
  type AdminDailyBriefingConnectionCheck,
  type AdminDailyBriefingGenerationSummary,
  type AdminDailyBriefingGeneratorConfig,
  type AdminIngestionLog,
  type AdminIngestionMetricsPoint,
  type AdminIngestionMetricsTotal,
  type AdminIngestionRun,
  type AdminDailyBriefingGenerationJob,
  type DailySignalBriefing,
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

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  if (status === "success") {
    return "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]";
  }
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "running") return "bg-sky-50 text-sky-700 border-sky-200";
  if (status === "queued") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function pipelineLabel(pipeline: IngestionPipeline): string {
  if (pipeline === "news") return "News";
  if (pipeline === "weather") return "Weather";
  if (pipeline === "market") return "Market";
  if (pipeline === "podcasts") return "Podcasts";
  return "Leadership";
}

function sourceLabel(sourceName: string): string {
  const normalized = sourceName.trim().toLowerCase();
  if (normalized === "gdelt") return "GDELT";
  if (normalized === "institutional_rss") return "Institutional RSS";
  if (normalized === "openweather") return "OpenWeather";
  if (normalized === "nws") return "NOAA/NWS";
  if (normalized === "sec_edgar") return "SEC EDGAR";
  if (normalized === "ecb") return "ECB";
  if (normalized === "oecd") return "OECD";
  if (normalized === "podcastindex") return "PodcastIndex";
  if (normalized === "wikidata") return "Wikidata";
  return sourceName;
}

function isBriefingGenerationActive(job: AdminDailyBriefingGenerationJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function runSourceSummary(run: AdminIngestionRun): string {
  if (run.pipeline !== "news") return sourceLabel(run.source_name);
  const requestPayload = asObject(run.request_payload);
  const providers = asObject(requestPayload?.providers);
  if (!providers) return sourceLabel(run.source_name);

  const hasExplicitProviders = Object.prototype.hasOwnProperty.call(providers, "gdelt") ||
    Object.prototype.hasOwnProperty.call(providers, "institutionalRss") ||
    Object.prototype.hasOwnProperty.call(providers, "institutional_rss");
  if (!hasExplicitProviders) return sourceLabel(run.source_name);

  const labels: string[] = [];
  if (providers.gdelt === true) labels.push("GDELT");
  if (providers.institutionalRss === true || providers.institutional_rss === true) labels.push("Institutional RSS");
  if (labels.length === 0) return sourceLabel(run.source_name);
  return labels.join(" + ");
}

type AutomationDraft = {
  enabled: boolean;
  schedule_enabled: boolean;
  schedule_interval_minutes: number;
  intelligent_enabled: boolean;
  min_spacing_minutes: number;
  freshness_sla_minutes: number;
  demand_window_minutes: number;
  demand_threshold: number;
  failure_backoff_minutes: number;
  default_payload_text: string;
  dirty: boolean;
};

type AutomationDraftMap = Partial<Record<IngestionPipeline, AutomationDraft | null>>;
type AutomationPendingMap = Partial<Record<IngestionPipeline, boolean>>;

const automationPipelines: IngestionPipeline[] = [
  "news",
  "weather",
  "market",
  "podcasts",
  "leadership",
];

function toAutomationPayloadText(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return "{}";
  }
}

function createAutomationDraft(rule: AdminIngestionAutomationRule): AutomationDraft {
  return {
    enabled: rule.enabled,
    schedule_enabled: rule.schedule_enabled,
    schedule_interval_minutes: rule.schedule_interval_minutes,
    intelligent_enabled: rule.intelligent_enabled,
    min_spacing_minutes: rule.min_spacing_minutes,
    freshness_sla_minutes: rule.freshness_sla_minutes,
    demand_window_minutes: rule.demand_window_minutes,
    demand_threshold: rule.demand_threshold,
    failure_backoff_minutes: rule.failure_backoff_minutes,
    default_payload_text: toAutomationPayloadText(rule.default_payload ?? {}),
    dirty: false,
  };
}

function buildZeroChartData(days: number): Array<{
  date: string;
  news_inserted: number;
  weather_inserted: number;
  market_inserted: number;
  news_runs: number;
  weather_runs: number;
  market_runs: number;
  news_failed: number;
  weather_failed: number;
  market_failed: number;
}> {
  const out: Array<{
    date: string;
    news_inserted: number;
    weather_inserted: number;
    market_inserted: number;
    news_runs: number;
    weather_runs: number;
    market_runs: number;
    news_failed: number;
    weather_failed: number;
    market_failed: number;
  }> = [];
  const now = new Date();
  for (let idx = days - 1; idx >= 0; idx -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - idx);
    out.push({
      date: d.toISOString().slice(0, 10),
      news_inserted: 0,
      weather_inserted: 0,
      market_inserted: 0,
      news_runs: 0,
      weather_runs: 0,
      market_runs: 0,
      news_failed: 0,
      weather_failed: 0,
      market_failed: 0,
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
  const [automationRules, setAutomationRules] = useState<AdminIngestionAutomationRule[]>([]);
  const [automationStatus, setAutomationStatus] = useState<AdminIngestionAutomationStatus[]>([]);
  const [automationDrafts, setAutomationDrafts] = useState<AutomationDraftMap>({
    news: null,
    weather: null,
    market: null,
    podcasts: null,
    leadership: null,
  });
  const [pendingAutomationSave, setPendingAutomationSave] = useState<AutomationPendingMap>({
    news: false,
    weather: false,
    market: false,
    podcasts: false,
    leadership: false,
  });
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isTriggeringNews, setIsTriggeringNews] = useState(false);
  const [isTriggeringWeather, setIsTriggeringWeather] = useState(false);
  const [isTriggeringMarket, setIsTriggeringMarket] = useState(false);
  const [isTriggeringPodcasts, setIsTriggeringPodcasts] = useState(false);
  const [isTriggeringLeadership, setIsTriggeringLeadership] = useState(false);
  const [metricsDays, setMetricsDays] = useState<7 | 30 | 90>(30);
  const [pipelineFilter, setPipelineFilter] = useState<"all" | IngestionPipeline>("all");

  const [runGdeltProvider, setRunGdeltProvider] = useState(true);
  const [runInstitutionalRssProvider, setRunInstitutionalRssProvider] = useState(true);
  const [weatherCountry, setWeatherCountry] = useState("");
  const [runOpenWeatherProvider, setRunOpenWeatherProvider] = useState(true);
  const [runNwsProvider, setRunNwsProvider] = useState(true);
  const [runSecEdgarProvider, setRunSecEdgarProvider] = useState(true);
  const [runEcbProvider, setRunEcbProvider] = useState(true);
  const [runOecdProvider, setRunOecdProvider] = useState(true);
  const [podcastSearchTerms, setPodcastSearchTerms] = useState(
    "geopolitics,security,technology,markets",
  );
  const [podcastFeedIds, setPodcastFeedIds] = useState("");
  const [podcastMaxFeeds, setPodcastMaxFeeds] = useState(3);
  const [podcastMaxEpisodes, setPodcastMaxEpisodes] = useState(5);
  const [podcastFetchTranscripts, setPodcastFetchTranscripts] = useState(true);
  const [podcastExtractIntelligence, setPodcastExtractIntelligence] = useState(true);
  const [briefingConfig, setBriefingConfig] = useState<AdminDailyBriefingGeneratorConfig | null>(null);
  const [briefingConfigError, setBriefingConfigError] = useState<string | null>(null);
  const [isLoadingBriefingConfig, setIsLoadingBriefingConfig] = useState(false);
  const [briefingConnection, setBriefingConnection] = useState<AdminDailyBriefingConnectionCheck | null>(null);
  const [briefingConnectionError, setBriefingConnectionError] = useState<string | null>(null);
  const [isTestingBriefingConnection, setIsTestingBriefingConnection] = useState(false);
  const [briefingDate, setBriefingDate] = useState(() => toLocalDateInputValue(new Date()));
  const [briefingPublish, setBriefingPublish] = useState(true);
  const [briefingLookbackHours, setBriefingLookbackHours] = useState(24);
  const [briefingInstructions, setBriefingInstructions] = useState(
    "Prioritize globally material changes and be explicit when source data is thin.",
  );
  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [briefingGenerationJob, setBriefingGenerationJob] = useState<AdminDailyBriefingGenerationJob | null>(null);
  const [generatedBriefing, setGeneratedBriefing] = useState<DailySignalBriefing | null>(null);
  const [generationSummary, setGenerationSummary] = useState<AdminDailyBriefingGenerationSummary | null>(null);

  const refreshBriefingConfig = useCallback(async () => {
    setIsLoadingBriefingConfig(true);
    setBriefingConfigError(null);
    try {
      setBriefingConfig(await fetchAdminDailyBriefingGeneratorConfig());
    } catch (error) {
      setBriefingConfig(null);
      setBriefingConfigError(toErrorMessage(error));
    } finally {
      setIsLoadingBriefingConfig(false);
    }
  }, []);

  const testBriefingConnection = useCallback(async () => {
    setIsTestingBriefingConnection(true);
    setBriefingConnectionError(null);
    try {
      setBriefingConnection(await testAdminDailyBriefingGeneratorConnection());
    } catch (error) {
      setBriefingConnection(null);
      setBriefingConnectionError(toErrorMessage(error));
    } finally {
      setIsTestingBriefingConnection(false);
    }
  }, []);

  const refreshOverview = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoadingOverview(true);
      if (!silent) setOverviewError(null);
      const selectedPipeline = pipelineFilter === "all" ? undefined : pipelineFilter;
      const [runsRes, metricsRes, automationRes] = await Promise.allSettled([
        fetchAdminIngestionRuns({ pipeline: selectedPipeline, limit: 100 }),
        fetchAdminIngestionMetrics({ pipeline: selectedPipeline, days: metricsDays }),
        fetchAdminIngestionAutomation(),
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

      if (automationRes.status === "fulfilled") {
        setAutomationRules(automationRes.value.rules);
        setAutomationStatus(automationRes.value.status);
        setAutomationDrafts((previous) => {
          const next = { ...previous };
          automationRes.value.rules.forEach((rule) => {
            const draft = previous[rule.pipeline];
            if (!draft || !draft.dirty) {
              next[rule.pipeline] = createAutomationDraft(rule);
            }
          });
          return next;
        });
      } else {
        errors.push(`Automation controls: ${toErrorMessage(automationRes.reason)}`);
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
    void refreshBriefingConfig();
  }, [refreshBriefingConfig]);

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

  useEffect(() => {
    const jobId = briefingGenerationJob?.id;
    const status = briefingGenerationJob?.status;
    if (!jobId || (status !== "queued" && status !== "running")) return;

    const pollJob = async () => {
      try {
        const next = await fetchAdminDailySignalBriefingGenerationJob(jobId);
        setBriefingGenerationJob(next);
        if (next.status === "success") {
          setGeneratedBriefing(next.briefing);
          setGenerationSummary(next.generation);
          setIsGeneratingBriefing(false);
          setActionError(null);
          setActionNotice(
            next.briefing
              ? `Daily briefing for ${next.briefing.briefing_date} generated as ${next.briefing.status}.`
              : "Daily briefing generation completed.",
          );
        } else if (next.status === "failed") {
          setIsGeneratingBriefing(false);
          setActionError(next.error ? `Daily briefing generation failed: ${next.error}` : "Daily briefing generation failed.");
        }
      } catch (error) {
        setActionError(toErrorMessage(error));
      }
    };

    void pollJob();
    const id = window.setInterval(() => {
      void pollJob();
    }, 2500);
    return () => window.clearInterval(id);
  }, [briefingGenerationJob?.id, briefingGenerationJob?.status]);

  const handleTriggerNews = useCallback(async () => {
    if (!runGdeltProvider && !runInstitutionalRssProvider) {
      setActionError("Select at least one news provider.");
      return;
    }
    setIsTriggeringNews(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const payload: Parameters<typeof triggerAdminNewsIngestion>[0] = {
        providers: {
          gdelt: runGdeltProvider,
          institutionalRss: runInstitutionalRssProvider,
        },
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
    refreshOverview,
    runGdeltProvider,
    runInstitutionalRssProvider,
  ]);

  const handleTriggerWeather = useCallback(async () => {
    if (!runOpenWeatherProvider && !runNwsProvider) {
      setActionError("Select at least one weather provider.");
      return;
    }
    setIsTriggeringWeather(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const country = weatherCountry.trim();
      const created = await triggerAdminWeatherIngestion(
        { ...(country ? { country } : {}), providers: { openweather: runOpenWeatherProvider, nws: runNwsProvider } },
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
  }, [refreshOverview, runNwsProvider, runOpenWeatherProvider, weatherCountry]);

  const handleTriggerMarket = useCallback(async () => {
    if (!runSecEdgarProvider && !runEcbProvider && !runOecdProvider) {
      setActionError("Select at least one market provider.");
      return;
    }
    setIsTriggeringMarket(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const created = await triggerAdminMarketIngestion(
        {
          providers: { secEdgar: runSecEdgarProvider, ecb: runEcbProvider, oecd: runOecdProvider },
        },
      );
      setActionNotice(`Market ingestion run #${created.run.id} was queued.`);
      setSelectedRunId(created.run.id);
      setSelectedRun(created.run);
      setLogs(created.logs);
      await refreshOverview(true);
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsTriggeringMarket(false);
    }
  }, [refreshOverview, runEcbProvider, runOecdProvider, runSecEdgarProvider]);

  const handleTriggerPodcasts = useCallback(async () => {
    const searchTerms = podcastSearchTerms
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    const feedIds = podcastFeedIds
      .split(/[,\s]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    if (searchTerms.length === 0 && feedIds.length === 0) {
      setActionError("Provide at least one podcast search term or PodcastIndex feed ID.");
      return;
    }

    setIsTriggeringPodcasts(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const created = await triggerAdminPodcastIngestion({
        searchTerms,
        feedIds,
        maxFeeds: podcastMaxFeeds,
        maxEpisodesPerFeed: podcastMaxEpisodes,
        fetchTranscripts: podcastFetchTranscripts,
        extractIntelligence: podcastExtractIntelligence,
      });
      setActionNotice(`Podcast ingestion run #${created.run.id} was queued.`);
      setSelectedRunId(created.run.id);
      setSelectedRun(created.run);
      setLogs(created.logs);
      await refreshOverview(true);
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsTriggeringPodcasts(false);
    }
  }, [
    podcastExtractIntelligence,
    podcastFeedIds,
    podcastFetchTranscripts,
    podcastMaxEpisodes,
    podcastMaxFeeds,
    podcastSearchTerms,
    refreshOverview,
  ]);

  const handleTriggerLeadership = useCallback(async () => {
    setIsTriggeringLeadership(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const created = await triggerAdminLeadershipIngestion();
      setActionNotice(`Leadership ingestion run #${created.run.id} was queued.`);
      setSelectedRunId(created.run.id);
      setSelectedRun(created.run);
      setLogs(created.logs);
      await refreshOverview(true);
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsTriggeringLeadership(false);
    }
  }, [refreshOverview]);

  const handleGenerateBriefing = useCallback(async () => {
    setIsGeneratingBriefing(true);
    setActionError(null);
    setActionNotice(null);
    setBriefingGenerationJob(null);
    setGeneratedBriefing(null);
    setGenerationSummary(null);
    try {
      const job = await startAdminDailySignalBriefingGeneration(briefingDate, {
        publish: briefingPublish,
        lookback_hours: briefingLookbackHours,
        instructions: briefingInstructions.trim() || undefined,
      });
      setBriefingGenerationJob(job);
      setActionNotice(`Daily briefing generation job ${job.id.slice(0, 8)} queued.`);
      setIsGeneratingBriefing(isBriefingGenerationActive(job));
    } catch (error) {
      setActionError(toErrorMessage(error));
      setIsGeneratingBriefing(false);
    }
  }, [briefingDate, briefingInstructions, briefingLookbackHours, briefingPublish]);

  const updateAutomationDraft = useCallback(
    (
      pipeline: IngestionPipeline,
      updater: (current: AutomationDraft) => AutomationDraft,
    ) => {
      setAutomationDrafts((previous) => {
        const current = previous[pipeline];
        if (!current) return previous;
        return {
          ...previous,
          [pipeline]: {
            ...updater(current),
            dirty: true,
          },
        };
      });
    },
    [],
  );

  const saveAutomationRule = useCallback(
    async (pipeline: IngestionPipeline) => {
      const draft = automationDrafts[pipeline];
      if (!draft) return;

      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(draft.default_payload_text || "{}") as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setActionError(`Default payload for ${pipelineLabel(pipeline)} must be a JSON object.`);
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        setActionError(`Default payload for ${pipelineLabel(pipeline)} is not valid JSON.`);
        return;
      }

      setPendingAutomationSave((previous) => ({ ...previous, [pipeline]: true }));
      setActionError(null);
      setActionNotice(null);
      try {
        const updatedRule = await updateAdminIngestionAutomationRule(pipeline, {
          enabled: draft.enabled,
          schedule_enabled: draft.schedule_enabled,
          schedule_interval_minutes: draft.schedule_interval_minutes,
          intelligent_enabled: draft.intelligent_enabled,
          min_spacing_minutes: draft.min_spacing_minutes,
          freshness_sla_minutes: draft.freshness_sla_minutes,
          demand_window_minutes: draft.demand_window_minutes,
          demand_threshold: draft.demand_threshold,
          failure_backoff_minutes: draft.failure_backoff_minutes,
          default_payload: payload,
        });

        setAutomationRules((previous) =>
          previous.map((rule) => (rule.pipeline === pipeline ? updatedRule : rule)),
        );
        setAutomationDrafts((previous) => ({
          ...previous,
          [pipeline]: createAutomationDraft(updatedRule),
        }));
        setActionNotice(`${pipelineLabel(pipeline)} automation updated.`);
        await refreshOverview(true);
      } catch (error) {
        setActionError(toErrorMessage(error));
      } finally {
        setPendingAutomationSave((previous) => ({ ...previous, [pipeline]: false }));
      }
    },
    [automationDrafts, refreshOverview],
  );

  const chartData = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        news_inserted: number;
        weather_inserted: number;
        market_inserted: number;
        news_runs: number;
        weather_runs: number;
        market_runs: number;
        news_failed: number;
        weather_failed: number;
        market_failed: number;
      }
    >();
    points.forEach((point) => {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, {
          date: point.date,
          news_inserted: 0,
          weather_inserted: 0,
          market_inserted: 0,
          news_runs: 0,
          weather_runs: 0,
          market_runs: 0,
          news_failed: 0,
          weather_failed: 0,
          market_failed: 0,
        });
      }
      const row = byDate.get(point.date)!;
      if (point.pipeline === "news") {
        row.news_inserted = point.inserted;
        row.news_runs = point.run_count;
        row.news_failed = point.failed_count;
      } else if (point.pipeline === "weather") {
        row.weather_inserted = point.inserted;
        row.weather_runs = point.run_count;
        row.weather_failed = point.failed_count;
      } else if (point.pipeline === "market") {
        row.market_inserted = point.inserted;
        row.market_runs = point.run_count;
        row.market_failed = point.failed_count;
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

  const automationRuleByPipeline = useMemo(() => {
    const map = new Map<IngestionPipeline, AdminIngestionAutomationRule>();
    automationRules.forEach((rule) => map.set(rule.pipeline, rule));
    return map;
  }, [automationRules]);

  const automationStatusByPipeline = useMemo(() => {
    const map = new Map<IngestionPipeline, AdminIngestionAutomationStatus>();
    automationStatus.forEach((state) => map.set(state.pipeline, state));
    return map;
  }, [automationStatus]);

  const chartGridColor = dark ? "#334155" : "#e2e8f0";

  return (
    <div className="admin-panel ingestion-control-room grid w-full min-w-0 max-w-full gap-3 sm:gap-4">
      <section className="admin-section admin-manual-runs min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
              Admin ingestion
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Trigger and observe ingestion pipelines
            </div>
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-2 text-sm sm:w-auto sm:text-xs">
            <button
              type="button"
              onClick={() => setPipelineFilter("all")}
              className={`rounded-full border px-3 py-1 transition ${
                pipelineFilter === "all"
                  ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                  : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
              }`}
            >
              All
            </button>
            {automationPipelines.map((pipeline) => (
              <button
                key={pipeline}
                type="button"
                onClick={() => setPipelineFilter(pipeline)}
                className={`rounded-full border px-3 py-1 transition ${
                  pipelineFilter === pipeline
                    ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                    : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
                }`}
              >
                {pipelineLabel(pipeline)}
              </button>
            ))}
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
          <div className="mt-3 rounded-xl border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-3 py-2 text-xs text-[color:var(--shell-ink)]">
            {actionNotice}
          </div>
        )}

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              News run
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={runGdeltProvider}
                  onChange={(event) => setRunGdeltProvider(event.currentTarget.checked)}
                />
                GDELT (keyless)
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={runInstitutionalRssProvider}
                  onChange={(event) => setRunInstitutionalRssProvider(event.currentTarget.checked)}
                />
                Institutional RSS (keyless)
              </label>
            </div>
            <div className="mt-2 text-xs text-[color:var(--shell-muted)]">
              GDELT supplies multilingual publisher coverage plus event and tone signals. Institutional feeds add attributable primary releases from the European Commission, Federal Reserve and SEC.
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerNews()}
              disabled={isTriggeringNews}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringNews ? "Starting…" : "Run News"}
            </button>
          </div>

          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Weather run
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={runOpenWeatherProvider} onChange={(event) => setRunOpenWeatherProvider(event.currentTarget.checked)} />OpenWeather current + 5-day forecast + air</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={runNwsProvider} onChange={(event) => setRunNwsProvider(event.currentTarget.checked)} />NOAA/NWS alerts (US)</label>
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
              Blank = configured global coverage. OpenWeather supplies one consistent forecast model; NWS adds authoritative US alerts without blending forecast values.
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerWeather()}
              disabled={isTriggeringWeather}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringWeather ? "Starting…" : "Run Weather"}
            </button>
          </div>

          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Market run
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={runSecEdgarProvider} onChange={(event) => setRunSecEdgarProvider(event.currentTarget.checked)} />SEC EDGAR (keyless)</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={runEcbProvider} onChange={(event) => setRunEcbProvider(event.currentTarget.checked)} />ECB (keyless)</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={runOecdProvider} onChange={(event) => setRunOecdProvider(event.currentTarget.checked)} />OECD indices (keyless)</label>
            </div>
            <div className="mt-2 text-xs text-[color:var(--shell-muted)]">
              SEC supplies filing events and company facts; ECB supplies daily EUR FX and policy rates; OECD adds monthly national equity direction.
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerMarket()}
              disabled={isTriggeringMarket}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringMarket ? "Starting…" : "Run Market"}
            </button>
          </div>

          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Podcast run
            </div>
            <label className="mt-3 block text-xs text-[color:var(--shell-muted)]">
              Discovery terms (CSV)
              <input
                value={podcastSearchTerms}
                onChange={(event) => setPodcastSearchTerms(event.currentTarget.value)}
                placeholder="geopolitics,security,technology"
                className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
              />
            </label>
            <label className="mt-2 block text-xs text-[color:var(--shell-muted)]">
              PodcastIndex feed IDs (optional CSV)
              <input
                value={podcastFeedIds}
                onChange={(event) => setPodcastFeedIds(event.currentTarget.value)}
                placeholder="e.g. 75075,920666"
                className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
              />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-[color:var(--shell-muted)]">
                Feeds per term
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={podcastMaxFeeds}
                  onChange={(event) => setPodcastMaxFeeds(Number(event.currentTarget.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
              <label className="text-xs text-[color:var(--shell-muted)]">
                Episodes per feed
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={podcastMaxEpisodes}
                  onChange={(event) => setPodcastMaxEpisodes(Number(event.currentTarget.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-[color:var(--shell-muted)]">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={podcastFetchTranscripts}
                  onChange={(event) => setPodcastFetchTranscripts(event.currentTarget.checked)}
                />
                Fetch transcripts
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={podcastExtractIntelligence}
                  onChange={(event) => setPodcastExtractIntelligence(event.currentTarget.checked)}
                />
                Extract signals
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerPodcasts()}
              disabled={isTriggeringPodcasts}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringPodcasts ? "Starting…" : "Run Podcasts"}
            </button>
          </div>

          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Leadership run
            </div>
            <div className="mt-3 text-xs leading-5 text-[color:var(--shell-muted)]">
              Refresh current heads of state and government from Wikidata. No API key is required.
            </div>
            <button
              type="button"
              onClick={() => void handleTriggerLeadership()}
              disabled={isTriggeringLeadership}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {isTriggeringLeadership ? "Starting…" : "Run Leadership"}
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
              <FileText className="h-3.5 w-3.5" />
              Daily briefing
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Generate the published dashboard briefing from current source data
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshBriefingConfig()}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-xs text-[color:var(--shell-muted)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {isLoadingBriefingConfig ? "Checking…" : "Check config"}
          </button>
          <button
            type="button"
            onClick={() => void testBriefingConnection()}
            className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-xs text-[color:var(--shell-muted)]"
          >
            <Activity className="h-3.5 w-3.5" />
            {isTestingBriefingConnection ? "Testing…" : "Test service"}
          </button>
        </div>

        {briefingConfigError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {briefingConfigError}
          </div>
        )}
        {briefingConnectionError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {briefingConnectionError}
          </div>
        )}

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2.5 py-1 text-[color:var(--shell-muted)]">
                Provider: {briefingConfig?.llm.provider ?? "—"}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 ${
                  briefingConfig?.llm.opencode?.server_url_configured
                    ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                URL {briefingConfig?.llm.opencode?.server_url_configured ? "configured" : "missing"}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 ${
                  briefingConfig?.llm.opencode?.auth_configured
                    ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                Server auth {briefingConfig?.llm.opencode?.auth_configured ? "configured" : "missing"}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 ${
                  briefingConnection?.reachable
                    ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                    : briefingConnectionError
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
                }`}
              >
                {briefingConnection?.reachable
                  ? `Service ready ${briefingConnection.latency_ms}ms`
                  : briefingConnectionError
                    ? "Service test failed"
                    : "Not tested"}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 ${
                  briefingConfig?.llm.opencode?.tools_disabled
                    ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                Tools {briefingConfig?.llm.opencode?.tools_disabled ? "disabled" : "enabled"}
              </span>
              <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2.5 py-1 text-[color:var(--shell-muted)]">
                Model: {briefingConfig?.llm.opencode?.model ?? "—"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-[color:var(--shell-muted)]">
                Briefing date
                <input
                  type="date"
                  value={briefingDate}
                  onChange={(event) => setBriefingDate(event.currentTarget.value)}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
              <label className="text-xs text-[color:var(--shell-muted)]">
                Lookback hours
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={briefingLookbackHours}
                  onChange={(event) => {
                    const numeric = Number.parseInt(event.currentTarget.value, 10);
                    if (Number.isFinite(numeric)) {
                      setBriefingLookbackHours(Math.min(Math.max(numeric, 1), 168));
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                />
              </label>
              <label className="flex items-end gap-2 text-xs text-[color:var(--shell-muted)]">
                <input
                  type="checkbox"
                  checked={briefingPublish}
                  onChange={(event) => setBriefingPublish(event.currentTarget.checked)}
                  className="mb-2 h-4 w-4 rounded border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]"
                />
                <span className="pb-1.5">Publish immediately</span>
              </label>
            </div>

            <label className="mt-3 block text-xs text-[color:var(--shell-muted)]">
              Editorial instruction
              <textarea
                value={briefingInstructions}
                onChange={(event) => setBriefingInstructions(event.currentTarget.value)}
                className="mt-1 h-24 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-sm text-[color:var(--shell-ink)]"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleGenerateBriefing()}
              disabled={isGeneratingBriefing}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isGeneratingBriefing
                ? briefingGenerationJob?.status === "queued"
                  ? "Queued…"
                  : "Generating…"
                : briefingPublish
                  ? "Generate + Publish"
                  : "Generate Draft"}
            </button>
            {briefingGenerationJob && (
              <div className="mt-2 text-xs text-[color:var(--shell-muted)]">
                Job {briefingGenerationJob.id.slice(0, 8)} · {briefingGenerationJob.status}
                {briefingGenerationJob.started_at ? ` · started ${formatDateTime(briefingGenerationJob.started_at)}` : ""}
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Last generated
            </div>
            {generatedBriefing ? (
              <div className="mt-3 min-w-0 text-sm text-[color:var(--shell-muted)]">
                <div className="font-semibold text-[color:var(--shell-ink)]">
                  {generatedBriefing.title}
                </div>
                <div className="mt-1 text-xs">
                  {generatedBriefing.briefing_date} · {generatedBriefing.status} ·{" "}
                  {generatedBriefing.generated_by ?? "generator"}
                </div>
                <p className="mt-3 leading-6">{generatedBriefing.update_text}</p>
                {generationSummary && (
                  <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-[11px]">
                    <div>
                      Source window: {formatDateTime(generationSummary.source_window_start)} -{" "}
                      {formatDateTime(generationSummary.source_window_end)}
                    </div>
                    <div>
                      Sources: {generationSummary.source_counts.news} news ·{" "}
                      {generationSummary.source_counts.podcasts ?? 0} podcasts ·{" "}
                      {generationSummary.source_counts.markets} markets ·{" "}
                      {generationSummary.source_counts.weather} weather ·{" "}
                      {generationSummary.source_counts.leadership ?? 0} leadership profiles
                    </div>
                    <div>
                      LLM: {generationSummary.provider}
                      {generationSummary.model ? `:${generationSummary.model}` : ""}
                    </div>
                  </div>
                )}
                {generationSummary?.data_quality_notes.length ? (
                  <ul className="mt-3 space-y-1 text-xs">
                    {generationSummary.data_quality_notes.map((note, idx) => (
                      <li key={`briefing-note-${idx}`}>• {note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : briefingGenerationJob ? (
              <div className="mt-3 text-sm text-[color:var(--shell-muted)]">
                <div className="font-semibold text-[color:var(--shell-ink)]">
                  Generation {briefingGenerationJob.status}
                </div>
                <div className="mt-1 text-xs">
                  {briefingGenerationJob.briefing_date} · job {briefingGenerationJob.id.slice(0, 8)}
                </div>
                {isBriefingGenerationActive(briefingGenerationJob) ? (
                  <p className="mt-3 leading-6">
                    Running in the background. The panel will update when OpenCode returns.
                  </p>
                ) : briefingGenerationJob.error ? (
                  <p className="mt-3 leading-6 text-rose-700">{briefingGenerationJob.error}</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 text-sm text-[color:var(--shell-muted)]">
                No briefing generated in this admin session.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
              Pipeline automation
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Scheduler + intelligent trigger controls
            </div>
          </div>
          <div className="ml-auto text-xs text-[color:var(--shell-muted)]">
            Runs are triggered by schedule, freshness SLA, and demand thresholds.
          </div>
        </div>

        <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {automationPipelines.map((pipeline) => {
            const rule = automationRuleByPipeline.get(pipeline);
            const draft = automationDrafts[pipeline];
            const status = automationStatusByPipeline.get(pipeline);
            const isSaving = pendingAutomationSave[pipeline];
            if (!rule || !draft) {
              return (
                <div
                  key={pipeline}
                  className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3 text-xs text-[color:var(--shell-muted)]"
                >
                  Loading {pipelineLabel(pipeline)} automation…
                </div>
              );
            }

            return (
              <div
                key={pipeline}
                className="min-w-0 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                  {pipelineLabel(pipeline)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[color:var(--shell-muted)]">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) =>
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          enabled: event.currentTarget.checked,
                        }))
                      }
                    />
                    Enabled
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.schedule_enabled}
                      onChange={(event) =>
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          schedule_enabled: event.currentTarget.checked,
                        }))
                      }
                    />
                    Scheduler
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.intelligent_enabled}
                      onChange={(event) =>
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          intelligent_enabled: event.currentTarget.checked,
                        }))
                      }
                    />
                    Intelligent
                  </label>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-[color:var(--shell-muted)]">
                    Schedule (minutes)
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={draft.schedule_interval_minutes}
                      onChange={(event) => {
                        const numeric = Number.parseInt(event.currentTarget.value, 10);
                        if (!Number.isFinite(numeric)) return;
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          schedule_interval_minutes: numeric,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                    />
                  </label>
                  <label className="text-xs text-[color:var(--shell-muted)]">
                    Freshness SLA (minutes)
                    <input
                      type="number"
                      min={1}
                      max={43200}
                      value={draft.freshness_sla_minutes}
                      onChange={(event) => {
                        const numeric = Number.parseInt(event.currentTarget.value, 10);
                        if (!Number.isFinite(numeric)) return;
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          freshness_sla_minutes: numeric,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                    />
                  </label>
                  <label className="text-xs text-[color:var(--shell-muted)]">
                    Demand window (minutes)
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={draft.demand_window_minutes}
                      onChange={(event) => {
                        const numeric = Number.parseInt(event.currentTarget.value, 10);
                        if (!Number.isFinite(numeric)) return;
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          demand_window_minutes: numeric,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                    />
                  </label>
                  <label className="text-xs text-[color:var(--shell-muted)]">
                    Demand threshold (requests)
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={draft.demand_threshold}
                      onChange={(event) => {
                        const numeric = Number.parseInt(event.currentTarget.value, 10);
                        if (!Number.isFinite(numeric)) return;
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          demand_threshold: numeric,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                    />
                  </label>
                  <label className="text-xs text-[color:var(--shell-muted)]">
                    Min spacing (minutes)
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={draft.min_spacing_minutes}
                      onChange={(event) => {
                        const numeric = Number.parseInt(event.currentTarget.value, 10);
                        if (!Number.isFinite(numeric)) return;
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          min_spacing_minutes: numeric,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                    />
                  </label>
                  <label className="text-xs text-[color:var(--shell-muted)]">
                    Failure backoff (minutes)
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={draft.failure_backoff_minutes}
                      onChange={(event) => {
                        const numeric = Number.parseInt(event.currentTarget.value, 10);
                        if (!Number.isFinite(numeric)) return;
                        updateAutomationDraft(pipeline, (current) => ({
                          ...current,
                          failure_backoff_minutes: numeric,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                    />
                  </label>
                </div>

                <label className="mt-3 block text-xs text-[color:var(--shell-muted)]">
                  Default payload (JSON)
                  <textarea
                    value={draft.default_payload_text}
                    onChange={(event) =>
                      updateAutomationDraft(pipeline, (current) => ({
                        ...current,
                        default_payload_text: event.currentTarget.value,
                      }))
                    }
                    className="mt-1 h-32 w-full rounded-lg border border-[color:var(--shell-border)] bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
                  />
                </label>

                <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-[11px] text-[color:var(--shell-muted)]">
                  <div>Last run: {formatDateTime(status?.last_run_at ?? null)}</div>
                  <div>Last success: {formatDateTime(status?.last_success_at ?? null)}</div>
                  <div>Latest data: {formatDateTime(status?.latest_data_at ?? null)}</div>
                  <div>Data age: {status?.data_age_minutes ?? "—"} minutes</div>
                  <div>
                    Demand: {status?.demand_requests ?? 0} requests / {draft.demand_window_minutes}m
                  </div>
                  <div>Active runs: {status?.active_runs ?? 0}</div>
                  <div>Next schedule: {formatDateTime(rule.next_scheduled_at)}</div>
                  <div>Last trigger: {rule.last_trigger_reason ?? "—"}</div>
                </div>

                {rule.last_error && (
                  <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    {rule.last_error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void saveAutomationRule(pipeline)}
                  disabled={!draft.dirty || isSaving}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : "Save automation"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
            Market totals ({metricsDays}d)
          </div>
          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
            {summaryByPipeline.get("market")?.inserted ?? 0}
          </div>
          <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
            rows inserted · {summaryByPipeline.get("market")?.run_count ?? 0} runs
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
            Podcast totals ({metricsDays}d)
          </div>
          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
            {(summaryByPipeline.get("podcasts")?.inserted ?? 0) +
              (summaryByPipeline.get("podcasts")?.updated ?? 0)}
          </div>
          <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
            episodes processed · {summaryByPipeline.get("podcasts")?.run_count ?? 0} runs
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
            Leadership totals ({metricsDays}d)
          </div>
          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
            {(summaryByPipeline.get("leadership")?.inserted ?? 0) +
              (summaryByPipeline.get("leadership")?.updated ?? 0)}
          </div>
          <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
            country snapshots · {summaryByPipeline.get("leadership")?.run_count ?? 0} runs
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
                    ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
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

      <section className="grid min-w-0 gap-3 sm:gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
                  stroke="var(--viz-news)"
                  fill="var(--viz-news)"
                  fillOpacity={0.28}
                />
                <Area
                  type="monotone"
                  dataKey="weather_inserted"
                  name="Weather inserted"
                  stroke="var(--viz-weather)"
                  fill="var(--viz-weather)"
                  fillOpacity={0.28}
                />
                <Area
                  type="monotone"
                  dataKey="market_inserted"
                  name="Market inserted"
                  stroke="var(--viz-market)"
                  fill="var(--viz-market)"
                  fillOpacity={0.28}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
                  stroke="var(--viz-news)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="weather_runs"
                  name="Weather runs"
                  stroke="var(--viz-weather)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="market_runs"
                  name="Market runs"
                  stroke="var(--viz-market)"
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
                <Line
                  type="monotone"
                  dataKey="market_failed"
                  name="Market failures"
                  stroke="#9a3412"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
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
                      ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)]"
                      : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:border-slate-400"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                      {pipelineLabel(run.pipeline)} #{run.id}
                    </span>
                    <span className="rounded-full border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--shell-ink)]">
                      {runSourceSummary(run)}
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

        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
                <div>Source: {runSourceSummary(selectedRun)}</div>
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
