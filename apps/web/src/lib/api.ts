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

const API_BASE = ''; // relative to same host; In dev, consider proxying /api to backend

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
