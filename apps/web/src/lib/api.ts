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
export type AuthProvider = { id: AuthProviderId; enabled: boolean };
export type AuthUser = { id: number; email: string | null; display_name: string | null; avatar_url: string | null; roles: string[] };

const API_BASE = ''; // relative to same host; In dev, consider proxying /api to backend

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
