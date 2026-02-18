export type NewsItem = {
  id: number;
  kind: string | null;
  title: string | null;
  summary: string | null;
  url: string | null;
  country_iso2: string | null;
  event_time: string | null; // ISO
  payload?: any;
};

export type CountryStat = { country: string; count: number };
export type CountryWeather = { country: string; temp_c: number | null; humidity: number | null; observed_at: string; weather_main: string | null };
export type AuthProviderId = "google" | "microsoft" | "apple";
export type IngestionPipeline = "news" | "weather";
export type IngestionRunStatus = "queued" | "running" | "success" | "failed" | "unknown";
export type AdminRole = {
  id: number;
  key: string;
  description: string | null;
  user_count: number;
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
};
export type AuthProvider = {
  id: AuthProviderId;
  enabled: boolean;
  display_name?: string;
  icon?: AuthProviderId;
  start_path?: string;
};
export type AuthUser = { id: number; email: string | null; display_name: string | null; avatar_url: string | null; roles: string[] };
export type AdminIngestionRun = {
  id: number;
  pipeline: IngestionPipeline;
  source_name: string;
  status: IngestionRunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: any;
  trigger_mode: string | null;
  requested_by_email: string | null;
  request_payload: any;
  log_count: number;
};
export type AdminIngestionLog = {
  id: number;
  run_id: number;
  logged_at: string;
  level: "info" | "warn" | "error";
  message: string;
  context: any | null;
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

const API_BASE = ''; // relative to same host; In dev, consider proxying /api to backend

async function readError(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.json();
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
  } catch {
    // ignore
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
  if (!resp.ok) throw new Error(`Failed to fetch auth session: ${resp.status}`);
  const data = await resp.json();
  return (data.user ?? null) as AuthUser | null;
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
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.offset) sp.set('offset', String(params.offset));
  if (params?.q) sp.set('q', params.q);
  if (params?.country) sp.set('country', params.country);
  const resp = await fetch(`${API_BASE}/api/news?${sp.toString()}`);
  if (!resp.ok) throw new Error(`Failed to fetch news: ${resp.status}`);
  const data = await resp.json();
  return (data.items ?? []) as NewsItem[];
}

export async function fetchCountryStats(params?: { days?: number }) {
  const sp = new URLSearchParams();
  if (params?.days) sp.set('days', String(params.days));
  const resp = await fetch(`${API_BASE}/api/news/country-stats?${sp.toString()}`);
  if (!resp.ok) throw new Error(`Failed to fetch country stats: ${resp.status}`);
  const data = await resp.json();
  return (data.stats ?? []) as CountryStat[];
}

export async function fetchCountryWeather() {
  const resp = await fetch(`${API_BASE}/api/weather/country-latest`);
  if (!resp.ok) throw new Error(`Failed to fetch country weather: ${resp.status}`);
  const data = await resp.json();
  return (data.stats ?? []) as CountryWeather[];
}

export async function ingestWeatherNow(country?: string) {
  const resp = await fetch(`${API_BASE}/api/ingest/openweather/country-current`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(country ? { country } : {}),
  });
  if (!resp.ok) throw new Error(`Failed to ingest weather: ${resp.status}`);
  return await resp.json();
}

export async function triggerAdminNewsIngestion(payload?: {
  everything?: false | {
    q?: string;
    language?: string;
    pageSize?: number;
    maxPages?: number;
  };
  topHeadlines?: false | {
    country?: string;
    category?: string;
    q?: string;
    pageSize?: number;
    maxPages?: number;
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
  roles: string[],
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
  is_active: boolean,
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

export function imageProxy(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    // Encode once and attach to the API proxy path (same origin)
    const u = new URL(url);
    return `/api/proxy-image?url=${encodeURIComponent(u.toString())}`;
  } catch {
    return undefined;
  }
}
