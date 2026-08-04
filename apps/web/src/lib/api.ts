export type NewsItem = {
  id: number;
  kind: string | null;
  title: string | null;
  summary: string | null;
  url: string | null;
  country_iso2: string | null;
  language_code?: string | null;
  source_country_iso2?: string | null;
  tone?: number | null;
  event_time: string | null;
  source_name?: string | null;
  publisher?: string | null;
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
  apparent_temp_c?: number | null;
  precipitation_mm?: number | null;
  observed_at: string;
  weather_main: string | null;
  weather_desc?: string | null;
  wind_speed?: number | null;
  wind_direction?: number | null;
  wind_gust?: number | null;
  weather_code?: number | null;
  cloud_cover?: number | null;
  is_day?: boolean | null;
  source_kind?: string | null;
  attribution?: string | null;
  source_name?: string | null;
  icon_code?: string | null;
  forecast?: DailyWeatherForecast[];
  air_quality?: AirQuality | null;
};

export type DailyWeatherForecast = {
  forecast_time: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  apparent_temp_min_c?: number | null;
  apparent_temp_max_c?: number | null;
  precipitation_probability: number | null;
  precipitation_mm: number | null;
  weather_code?: number | null;
  weather_main: string | null;
  wind_speed?: number | null;
  wind_gust?: number | null;
  uv_index?: number | null;
  sunrise_at?: string | null;
  sunset_at?: string | null;
};

export type AirQuality = {
  observed_at: string;
  european_aqi: number | null;
  us_aqi: number | null;
  pm10: number | null;
  pm2_5: number | null;
  label: string;
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
  source_name?: string | null;
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

export type MarketFiling = {
  id: number;
  event_type: string;
  symbol: string | null;
  company_name: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  event_time: string;
  source_name: string;
  payload?: unknown;
};

export type MarketIndicator = {
  id: number;
  category: string;
  series_key: string;
  symbol: string | null;
  name: string;
  unit: string | null;
  period_end: string;
  value: number;
  source_name: string;
};

export type FxRate = {
  series_key: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  value: number;
  previous_value: number | null;
  change: number | null;
  percent_change: number | null;
  period_end: string;
  source_name: string;
};

export type PolicyRate = {
  series_key: string;
  name: string;
  value: number;
  unit: string | null;
  period_end: string;
  source_name: string;
};

export type CountryMarketOverview = {
  country: string;
  country_name: string;
  region: string | null;
  currency: string | null;
  index_symbol: string | null;
  index_name: string | null;
  index_change_percent: number | null;
  index_observed_at: string | null;
  index_source: string | null;
  fx_symbol: string | null;
  fx_rate: number | null;
  fx_change_percent: number | null;
  fx_period_end: string | null;
  filing_count_7d: number;
  latest_filing_at: string | null;
  composite_change_percent: number | null;
  composite_basis: Array<"country_index" | "currency_vs_eur">;
  freshness: "current" | "stale" | "unavailable";
};

export type CountryMarketOverviewResponse = {
  generated_at: string;
  countries: CountryMarketOverview[];
  coverage: {
    countries: number;
    with_index: number;
    with_fx: number;
    with_filings: number;
  };
  methodology: {
    index: string;
    fx: string;
    composite: string;
    filings: string;
  };
  sources: string[];
};

export type CountryMarketDetail = {
  summary: CountryMarketOverview;
  fx_history: Array<{ period_end: string; value: number }>;
  filings: MarketFiling[];
  methodology: CountryMarketOverviewResponse["methodology"];
};

export type TransportMode = "maritime" | "aviation";

export type TransportModeAggregate = {
  active: number;
  routed: number;
  alerts: number;
  latest_observed_at: string | null;
};

export type TransportTrendMetric = {
  current: number;
  previous: number;
  change_pct: number | null;
  direction: "up" | "down" | "flat" | "new";
};

export type TransportCountryTrend = {
  ship_departures: TransportTrendMetric;
  cargo_vessel_departures: TransportTrendMetric;
  ship_arrivals: TransportTrendMetric;
  tracked_flights: TransportTrendMetric;
};

export type TransportCountryAggregate = {
  country: string;
  country_name: string;
  active_count: number;
  maritime: {
    active: number;
    current: number;
    origins: number;
    destinations: number;
    flagged: number;
  };
  aviation: {
    active: number;
    current: number;
    origins: number;
    destinations: number;
    registered: number;
  };
  trend: TransportCountryTrend;
};

export type TransportCountryActivityRanking = {
  rank: number;
  country: string;
  country_name: string;
  activity_index: number;
  current: {
    linked_entities: number;
    ship_movements: number;
    ship_departures: number;
    ship_arrivals: number;
    cargo_vessel_departures: number;
    tracked_flights: number;
    observed_movements: number;
  };
  previous: {
    ship_movements: number;
    tracked_flights: number;
    observed_movements: number;
  };
  momentum: TransportTrendMetric;
  mode_mix: {
    maritime_pct: number | null;
    aviation_pct: number | null;
  };
};

export type TransportRouteAggregate = {
  mode: TransportMode;
  origin_country: string;
  origin_name: string;
  destination_country: string;
  destination_name: string;
  active_count: number;
  origin_basis: "observed" | "flag_fallback" | "mixed";
  examples: string[];
};

export type TransportEntity = {
  id: string;
  mode: TransportMode;
  entity_id: string;
  display_name: string | null;
  callsign: string | null;
  flight_number: string | null;
  registration: string | null;
  vehicle_type: string | null;
  vehicle_category: string | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  vertical_rate: number | null;
  current_country_iso2: string | null;
  origin_country_iso2: string | null;
  destination_country_iso2: string | null;
  registration_country_iso2: string | null;
  origin_name: string | null;
  destination_name: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  current_location_name: string | null;
  route_label: string | null;
  linkage_basis: string[];
  linkage_confidence: "high" | "medium" | "low" | "none";
  status: string | null;
  is_alert: boolean;
  source_name: "aisstream" | "adsb_lol";
  observed_at: string;
  country_links: Array<{
    role: "current" | "origin" | "destination" | "flag" | "registration";
    country: string;
  }>;
};

export type TransportActivityPoint = {
  bucket: string;
  mode: TransportMode;
  active_count: number;
};

export type TransportOverview = {
  generated_at: string;
  detail: "aggregate" | "full";
  summary: {
    active: number;
    routed: number;
    alerts: number;
    linked_countries: number;
    modes: Record<TransportMode, TransportModeAggregate>;
  };
  countries: TransportCountryAggregate[];
  activity_ranking: {
    window_hours: 24;
    comparison: "previous_24_hours";
    countries: TransportCountryActivityRanking[];
    highlights: string[];
    methodology: {
      index: string;
      momentum: string;
      coverage: string;
    };
  };
  routes: TransportRouteAggregate[];
  trends: {
    window_hours: number;
    comparison: "previous_24_hours";
    maritime: {
      ship_departures: TransportTrendMetric;
      cargo_vessel_departures: TransportTrendMetric;
      ship_arrivals: TransportTrendMetric;
    };
    aviation: {
      tracked_flights: TransportTrendMetric;
    };
  };
  takeaways: Array<{
    id: string;
    mode: TransportMode;
    title: string;
    summary: string;
    current_value: number;
    previous_value: number;
    change_pct: number | null;
    direction: TransportTrendMetric["direction"];
    qualifier: string;
  }>;
  ports: Array<{
    country: string;
    country_name: string;
    location_name: string;
    departures: number;
    arrivals: number;
    cargo_vessel_departures: number;
  }>;
  activity: TransportActivityPoint[];
  entities: TransportEntity[];
  coverage: {
    maritime: {
      source: "AISstream";
      transport: "WebSocket";
      configured: boolean;
      freshness_minutes: number;
      movement_method: string;
      cargo_method: string;
    };
    aviation: {
      source: "adsb.lol";
      transport: "REST";
      configured: boolean;
      freshness_minutes: number;
      license: string;
      poll_areas: number;
    };
  };
};

export type TransportTrackPoint = {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  current_country_iso2: string | null;
  current_location_name: string | null;
  vehicle_category: string | null;
  observed_at: string;
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
  email_enabled: boolean;
  email_theme: "light" | "dark";
  scheduled_time: string;
  timezone: string;
  industries: string[];
  company_symbols: string[];
  country_iso2s: string[];
  regions: string[];
  max_items: number;
  last_scheduled_for: string | null;
  last_triggered_at: string | null;
  last_job_id: string | null;
  last_personal_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyBriefingPreferenceOptions = {
  industries: string[];
  companies: Array<{
    symbol: string;
    company_name: string | null;
    exchange: string | null;
    country: string | null;
    industry: string | null;
  }>;
  countries: Array<{
    iso2: string;
    name: string;
    region: string | null;
  }>;
  regions: string[];
};

export type DailyBriefingEmailStatus = {
  configured: boolean;
  from: string;
  recipient: string | null;
  recipient_verified: boolean;
};

export type PersonalBriefingJob = {
  id: string;
  user_id: number;
  briefing_date: string;
  status: "queued" | "running" | "success" | "failed";
  delivery_requested: boolean;
  delivery_status: "queued" | "sending" | "sent" | "failed" | "suppressed" | null;
  briefing_id: number | null;
  attempt_count: number;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
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
  email_enabled?: boolean;
  email_theme?: "light" | "dark";
  scheduled_time?: string;
  timezone?: string;
  industries?: string[];
  company_symbols?: string[];
  country_iso2s?: string[];
  regions?: string[];
  max_items?: number;
}): Promise<DailyBriefingSchedule> {
  return requestDailyBriefingSchedule({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, "Failed to update daily briefing schedule");
}

export async function fetchDailyBriefingPreferenceOptions(): Promise<DailyBriefingPreferenceOptions> {
  const resp = await fetch(`${API_BASE}/api/briefings/daily/preferences/options`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch briefing preference options"));
  const data = await resp.json();
  return data.options as DailyBriefingPreferenceOptions;
}

export async function fetchDailyBriefingEmailStatus(): Promise<DailyBriefingEmailStatus> {
  const resp = await fetch(`${API_BASE}/api/briefings/daily/email/status`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch briefing email status"));
  const data = await resp.json();
  return data.email as DailyBriefingEmailStatus;
}

export async function requestEmailVerification(): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/email-verifications`, { method: "POST", credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to request email verification"));
}

export async function sendPersonalBriefingPreview(): Promise<PersonalBriefingJob> {
  const resp = await fetch(`${API_BASE}/api/briefings/daily/personal/preview`, {
    method: "POST",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to queue briefing preview"));
  const data = await resp.json();
  return data.job as PersonalBriefingJob;
}

export async function fetchPersonalBriefingJob(jobId: string): Promise<PersonalBriefingJob> {
  const resp = await fetch(
    `${API_BASE}/api/briefings/daily/personal/jobs/${encodeURIComponent(jobId)}`,
    { credentials: "include" },
  );
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch briefing preview status"));
  const data = await resp.json();
  return data.job as PersonalBriefingJob;
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

export async function fetchNews(params?: { limit?: number; offset?: number; q?: string; country?: string; language?: string; sourceCountry?: string; provider?: string }) {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  if (params?.q) sp.set("q", params.q);
  if (params?.country) sp.set("country", params.country);
  if (params?.language) sp.set("language", params.language);
  if (params?.sourceCountry) sp.set("source_country", params.sourceCountry);
  if (params?.provider) sp.set("provider", params.provider);
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

export async function fetchMarketFilings(params?: { symbol?: string; forms?: string[]; limit?: number }) {
  const sp = new URLSearchParams();
  if (params?.symbol) sp.set("symbol", params.symbol);
  if (params?.forms?.length) sp.set("forms", params.forms.join(","));
  if (params?.limit) sp.set("limit", String(params.limit));
  const resp = await fetch(`${API_BASE}/api/market/filings?${sp.toString()}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch SEC filings"));
  const data = await resp.json();
  return (data.filings ?? []) as MarketFiling[];
}

export async function fetchMarketIndicators(params?: { symbol?: string; category?: string; limit?: number }) {
  const sp = new URLSearchParams();
  if (params?.symbol) sp.set("symbol", params.symbol);
  if (params?.category) sp.set("category", params.category);
  if (params?.limit) sp.set("limit", String(params.limit));
  const resp = await fetch(`${API_BASE}/api/market/indicators?${sp.toString()}`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch market indicators"));
  const data = await resp.json();
  return (data.indicators ?? []) as MarketIndicator[];
}

export async function fetchFxRates() {
  const resp = await fetch(`${API_BASE}/api/market/fx`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ECB FX rates"));
  const data = await resp.json();
  return (data.rates ?? []) as FxRate[];
}

export async function fetchPolicyRates() {
  const resp = await fetch(`${API_BASE}/api/market/rates`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch ECB policy rates"));
  const data = await resp.json();
  return (data.rates ?? []) as PolicyRate[];
}

export async function fetchCountryMarketOverview(): Promise<CountryMarketOverviewResponse> {
  const resp = await fetch(`${API_BASE}/api/market/countries`, { credentials: "include" });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch country market overview"));
  return (await resp.json()) as CountryMarketOverviewResponse;
}

export async function fetchCountryMarketDetail(country: string): Promise<CountryMarketDetail> {
  const resp = await fetch(`${API_BASE}/api/market/countries/${encodeURIComponent(country)}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch country market detail"));
  return (await resp.json()) as CountryMarketDetail;
}

export async function fetchTransportOverview(params?: {
  detail?: "aggregate" | "full";
  mode?: TransportMode;
  country?: string;
  entityLimit?: number;
  refresh?: boolean;
}): Promise<TransportOverview> {
  const sp = new URLSearchParams();
  if (params?.detail) sp.set("detail", params.detail);
  if (params?.mode) sp.set("mode", params.mode);
  if (params?.country) sp.set("country", params.country);
  if (typeof params?.entityLimit === "number") {
    sp.set("entity_limit", String(params.entityLimit));
  }
  if (params?.refresh) sp.set("refresh", "true");
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  const resp = await fetch(`${API_BASE}/api/transport/overview${suffix}`, {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch transport intelligence"));
  return (await resp.json()) as TransportOverview;
}

export async function fetchTransportEntity(
  mode: TransportMode,
  entityId: string,
): Promise<{ entity: TransportEntity; track: TransportTrackPoint[] }> {
  const resp = await fetch(
    `${API_BASE}/api/transport/entities/${mode}/${encodeURIComponent(entityId)}`,
    { credentials: "include" },
  );
  if (!resp.ok) throw new Error(await readError(resp, "Failed to fetch transport track"));
  return (await resp.json()) as {
    entity: TransportEntity;
    track: TransportTrackPoint[];
  };
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
    gdelt?: boolean;
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
  providers?: { openmeteo?: boolean; openweather?: boolean };
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
  providers?: { secEdgar?: boolean; ecb?: boolean };
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
