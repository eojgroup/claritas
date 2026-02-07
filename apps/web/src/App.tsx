import { useEffect, useMemo, useState } from "react";
import { Search, Bell, Settings, User, Moon, Sun, LogOut, ChevronLeft } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ZAxis,
} from "recharts";

// --- Utility mock data ---
const pieData = [
  { name: "Cat A", value: 45 },
  { name: "Cat B", value: 25 },
  { name: "Cat C", value: 30 },
];

const scatterData = [
  { x: 10, y: 30 },
  { x: 20, y: 20 },
  { x: 30, y: 27 },
  { x: 40, y: 35 },
  { x: 50, y: 18 },
];

const legalPolicies = [
  {
    id: "cookie-policy",
    title: "Cookie Policy",
    intro:
      "We use cookies and similar technologies to keep Claritas secure, remember your preferences, and understand how the service is used.",
    items: [
      "Strictly necessary cookies keep sessions active and protect against unauthorized access.",
      "Preference cookies remember choices like language and theme so the interface stays consistent.",
      "Analytics cookies help us measure performance and improve the clarity of dashboards.",
      "Marketing cookies are only used when enabled to surface relevant updates.",
    ],
    note:
      "You can manage cookie settings in your browser and clear stored data at any time. Disabling some cookies may impact sign-in or personalization.",
  },
  {
    id: "privacy-statement",
    title: "Privacy Statement",
    intro:
      "Claritas collects only the data needed to provide the service, including account identifiers, security logs, and usage signals.",
    items: [
      "We process authentication data to verify identity and manage access across providers.",
      "Operational metrics are used to keep the platform reliable and to monitor anomalies.",
      "We do not sell personal information; data is shared only with trusted service providers.",
      "Retention is limited to what is required for security, compliance, and support.",
    ],
    note:
      "You can request access, correction, or deletion of your data through your account administrator or support contact.",
  },
  {
    id: "terms-of-use",
    title: "Terms of Use",
    intro:
      "By using Claritas you agree to use the platform responsibly and only for authorized business purposes.",
    items: [
      "Do not attempt to bypass security controls or access data you are not permitted to see.",
      "Respect rate limits and avoid actions that could degrade service for other users.",
      "All content, dashboards, and reports remain the property of Claritas and its licensors.",
      "We may update these terms to reflect product or regulatory changes.",
    ],
    note:
      "Violations may result in suspended access or termination of accounts. Continued use indicates acceptance of updated terms.",
  },
  {
    id: "copyright",
    title: "Copyright",
    intro:
      "Claritas content, visualizations, and branding are protected by copyright and other intellectual property laws.",
    items: [
      "You may use Claritas outputs for internal analysis and reporting within your organization.",
      "Do not reproduce, distribute, or publish Claritas materials without written permission.",
      "Third-party data sources remain subject to their own licensing terms.",
      "Trademarks and logos must not be altered or used in a misleading way.",
    ],
    note:
      "For licensing questions or permissions, contact your Claritas representative.",
  },
];

import WorldMapBubbles from "./components/WorldMapBubbles";
import LoginPage from "./components/LoginPage";
import {
  fetchAuthMe,
  fetchAuthProviders,
  fetchCountryStats,
  fetchCountryWeather,
  fetchNews,
  getAuthStartUrl,
  logoutAuth,
  imageProxy,
  ingestWeatherNow,
  type AuthProvider,
  type AuthProviderId,
  type AuthUser,
  type CountryStat,
  type CountryWeather,
  type NewsItem,
} from "./lib/api";

export default function ClaritasDashboard() {
  const [query, setQuery] = useState("");
  const [authStatus, setAuthStatus] = useState<"checking" | "authed" | "unauthed">("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"dashboard" | "profile">("dashboard");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<{ tone: "error" | "success" | "info"; message: string } | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('theme');
      if (v === 'dark') return true;
      if (v === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [countryStats, setCountryStats] = useState<CountryStat[]>([]);
  const [weatherStats, setWeatherStats] = useState<CountryWeather[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [mapMode, setMapMode] = useState<"news" | "weather">("news");
  const [listMode, setListMode] = useState<"news" | "weather">("news");
  const [minTemp, setMinTemp] = useState<number | undefined>(undefined);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const authProviderMap = useMemo(() => new Map(authProviders.map((p) => [p.id, p])), [authProviders]);

  useEffect(() => {
    const el = document.documentElement;
    if (dark) el.classList.add('dark'); else el.classList.remove('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  useEffect(() => {
    let active = true;
    setAuthStatus("checking");
    setAuthError(null);

    Promise.allSettled([fetchAuthMe(), fetchAuthProviders()]).then(([userRes, providersRes]) => {
      if (!active) return;

      const user = userRes.status === "fulfilled" ? userRes.value : null;
      const providers = providersRes.status === "fulfilled" ? providersRes.value : [];
      const errors: string[] = [];

      if (userRes.status === "rejected") {
        errors.push(userRes.reason instanceof Error ? userRes.reason.message : String(userRes.reason));
      }
      if (providersRes.status === "rejected") {
        errors.push(providersRes.reason instanceof Error ? providersRes.reason.message : String(providersRes.reason));
      }

      setAuthUser(user);
      setAuthProviders(providers);
      setAuthError(errors.length > 0 ? errors.join(" | ") : null);
      setAuthStatus(user ? "authed" : "unauthed");
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Load initial data
    if (authStatus !== "authed") return;
    fetchCountryStats({ days: 30 }).then(setCountryStats).catch(() => setCountryStats([]));
    fetchCountryWeather().then(setWeatherStats).catch(() => setWeatherStats([]));
    fetchNews({ limit: 20 }).then(setNews).catch(() => setNews([]));
  }, [authStatus]);

  useEffect(() => {
    // When a country is selected, refetch list filtered by country
    if (authStatus !== "authed") return;
    if (selectedCountry) {
      fetchNews({ limit: 20, country: selectedCountry }).then(setNews).catch(() => setNews([]));
    } else {
      fetchNews({ limit: 20 }).then(setNews).catch(() => setNews([]));
    }
  }, [selectedCountry, authStatus]);

  const pieColors = useMemo(
    () => ["#0B1E2D", "#2F4455", "#4E6473"],
    []
  );
  const cardBase =
    "rounded-2xl border border-[color:var(--home-border)] bg-[color:var(--home-surface)] shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-700/70 dark:bg-slate-900/70";

  const filteredWeather = useMemo(() => {
    let w = weatherStats;
    if (typeof minTemp === 'number') {
      w = w.filter(x => (x.temp_c ?? -999) >= minTemp);
    }
    if (selectedCountry) {
      const iso = selectedCountry.toUpperCase();
      w = w.filter(x => (x.country || '').toUpperCase() === iso);
    }
    return w;
  }, [weatherStats, minTemp, selectedCountry]);

  async function handleRefreshWeather() {
    try {
      setIsRefreshingWeather(true);
      await ingestWeatherNow(selectedCountry || undefined);
      const next = await fetchCountryWeather();
      setWeatherStats(next);
    } catch {
      // ignore for now
    } finally {
      setIsRefreshingWeather(false);
    }
  }

  const userLabel = authUser?.display_name || authUser?.email || "Signed in";
  const userInitial = (authUser?.display_name || authUser?.email || "C")[0]?.toUpperCase() ?? "C";
  const providerLabels: Record<AuthProviderId, string> = {
    google: "Google",
    microsoft: "Microsoft",
    apple: "Apple",
  };

  const handleSignIn = (provider: AuthProviderId) => {
    const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const providerMeta = authProviderMap.get(provider);
    if (providerMeta?.start_path) {
      const url = new URL(providerMeta.start_path, window.location.origin);
      url.searchParams.set("redirect", redirect);
      window.location.assign(url.toString());
      return;
    }
    window.location.assign(getAuthStartUrl(provider, redirect));
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSessionNotice(null);
    try {
      await logoutAuth();
      setAuthUser(null);
      setAuthStatus("unauthed");
      setActiveView("dashboard");
      setAuthError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSessionNotice({ tone: "error", message: `Sign out failed: ${message}` });
    } finally {
      setIsSigningOut(false);
    }
  };

  if (authStatus !== "authed") {
    return (
      <LoginPage
        providers={authProviders}
        status={authStatus}
        error={authError}
        onSignIn={handleSignIn}
      />
    );
  }

  return (
    <div className="min-h-screen w-full bg-[color:var(--home-bg)] text-[color:var(--home-ink)] dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <header className="border-b border-[color:var(--home-border)] bg-[color:var(--home-header)]">
        <div className="mx-auto max-w-7xl px-4 py-5 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14">
              <div className="absolute -left-4 top-0 h-14 w-14 rounded-full bg-[#0B1E2D]" />
              <div className="absolute left-1 top-0 h-14 w-14 rounded-full bg-[#3E4F5F] opacity-90" />
            </div>
            <span
              className="text-2xl font-semibold tracking-[0.12em] text-[#0B1E2D]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              CLARITAS
            </span>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-3 text-[color:var(--home-muted)]">
            {authUser && (
              <div className="hidden md:flex items-center gap-2 rounded-full border border-[color:var(--home-border)] bg-[color:var(--home-surface)] px-3 py-1 text-xs text-[color:var(--home-muted)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="max-w-[180px] truncate">{userLabel}</span>
              </div>
            )}
            <button
              aria-label="Toggle dark mode"
              onClick={() => setDark(v => !v)}
              className="h-9 w-9 rounded-lg border border-[color:var(--home-border)] bg-[color:var(--home-surface)] text-[color:var(--home-ink)] shadow-sm hover:bg-slate-50 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
            >
              <span className="grid h-full w-full place-items-center">
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView("profile")}
              className={`h-9 w-9 rounded-lg border text-[color:var(--home-ink)] shadow-sm transition ${
                activeView === "profile"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-[color:var(--home-border)] bg-[color:var(--home-surface)] hover:bg-slate-50"
              }`}
              aria-label="Profile"
            >
              <span className="grid h-full w-full place-items-center">
                <User className="h-5 w-5" />
              </span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 shadow-sm hover:border-rose-300 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{isSigningOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      {sessionNotice && (
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-6">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              sessionNotice.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : sessionNotice.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {sessionNotice.message}
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-12 gap-6">
        {activeView === "profile" ? (
          <section className="col-span-12">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.35em] text-slate-500">Account</div>
                <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-display)" }}>
                  Profile & access
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  Review identity details, provider status, and session preferences across devices.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveView("dashboard")}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-400"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back to dashboard
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:border-rose-300 disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4" />
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6">
                <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-6 text-white shadow-sm">
                  <div className="absolute -top-16 right-0 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 overflow-hidden rounded-2xl bg-white/15 text-2xl font-semibold uppercase text-white ring-1 ring-white/25">
                        {authUser?.avatar_url ? (
                          <img src={authUser.avatar_url} alt="User avatar" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full w-full place-items-center">{userInitial}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-sm uppercase tracking-[0.2em] text-slate-300">Signed in as</div>
                        <div className="text-2xl font-semibold">{userLabel}</div>
                        <div className="text-sm text-slate-300">{authUser?.email ?? "Email not provided"}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm">
                      <div className="text-xs uppercase tracking-[0.3em] text-slate-300">Session</div>
                      <div className="mt-1 text-base font-semibold">Active</div>
                      <div className="text-xs text-slate-300">Managed by identity provider</div>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2 text-xs">
                    {(authUser?.roles?.length ? authUser.roles : ["Standard access"]).map((role) => (
                      <span key={role} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 uppercase tracking-[0.2em]">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>

                <div className={cardBase + " p-6"}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Account details</div>
                    <Settings className="h-4 w-4 text-slate-400" />
                  </div>
                  <dl className="mt-4 divide-y divide-slate-100 dark:divide-slate-700/60 text-sm">
                    {[
                      { label: "User ID", value: authUser?.id ? String(authUser.id) : "—" },
                      { label: "Display name", value: authUser?.display_name ?? "Not set" },
                      { label: "Email", value: authUser?.email ?? "Not provided" },
                      { label: "Roles", value: authUser?.roles?.length ? authUser.roles.join(", ") : "Standard access" },
                    ].map((row) => (
                      <div key={row.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <dt className="text-slate-500">{row.label}</dt>
                        <dd className="font-medium text-slate-900 dark:text-slate-100">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <div className="space-y-6">
                <div className={cardBase + " p-6"}>
                  <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Identity providers</div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    Available sign-in methods connected to this environment.
                  </p>
                  <div className="mt-4 space-y-3">
                    {authProviders.length === 0 && (
                      <div className="text-sm text-slate-500">No providers reported yet.</div>
                    )}
                    {authProviders.map((provider) => (
                      <div
                        key={provider.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {providerLabels[provider.id]}
                          </div>
                          <div className="text-xs text-slate-500">
                            {provider.enabled ? "Enabled and ready" : "Disabled"}
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            provider.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {provider.enabled ? "Active" : "Inactive"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={cardBase + " p-6"}>
                  <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Preferences</div>
                  <div className="mt-4 space-y-4 text-sm text-slate-600 dark:text-slate-300">
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">Theme</div>
                        <div className="text-xs text-slate-500">Match your current workspace.</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDark(v => !v)}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                      >
                        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        {dark ? "Light" : "Dark"}
                      </button>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">Default map view</div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => { setMapMode("news"); setListMode("news"); }}
                          className={`rounded-full border px-3 py-1 ${
                            mapMode === "news" ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600"
                          }`}
                        >
                          News
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMapMode("weather"); setListMode("weather"); }}
                          className={`rounded-full border px-3 py-1 ${
                            mapMode === "weather" ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600"
                          }`}
                        >
                          Weather
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
        <>
        {/* LEFT: Map + AI Search + News/Country Profile */}
        <section className="col-span-12 lg:col-span-7 flex flex-col gap-6">
          {/* Map Card */}
          <div className={cardBase}>
            <div className="p-4 border-b border-[color:var(--home-border)] text-sm text-[color:var(--home-muted)] flex items-center justify-between">
              <span>Map: {mapMode === 'news' ? '#News per country' : 'Weather (temperature) per country'}</span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  className={`px-2 py-1 rounded border ${mapMode === 'news' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-[color:var(--home-muted)] border-[color:var(--home-border)]'}`}
                  onClick={() => { setMapMode('news'); setListMode('news'); }}
                >News</button>
                <button
                  className={`px-2 py-1 rounded border ${mapMode === 'weather' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-[color:var(--home-muted)] border-[color:var(--home-border)]'}`}
                  onClick={() => { setMapMode('weather'); setListMode('weather'); }}
                >Weather</button>
              </div>
            </div>
            <div className="relative p-4">
              <div className="aspect-[16/9] rounded-xl overflow-hidden">
                {/* Render based on selected mode */}
                {mapMode === 'news' ? (
                  <WorldMapBubbles
                    data={
                      (countryStats && countryStats.length > 0)
                        ? countryStats
                        : Object.entries(
                            (news || []).reduce<Record<string, number>>((acc, n) => {
                              const iso = (n.country_iso2 || "").toUpperCase();
                              if (!iso) return acc;
                              acc[iso] = (acc[iso] || 0) + 1;
                              return acc;
                            }, {})
                          ).map(([country, count]) => ({ country, count }))
                    }
                    onSelect={setSelectedCountry}
                    dark={dark}
                  />
                ) : (
                  <WorldMapBubbles
                    data={(() => {
                      const withTemp = (weatherStats || []).filter(w => typeof w.temp_c === 'number');
                      if (withTemp.length === 0) return [];
                      const temps = withTemp.map(w => Number(w.temp_c));
                      const min = Math.min(...temps);
                      return withTemp.map(w => ({
                        country: (w.country || '').toUpperCase(),
                        // Normalize so the smallest temp still has some radius
                        count: (Number(w.temp_c) - min) + 1,
                      }));
                    })()}
                    onSelect={setSelectedCountry}
                    dark={dark}
                  />
                )}
              </div>
              {mapMode === 'news' && countryStats.length === 0 && (
                <div className="absolute bottom-3 right-4 text-xs text-[color:var(--home-muted)] bg-white/70 px-2 py-1 rounded shadow-sm border border-[color:var(--home-border)]">
                  No aggregated stats yet — showing live list fallback
                </div>
              )}
              {mapMode === 'weather' && (weatherStats?.length ?? 0) === 0 && (
                <div className="absolute bottom-3 right-4 text-xs text-[color:var(--home-muted)] bg-white/80 px-2 py-1 rounded shadow-sm border border-[color:var(--home-border)] flex items-center gap-2">
                  <span>No weather stats yet.</span>
                  <button onClick={handleRefreshWeather} disabled={isRefreshingWeather}
                          className="px-2 py-0.5 rounded border border-[color:var(--home-border)] bg-white hover:bg-slate-50 disabled:opacity-50">
                    {isRefreshingWeather ? 'Refreshing…' : 'Refresh now'}
                  </button>
                </div>
              )}
            </div>
            {/* AI Search */}
            <div className="border-t border-[color:var(--home-border)] p-3">
              <div className="flex items-center gap-2 rounded-xl border border-[color:var(--home-border)] bg-white px-3 py-2 shadow-inner">
                <Search className="h-5 w-5 text-[color:var(--home-muted)]" />
                <input
                  className="w-full bg-transparent outline-none placeholder:text-[color:var(--home-muted)] text-inherit"
                  placeholder="AI Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-white text-sm">Search</button>
              </div>
            </div>
          </div>

          {/* News + Country Profile grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={cardBase}>
              <div className="p-4 border-b border-[color:var(--home-border)] font-semibold flex items-center gap-2">
                <span>List</span>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <button
                    className={`px-2 py-1 rounded border ${listMode === 'news' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-[color:var(--home-muted)] border-[color:var(--home-border)]'}`}
                    onClick={() => setListMode('news')}
                  >News</button>
                  <button
                    className={`px-2 py-1 rounded border ${listMode === 'weather' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-[color:var(--home-muted)] border-[color:var(--home-border)]'}`}
                    onClick={() => setListMode('weather')}
                  >Weather</button>
                </div>
              </div>

              {listMode === 'news' ? (
                <ul className="list-none p-4 space-y-3">
                  {news.length === 0 && (
                    <li className="text-sm text-slate-500 dark:text-slate-400">No news items yet.</li>
                  )}
                  {news.map((n) => {
                    const img = imageProxy((n as any)?.payload?.urlToImage ?? (n as any)?.payload?.raw?.urlToImage);
                    return (
                      <li key={n.id} className="rounded-lg border border-[color:var(--home-border)] p-3 hover:bg-slate-50">
                        <div className="flex items-start gap-3">
                          <div className="relative w-32 h-20 rounded-md overflow-hidden border border-[color:var(--home-border)] bg-slate-100 flex-none">
                            {img ? (
                              <img
                                src={img}
                                alt={n.title ?? 'thumbnail'}
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                                onError={(e) => ((e.currentTarget.style.display = 'none'))}
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <a href={n.url ?? '#'} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline">
                              {n.title || n.url || 'Untitled'}
                            </a>
                            <div className="text-xs text-[color:var(--home-muted)] mt-1 flex items-center gap-2 flex-wrap">
                              {n.country_iso2 && <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-[color:var(--home-border)] text-slate-700">{n.country_iso2}</span>}
                              {n.event_time && <span>{new Date(n.event_time).toLocaleString()}</span>}
                            </div>
                            {n.summary && <p className="text-sm text-slate-600 mt-1 line-clamp-3">{n.summary}</p>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <label className="text-[color:var(--home-muted)]">Min temp (°C)</label>
                    <input type="number" className="w-24 rounded border border-[color:var(--home-border)] bg-white px-2 py-1"
                      value={typeof minTemp === 'number' ? minTemp : ''}
                      onChange={(e) => setMinTemp(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
                      placeholder="Any" />
                    <button onClick={handleRefreshWeather} disabled={isRefreshingWeather}
                      className="ml-auto px-2 py-1 rounded border border-[color:var(--home-border)] bg-white hover:bg-slate-50 disabled:opacity-50">
                      {isRefreshingWeather ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                  <ul className="list-none divide-y divide-[color:var(--home-border)]">
                    {filteredWeather.length === 0 && (
                      <li className="text-sm text-[color:var(--home-muted)] py-3">No weather rows.</li>
                    )}
                    {filteredWeather.map((w, i) => (
                      <li key={`${w.country}-${i}`} className="py-2 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-[color:var(--home-border)] text-slate-700">{(w.country || '').toUpperCase()}</span>
                          <span className="text-slate-700 text-sm">{new Date(w.observed_at).toLocaleString()}</span>
                        </div>
                        <div className="text-sm text-slate-800 flex items-center gap-4">
                          <span title="Temperature">🌡️ {w.temp_c ?? '—'}°C</span>
                          <span title="Humidity">💧 {w.humidity ?? '—'}%</span>
                          {w.weather_main && <span className="text-slate-600">{w.weather_main}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

          <div className={cardBase}>
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-semibold">Country profile based on selection</div>
            <div className="p-4 text-sm text-slate-600 dark:text-slate-300 space-y-2">
                {!selectedCountry && (
                  <div>Select a bubble on the map to see a brief profile.</div>
                )}
                {selectedCountry && (
                  <>
                    <div className="text-base font-semibold">Country: {selectedCountry}</div>
                    <div>Recent items from this country in the list are highlighted by the country tag.</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT: Analytics + Notifications */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          <div className={cardBase}>
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-semibold">
              News/number of ships etc per category
            </div>
            <div className="p-4 space-y-6">
              {/* Scatter */}
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                    <XAxis dataKey="x" tick={{ fontSize: 12 }} />
                    <YAxis dataKey="y" tick={{ fontSize: 12 }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter data={scatterData} fill="#94a3b8" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Pie */}
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={pieColors[i % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className={cardBase}>
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-semibold flex items-center gap-2">
              <Bell className="h-5 w-5" /> Notifications
            </div>
            <div className="p-4 text-sm text-slate-600 dark:text-slate-300">No notifications yet.</div>
          </div>
        </section>
        </>
        )}
      </main>

      <section id="legal" className="border-t border-[color:var(--home-border)] bg-[color:var(--home-header)]">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="flex flex-col gap-2">
            <div className="text-xs uppercase tracking-[0.4em] text-slate-500">Legal</div>
            <h2
              className="text-2xl font-semibold text-slate-900"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Policies and usage guidelines
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl">
              Review the policy summaries below. Each section describes how Claritas protects data,
              governs platform use, and supports compliance.
            </p>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {legalPolicies.map((policy) => (
              <article
                key={policy.id}
                id={policy.id}
              className="scroll-mt-24 rounded-2xl border border-[color:var(--home-border)] bg-white p-6 shadow-sm"
            >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">{policy.title}</h3>
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Claritas</span>
                </div>
                <p className="mt-3 text-sm text-slate-600">{policy.intro}</p>
                <ul className="mt-4 space-y-2 text-sm text-slate-600">
                  {policy.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-slate-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-slate-600">{policy.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--home-border)] bg-slate-700 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold tracking-[0.35em] uppercase">Claritas</div>
          <nav aria-label="Legal links" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <a href="#cookie-policy" className="transition hover:text-white/90">
              Cookie Policy
            </a>
            <a href="#privacy-statement" className="transition hover:text-white/90">
              Privacy Statement
            </a>
            <a href="#terms-of-use" className="transition hover:text-white/90">
              Terms of Use
            </a>
            <a href="#copyright" className="transition hover:text-white/90">
              Copyright
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
