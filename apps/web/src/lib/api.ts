export type NewsItem = {
  id: number;
  kind: string | null;
  title: string | null;
  summary: string | null;
  url: string | null;
  country_iso2: string | null;
  event_time: string | null;
  source_name?: string | null;
  payload?: unknown;
};

export type PodcastSignal = {
  id: number;
  type: "entity" | "topic" | "claim" | "event" | "risk";
  title: string;
  summary?: string | null;
  entities: string[];
  topics: string[];
  countries?: string[];
  risk_level?: "low" | "medium" | "high" | "critical" | null;
  confidence?: number | null;
};

export type PodcastEvidence = {
  id: number;
  segment_index: number;
  start_ms: number;
  end_ms?: number | null;
  speaker?: string | null;
  text: string;
  timing_method: "source" | "inferred" | "unknown";
  source_url?: string | null;
  signals?: PodcastSignal[];
};

export type PodcastExternalLink = {
  platform: "publisher" | "apple" | "spotify" | "youtube" | "podcastindex";
  label: string;
  url: string;
};

export type PodcastEpisode = {
  id: number;
  episode_id: number;
  podcast_index_id: number;
  kind: "podcast_episode";
  title: string;
  summary?: string | null;
  url?: string | null;
  event_time?: string | null;
  payload?: Record<string, unknown> | null;
  feed_id: number;
  podcast_index_feed_id: number;
  feed_title: string;
  feed_author?: string | null;
  feed_image_url?: string | null;
  feed_site_url?: string | null;
  duration_seconds?: number | null;
  image_url?: string | null;
  transcript_status: "pending" | "available" | "missing" | "failed";
  external_links: PodcastExternalLink[];
  signals: PodcastSignal[];
  evidence: PodcastEvidence[];
};

export type CountryStat = { country: string; count: number };
export type CountryStatsCoverage = {
  window_days: number;
  total: number;
  mapped: number;
  unmapped: number;
};
export type CountryStatsResult = {
  stats: CountryStat[];
  coverage: CountryStatsCoverage;
};
export type CountryWeather = {
  country: string;
  temp_c: number | null;
  humidity: number | null;
  observed_at: string;
  weather_main: string | null;
  weather_desc?: string | null;
  wind_speed?: number | null;
  source_name?: string | null;
  icon_code?: string | null;
};

export type CountryLeadershipRole = {
  role_type: "head_of_state" | "head_of_government";
  person_name: string;
  person_wikidata_id: string;
  started_at: string | null;
  source_url: string;
};

export type CountryLeadership = {
  country: string;
  country_name: string;
  wikidata_country_id: string;
  government_type: string | null;
  summary: string;
  roles: CountryLeadershipRole[];
  source_name: "wikidata";
  source_url: string;
  source_license: "CC0";
  source_updated_at: string | null;
  retrieved_at: string;
};

export type MarketQuote = {
  symbol: string;
  company_name: string | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  market_code?: string | null;
  market_name?: string | null;
  market_kind?: string | null;
  price: number | null;
  change: number | null;
  percent_change: number | null;
  high_price: number | null;
  low_price: number | null;
  open_price: number | null;
  previous_close: number | null;
  observed_at: string;
  payload?: unknown;
};

export type MarketStatus = {
  exchange: string;
  is_open: boolean | null;
  session: string | null;
  holiday: string | null;
  timezone: string | null;
  observed_at: string | null;
  error?: string | null;
  payload?: unknown;
};

export type EarningsEvent = {
  symbol: string;
  date: string | null;
  hour: string | null;
  quarter: number | null;
  year: number | null;
  eps_actual: number | null;
  eps_estimate: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
  country: string | null;
  market_code: string | null;
  market_name: string | null;
  payload?: unknown;
};

export type AuthProviderId = "google" | "microsoft" | "apple";
export type IngestionPipeline = "news" | "weather" | "market" | "podcasts" | "leadership";
export type IngestionRunStatus = "queued" | "running" | "success" | "failed" | "unknown";
export type DailySignalBriefingStatus = "draft" | "published" | "archived";

export type DailySignalBriefing = {
  id: number;
  briefing_date: string;
  title: string;
  update_text: string;
  key_takeaways: string[];
  status: DailySignalBriefingStatus;
  source_window_start: string | null;
  source_window_end: string | null;
  generated_by: string | null;
  metadata: unknown;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyBriefingSchedule = {
  user_id: number;
  enabled: boolean;
  scheduled_time: string;
  timezone: string;
  last_scheduled_for: string | null;
  last_triggered_at: string | null;
  last_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminDailyBriefingGeneratorConfig = {
  prompt_version: string;
  llm: {
    provider: string;
    opencode?: {
      server_url_configured: boolean;
      auth_configured: boolean;
      provider_id: string | null;
      model_id: string | null;
      model: string | null;
      tools_disabled: boolean;
    };
  };
};

export type AdminDailyBriefingConnectionCheck = {
  provider: string;
  reachable: boolean;
  model: string | null;
  latency_ms: number;
  metadata: {
    session_id?: string | null;
    server_url?: string;
    provider_id?: string | null;
    model_id?: string | null;
    [key: string]: unknown;
  };
};

export type AdminDailyBriefingGenerationSummary = {
  provider: string;
  model: string | null;
  source_counts: {
    news: number;
    podcasts: number;
    markets: number;
    weather: number;
    leadership: number;
  };
  source_window_start: string;
  source_window_end: string;
  data_quality_notes: string[];
};

export type AdminDailyBriefingGenerationJobStatus = "queued" | "running" | "success" | "failed";

export type AdminDailyBriefingGenerationJob = {
  id: string;
  briefing_date: string;
  status: AdminDailyBriefingGenerationJobStatus;
  options: unknown;
  briefing_id: number | null;
  briefing: DailySignalBriefing | null;
  generation: AdminDailyBriefingGenerationSummary | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type BillingPlanRef = {
  id: number;
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  interval_unit: string;
};

export type BillingSubscription = {
  id: number;
  status: string;
  provider: string;
  started_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  plan: BillingPlanRef;
};

export type BillingAccessReason =
  | "paywall_disabled"
  | "admin_override"
  | "active_subscription"
  | "trialing_subscription"
  | "grace_period"
  | "subscription_expired"
  | "subscription_inactive"
  | "no_subscription";

export type BillingAccessState = {
  paywall_enabled: boolean;
  has_access: boolean;
  reason: BillingAccessReason;
  checkout_url: string | null;
  portal_url: string | null;
  subscription: BillingSubscription | null;
};

export type AdminRole = {
  id: number;
  key: string;
  description: string | null;
  user_count: number;
};

export type AdminUserSubscription = {
  id: number;
  status: string | null;
  provider: string | null;
  started_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  plan: {
    code: string | null;
    name: string | null;
  };
};

export type AdminUser = {
  id: number;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  roles: string[];
  providers: string[];
  last_seen_at: string | null;
  subscription: AdminUserSubscription | null;
};

export type AdminBillingPlan = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval_unit: string;
  is_active: boolean;
  metadata: unknown;
};

export type AuthProvider = {
  id: AuthProviderId;
  enabled: boolean;
  display_name?: string;
  icon?: AuthProviderId;
  start_path?: string;
};

export type AuthUser = {
  id: number;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  billing: BillingAccessState;
};

export type AdminIngestionRun = {
  id: number;
  pipeline: IngestionPipeline;
  source_name: string;
  status: IngestionRunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: unknown;
  trigger_mode: string | null;
  requested_by_email: string | null;
  request_payload: unknown;
  log_count: number;
};

export type AdminIngestionLog = {
  id: number;
  run_id: number;
  logged_at: string;
  level: "info" | "warn" | "error";
  message: string;
  context: unknown | null;
};

export type AdminIngestionMetricsPoint = {
  date: string;
  pipeline: IngestionPipeline;
  run_count: number;
  success_count: number;
  failed_count: number;
  queued_count: number;
  running_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  http_failures: number;
  db_errors: number;
};

export type AdminIngestionMetricsTotal = {
  pipeline: IngestionPipeline;
  run_count: number;
  success_count: number;
  failed_count: number;
  queued_count: number;
  running_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  http_failures: number;
  db_errors: number;
};

export type AdminIngestionAutomationRule = {
  pipeline: IngestionPipeline;
  enabled: boolean;
  schedule_enabled: boolean;
  schedule_interval_minutes: number;
  intelligent_enabled: boolean;
  min_spacing_minutes: number;
  freshness_sla_minutes: number;
  demand_window_minutes: number;
  demand_threshold: number;
  failure_backoff_minutes: number;
  next_scheduled_at: string | null;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  last_trigger_reason: string | null;
  last_error: string | null;
  default_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AdminIngestionAutomationStatus = {
  pipeline: IngestionPipeline;
  last_run_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  latest_data_at: string | null;
  data_age_minutes: number | null;
  demand_requests: number;
  active_runs: number;
};

const API_BASE = "";

async function readError(resp: Response, fallback: string): Promise<string> {
  const textResponse = resp.clone();
  try {
    const data = await resp.json();
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
  } catch {
    try {
      const text = await textResponse.text();
      if (text.trim()) return `${fallback}: ${resp.status} ${text.trim()}`;
    } catch {
      // ignore parse errors
    }
  }
  return `${fallback}: ${resp.status}`;
}

export async function fetchAuthProviders(): Promise<AuthProvider[]> {
  const resp = await fetch(`${API_BASE}/api/auth/providers`, { credentials: "include" });
  if (!resp.ok) throw new Error(`Failed to fetch auth providers: ${resp.status}`);
  const data = await resp.json();
  return (data.providers ?? []) as AuthProvider[];
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  const resp = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  if (resp.status === 401) return null;
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch auth session"));
  const data = await resp.json();
  return (data.user ?? null) as AuthUser | null;
}

export async function fetchBillingMe(): Promise<BillingAccessState> {
  const resp = await fetch(`${API_BASE}/api/billing/me`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch billing state"));
  const data = await resp.json();
  return data.billing as BillingAccessState;
}

export async function fetchDailySignalBriefingLatest(): Promise<DailySignalBriefing | null> {
  const resp = await fetch(`${API_BASE}/api/briefings/daily/latest`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch daily briefing"));
  const data = await resp.json();
  return (data.briefing ?? null) as DailySignalBriefing | null;
}

const DAILY_BRIEFING_SCHEDULE_PATHS = [
  "/api/auth/me/briefings/daily/schedule",
  "/api/briefings/daily/schedule",
  "/api/me/briefings/daily/schedule",
];

async function requestDailyBriefingSchedule(
  init: RequestInit,
  fallbackMessage: string,
): Promise<DailyBriefingSchedule> {
  let lastMessage = fallbackMessage;
  for (const path of DAILY_BRIEFING_SCHEDULE_PATHS) {
    const resp = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
    if (resp.ok) {
      const data = await resp.json();
      return data.schedule as DailyBriefingSchedule;
    }
    lastMessage = await readError(resp, fallbackMessage);
    if (resp.status !== 401 && resp.status !== 404) break;
  }
  throw new Error(lastMessage);
}

export async function fetchDailyBriefingSchedule(): Promise<DailyBriefingSchedule> {
  return requestDailyBriefingSchedule({}, "Failed to fetch daily briefing schedule");
}

export async function updateDailyBriefingSchedule(payload: {
  enabled?: boolean;
  scheduled_time?: string;
  timezone?: string;
}): Promise<DailyBriefingSchedule> {
  return requestDailyBriefingSchedule({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, "Failed to update daily briefing schedule");
}

export async function fetchAdminDailyBriefingGeneratorConfig(): Promise<AdminDailyBriefingGeneratorConfig> {
  const resp = await fetch(`${API_BASE}/api/admin/briefings/daily/generation/config`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch briefing generator config"));
  const data = await resp.json();
  return data.generator as AdminDailyBriefingGeneratorConfig;
}

export async function testAdminDailyBriefingGeneratorConnection(): Promise<AdminDailyBriefingConnectionCheck> {
  const resp = await fetch(`${API_BASE}/api/admin/briefings/daily/generation/test`, {
    method: "POST",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to test briefing generator connection"));
  const data = await resp.json();
  return data.connection as AdminDailyBriefingConnectionCheck;
}

export async function startAdminDailySignalBriefingGeneration(
  date: string,
  payload?: {
    publish?: boolean;
    status?: "draft" | "published";
    lookback_hours?: number;
    max_news_items?: number;
    max_podcast_items?: number;
    max_market_items?: number;
    max_weather_items?: number;
    instructions?: string;
  },
): Promise<AdminDailyBriefingGenerationJob> {
  const resp = await fetch(`${API_BASE}/api/admin/briefings/daily/${encodeURIComponent(date)}/generate`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to start daily briefing generation"));
  const data = await resp.json();
  return data.job as AdminDailyBriefingGenerationJob;
}

export async function fetchAdminDailySignalBriefingGenerationJob(
  jobId: string,
): Promise<AdminDailyBriefingGenerationJob> {
  const resp = await fetch(
    `${API_BASE}/api/admin/briefings/daily/generation/jobs/${encodeURIComponent(jobId)}`,
    { credentials: "include" },
  );
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch daily briefing generation job"));
  const data = await resp.json();
  return data.job as AdminDailyBriefingGenerationJob;
}

export async function logoutAuth(): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(`Failed to logout: ${resp.status}`);
}

export function getAuthStartUrl(provider: AuthProviderId, redirectUrl?: string): string {
  const sp = new URLSearchParams();
  if (redirectUrl) sp.set("redirect", redirectUrl);
  const qs = sp.toString();
  return `${API_BASE}/api/auth/${provider}/start${qs ? `?${qs}` : ""}`;
}

export async function fetchNews(params?: { limit?: number; offset?: number; q?: string; country?: string }) {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  if (params?.q) sp.set("q", params.q);
  if (params?.country) sp.set("country", params.country);
  const resp = await fetch(`${API_BASE}/api/news?${sp.toString()}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch news"));
  const data = await resp.json();
  return (data.items ?? []) as NewsItem[];
}

export async function fetchPodcasts(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  signalType?: PodcastSignal["type"] | "all";
}): Promise<PodcastEpisode[]> {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  if (params?.q) sp.set("q", params.q);
  if (params?.signalType && params.signalType !== "all") sp.set("signal_type", params.signalType);
  const resp = await fetch(`${API_BASE}/api/podcasts?${sp.toString()}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch podcast intelligence"));
  const data = await resp.json();
  return (data.items ?? []) as PodcastEpisode[];
}

export async function fetchPodcastEvidence(itemId: number): Promise<PodcastEvidence[]> {
  const resp = await fetch(`${API_BASE}/api/podcasts/${encodeURIComponent(itemId)}/evidence`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch podcast evidence"));
  const data = await resp.json();
  return (data.evidence ?? []) as PodcastEvidence[];
}

export async function fetchCountryStats(params?: { days?: number }): Promise<CountryStatsResult> {
  const sp = new URLSearchParams();
  if (params?.days) sp.set("days", String(params.days));
  const resp = await fetch(`${API_BASE}/api/news/country-stats?${sp.toString()}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch country stats"));
  const data = await resp.json();
  const stats = (data.stats ?? []) as CountryStat[];
  const coverage = data.coverage as CountryStatsCoverage | undefined;
  return {
    stats,
    coverage: coverage ?? {
      window_days: params?.days ?? 30,
      total: stats.reduce((sum, stat) => sum + Number(stat.count || 0), 0),
      mapped: stats.reduce((sum, stat) => sum + Number(stat.count || 0), 0),
      unmapped: 0,
    },
  };
}

export async function fetchCountryWeather() {
  const resp = await fetch(`${API_BASE}/api/weather/country-latest`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch country weather"));
  const data = await resp.json();
  return (data.stats ?? []) as CountryWeather[];
}

export async function fetchCountryLeadership() {
  const resp = await fetch(`${API_BASE}/api/leadership/countries`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch country leadership"));
  const data = await resp.json();
  return (data.countries ?? []) as CountryLeadership[];
}

export async function fetchMarketQuotes(params?: { refresh?: boolean; symbols?: string[] }) {
  const sp = new URLSearchParams();
  if (typeof params?.refresh === "boolean") sp.set("refresh", params.refresh ? "true" : "false");
  if (params?.symbols && params.symbols.length > 0) sp.set("symbols", params.symbols.join(","));
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  const resp = await fetch(`${API_BASE}/api/market/quotes${suffix}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch market quotes"));
  const data = await resp.json();
  return (data.quotes ?? []) as MarketQuote[];
}

export async function fetchMarketStatus(params?: { refresh?: boolean; exchanges?: string[] }) {
  const sp = new URLSearchParams();
  if (typeof params?.refresh === "boolean") sp.set("refresh", params.refresh ? "true" : "false");
  if (params?.exchanges && params.exchanges.length > 0) sp.set("exchanges", params.exchanges.join(","));
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  const resp = await fetch(`${API_BASE}/api/market/status${suffix}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch market status"));
  const data = await resp.json();
  return (data.status ?? []) as MarketStatus[];
}

export async function fetchMarketEarnings(params?: {
  from?: string;
  to?: string;
  symbol?: string;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.from) sp.set("from", params.from);
  if (params?.to) sp.set("to", params.to);
  if (params?.symbol) sp.set("symbol", params.symbol);
  if (typeof params?.limit === "number") sp.set("limit", String(params.limit));
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  const resp = await fetch(`${API_BASE}/api/market/earnings${suffix}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch market earnings"));
  const data = await resp.json();
  return (data.events ?? []) as EarningsEvent[];
}

export async function ingestWeatherNow(country?: string) {
  const resp = await fetch(`${API_BASE}/api/ingest/openweather/country-current`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(country ? { country } : {}),
  });
  if (!resp.ok) throw new Error(`Failed to ingest weather: ${resp.status}`);
  return await resp.json();
}

export async function triggerAdminNewsIngestion(payload?: {
  providers?: {
    newsapi?: boolean;
    thenewsapi?: boolean;
  };
  everything?:
    | false
    | {
        q?: string;
        language?: string;
        pageSize?: number;
        maxPages?: number;
      };
  topHeadlines?:
    | false
    | {
        country?: string;
        category?: string;
        q?: string;
        pageSize?: number;
        maxPages?: number;
      };
  theNewsApi?:
    | false
    | {
        search?: string;
        q?: string;
        language?: string;
        locale?: string;
        country?: string;
        pageSize?: number;
        maxPages?: number;
        publishedAfter?: string;
      };
}): Promise<{ run: AdminIngestionRun; logs: AdminIngestionLog[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/news/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to trigger news ingestion"));
  return (await resp.json()) as { run: AdminIngestionRun; logs: AdminIngestionLog[] };
}

export async function triggerAdminWeatherIngestion(payload?: {
  country?: string;
}): Promise<{ run: AdminIngestionRun; logs: AdminIngestionLog[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/weather/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to trigger weather ingestion"));
  return (await resp.json()) as { run: AdminIngestionRun; logs: AdminIngestionLog[] };
}

export async function triggerAdminMarketIngestion(payload?: {
  symbols?: string[] | string;
  includeNews?: boolean;
  newsCategory?: "general" | "forex" | "crypto" | "merger";
  newsMinId?: number;
  newsMaxItems?: number;
}): Promise<{ run: AdminIngestionRun; logs: AdminIngestionLog[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/market/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to trigger market ingestion"));
  return (await resp.json()) as { run: AdminIngestionRun; logs: AdminIngestionLog[] };
}

export async function triggerAdminPodcastIngestion(payload: {
  feedIds?: number[];
  searchTerms?: string[];
  maxFeeds?: number;
  maxEpisodesPerFeed?: number;
  fetchTranscripts?: boolean;
  extractIntelligence?: boolean;
}): Promise<{ run: AdminIngestionRun; logs: AdminIngestionLog[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/podcasts/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to trigger podcast ingestion"));
  return (await resp.json()) as { run: AdminIngestionRun; logs: AdminIngestionLog[] };
}

export async function triggerAdminLeadershipIngestion(): Promise<{
  run: AdminIngestionRun;
  logs: AdminIngestionLog[];
}> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/leadership/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to trigger leadership ingestion"));
  return (await resp.json()) as { run: AdminIngestionRun; logs: AdminIngestionLog[] };
}

export async function fetchAdminIngestionRuns(params?: {
  pipeline?: IngestionPipeline;
  limit?: number;
  offset?: number;
}): Promise<AdminIngestionRun[]> {
  const sp = new URLSearchParams();
  if (params?.pipeline) sp.set("pipeline", params.pipeline);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));

  const resp = await fetch(`${API_BASE}/api/admin/ingestion/runs?${sp.toString()}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ingestion runs"));
  const data = await resp.json();
  return (data.runs ?? []) as AdminIngestionRun[];
}

export async function fetchAdminIngestionRun(
  runId: number,
  options?: { logLimit?: number }
): Promise<{ run: AdminIngestionRun; logs: AdminIngestionLog[] }> {
  const sp = new URLSearchParams();
  if (options?.logLimit) sp.set("logLimit", String(options.logLimit));
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/runs/${runId}${suffix}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ingestion run"));
  return (await resp.json()) as { run: AdminIngestionRun; logs: AdminIngestionLog[] };
}

export async function fetchAdminIngestionLogs(
  runId: number,
  options?: { afterId?: number; limit?: number }
): Promise<AdminIngestionLog[]> {
  const sp = new URLSearchParams();
  if (options?.afterId) sp.set("afterId", String(options.afterId));
  if (options?.limit) sp.set("limit", String(options.limit));
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/runs/${runId}/logs?${sp.toString()}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ingestion logs"));
  const data = await resp.json();
  return (data.logs ?? []) as AdminIngestionLog[];
}

export async function fetchAdminIngestionMetrics(params?: {
  days?: number;
  pipeline?: IngestionPipeline;
}): Promise<{
  days: number;
  points: AdminIngestionMetricsPoint[];
  totals: AdminIngestionMetricsTotal[];
}> {
  const sp = new URLSearchParams();
  if (params?.days) sp.set("days", String(params.days));
  if (params?.pipeline) sp.set("pipeline", params.pipeline);
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/metrics?${sp.toString()}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ingestion metrics"));
  return (await resp.json()) as {
    days: number;
    points: AdminIngestionMetricsPoint[];
    totals: AdminIngestionMetricsTotal[];
  };
}

export async function fetchAdminIngestionAutomation(): Promise<{
  poll_seconds: number;
  rules: AdminIngestionAutomationRule[];
  status: AdminIngestionAutomationStatus[];
}> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/automation`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ingestion automation"));
  return (await resp.json()) as {
    poll_seconds: number;
    rules: AdminIngestionAutomationRule[];
    status: AdminIngestionAutomationStatus[];
  };
}

export async function updateAdminIngestionAutomationRule(
  pipeline: IngestionPipeline,
  patch: Partial<AdminIngestionAutomationRule>
): Promise<AdminIngestionAutomationRule> {
  const resp = await fetch(`${API_BASE}/api/admin/ingestion/automation/${pipeline}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to update ingestion automation"));
  const data = await resp.json();
  return data.rule as AdminIngestionAutomationRule;
}

export async function fetchAdminRoles(): Promise<AdminRole[]> {
  const resp = await fetch(`${API_BASE}/api/admin/roles`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch roles"));
  const data = await resp.json();
  return (data.roles ?? []) as AdminRole[];
}

export async function createAdminRole(payload: {
  key: string;
  description?: string;
}): Promise<AdminRole> {
  const resp = await fetch(`${API_BASE}/api/admin/roles`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to create role"));
  const data = await resp.json();
  return data.role as AdminRole;
}

export async function fetchAdminBillingPlans(): Promise<AdminBillingPlan[]> {
  const resp = await fetch(`${API_BASE}/api/admin/billing/plans`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch billing plans"));
  const data = await resp.json();
  return (data.plans ?? []) as AdminBillingPlan[];
}

export async function createAdminBillingPlan(payload: {
  code: string;
  name: string;
  description?: string;
  price_cents?: number;
  currency?: string;
  interval_unit?: "month" | "year" | "one_time";
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<AdminBillingPlan> {
  const resp = await fetch(`${API_BASE}/api/admin/billing/plans`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to create billing plan"));
  const data = await resp.json();
  return data.plan as AdminBillingPlan;
}

export async function fetchAdminUsers(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  role?: string;
  includeInactive?: boolean;
}): Promise<{ users: AdminUser[]; total: number; limit: number; offset: number }> {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  if (params?.q) sp.set("q", params.q);
  if (params?.role) sp.set("role", params.role);
  if (typeof params?.includeInactive === "boolean") {
    sp.set("includeInactive", String(params.includeInactive));
  }

  const resp = await fetch(`${API_BASE}/api/admin/users?${sp.toString()}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch users"));
  return (await resp.json()) as { users: AdminUser[]; total: number; limit: number; offset: number };
}

export async function updateAdminUserRoles(
  userId: number,
  roles: string[]
): Promise<AdminUser | null> {
  const resp = await fetch(`${API_BASE}/api/admin/users/${userId}/roles`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles }),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to update user roles"));
  const data = await resp.json();
  return (data.user ?? null) as AdminUser | null;
}

export async function updateAdminUserStatus(
  userId: number,
  is_active: boolean
): Promise<AdminUser | null> {
  const resp = await fetch(`${API_BASE}/api/admin/users/${userId}/status`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ is_active }),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to update user status"));
  const data = await resp.json();
  return (data.user ?? null) as AdminUser | null;
}

export async function updateAdminUserSubscription(
  userId: number,
  payload: {
    plan_code: string;
    status: "trialing" | "active" | "past_due" | "grace_period" | "canceled" | "unpaid" | "incomplete";
    provider?: string;
    started_at?: string | null;
    current_period_end?: string | null;
    canceled_at?: string | null;
    provider_customer_id?: string | null;
    provider_subscription_id?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<AdminUser | null> {
  const resp = await fetch(`${API_BASE}/api/admin/users/${userId}/subscription`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to update user subscription"));
  const data = await resp.json();
  return (data.user ?? null) as AdminUser | null;
}

export function imageProxy(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const resolved = new URL(url);
    return `/api/proxy-image?url=${encodeURIComponent(resolved.toString())}`;
  } catch {
    return undefined;
  }
}
