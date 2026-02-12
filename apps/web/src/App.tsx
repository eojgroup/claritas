import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Bell,
  Settings,
  User,
  Moon,
  Sun,
  LogOut,
  ChevronLeft,
  Menu,
  LayoutGrid,
  FileText,
} from "lucide-react";
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
    note: "You can manage cookie settings in your browser and clear stored data at any time. Disabling some cookies may impact sign-in or personalization.",
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
    note: "You can request access, correction, or deletion of your data through your account administrator or support contact.",
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
    note: "Violations may result in suspended access or termination of accounts. Continued use indicates acceptance of updated terms.",
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
    note: "For licensing questions or permissions, contact your Claritas representative.",
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
  const [authStatus, setAuthStatus] = useState<
    "checking" | "authed" | "unauthed"
  >("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<
    "dashboard" | "profile" | "legal"
  >("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<{
    tone: "error" | "success" | "info";
    message: string;
  } | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("theme");
      if (v === "dark") return true;
      if (v === "light") return false;
      return (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    } catch {
      return false;
    }
  });
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [countryStats, setCountryStats] = useState<CountryStat[]>([]);
  const [weatherStats, setWeatherStats] = useState<CountryWeather[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [mapMode, setMapMode] = useState<"news" | "weather">("news");
  const [listMode, setListMode] = useState<"news" | "weather">("news");
  const [minTemp, setMinTemp] = useState<number | undefined>(undefined);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [profileSection, setProfileSection] = useState<
    "overview" | "identity" | "preferences" | "security" | "policies"
  >("overview");
  const authProviderMap = useMemo(
    () => new Map(authProviders.map((p) => [p.id, p])),
    [authProviders],
  );

  useEffect(() => {
    const el = document.documentElement;
    if (dark) el.classList.add("dark");
    else el.classList.remove("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);

  useEffect(() => {
    const legalIds = new Set(legalPolicies.map((policy) => policy.id));
    const profileIds = new Set(profileSections.map((section) => section.id));
    const handleHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;
      if (legalIds.has(hash)) {
        setActiveView("legal");
        setTimeout(() => {
          document
            .getElementById(hash)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
        return;
      }
      if (hash.startsWith("profile-")) {
        const sectionId = hash.replace("profile-", "");
        if (
          profileIds.has(sectionId as (typeof profileSections)[number]["id"])
        ) {
          setActiveView("profile");
          setProfileSection(
            sectionId as (typeof profileSections)[number]["id"],
          );
          setTimeout(() => {
            document
              .getElementById(hash)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        }
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    if (activeView === "profile") {
      setProfileSection("overview");
    }
  }, [activeView]);

  useEffect(() => {
    let active = true;
    setAuthStatus("checking");
    setAuthError(null);

    Promise.allSettled([fetchAuthMe(), fetchAuthProviders()]).then(
      ([userRes, providersRes]) => {
        if (!active) return;

        const user = userRes.status === "fulfilled" ? userRes.value : null;
        const providers =
          providersRes.status === "fulfilled" ? providersRes.value : [];
        const errors: string[] = [];

        if (userRes.status === "rejected") {
          errors.push(
            userRes.reason instanceof Error
              ? userRes.reason.message
              : String(userRes.reason),
          );
        }
        if (providersRes.status === "rejected") {
          errors.push(
            providersRes.reason instanceof Error
              ? providersRes.reason.message
              : String(providersRes.reason),
          );
        }

        setAuthUser(user);
        setAuthProviders(providers);
        setAuthError(errors.length > 0 ? errors.join(" | ") : null);
        setAuthStatus(user ? "authed" : "unauthed");
      },
    );

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Load initial data
    if (authStatus !== "authed") return;
    fetchCountryStats({ days: 30 })
      .then(setCountryStats)
      .catch(() => setCountryStats([]));
    fetchCountryWeather()
      .then(setWeatherStats)
      .catch(() => setWeatherStats([]));
    fetchNews({ limit: 20 })
      .then(setNews)
      .catch(() => setNews([]));
  }, [authStatus]);

  useEffect(() => {
    // When a country is selected, refetch list filtered by country
    if (authStatus !== "authed") return;
    if (selectedCountry) {
      fetchNews({ limit: 20, country: selectedCountry })
        .then(setNews)
        .catch(() => setNews([]));
    } else {
      fetchNews({ limit: 20 })
        .then(setNews)
        .catch(() => setNews([]));
    }
  }, [selectedCountry, authStatus]);

  const pieColors = useMemo(() => ["#0B1E2D", "#2F4455", "#4E6473"], []);
  const cardBase =
    "rounded-2xl border border-[color:var(--shell-border)] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/70";

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  const activeRegions = useMemo(() => {
    const regions = new Set<string>();
    countryStats.forEach(
      (stat) => stat.country && regions.add(stat.country.toUpperCase()),
    );
    news.forEach(
      (item) =>
        item.country_iso2 && regions.add(item.country_iso2.toUpperCase()),
    );
    weatherStats.forEach(
      (item) => item.country && regions.add(item.country.toUpperCase()),
    );
    return regions.size;
  }, [countryStats, news, weatherStats]);

  const latestEventLabel = useMemo(() => {
    const times: number[] = [];
    news.forEach((item) => {
      if (item.event_time) {
        const time = Date.parse(item.event_time);
        if (!Number.isNaN(time)) times.push(time);
      }
    });
    weatherStats.forEach((item) => {
      const time = Date.parse(item.observed_at);
      if (!Number.isNaN(time)) times.push(time);
    });
    if (times.length === 0) return "Awaiting new syncs";
    const latest = new Date(Math.max(...times));
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(latest);
  }, [news, weatherStats]);

  const focusLabel = selectedCountry ? selectedCountry.toUpperCase() : "Global";

  const filteredWeather = useMemo(() => {
    let w = weatherStats;
    if (typeof minTemp === "number") {
      w = w.filter((x) => (x.temp_c ?? -999) >= minTemp);
    }
    if (selectedCountry) {
      const iso = selectedCountry.toUpperCase();
      w = w.filter((x) => (x.country || "").toUpperCase() === iso);
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
  const userInitial =
    (authUser?.display_name || authUser?.email || "C")[0]?.toUpperCase() ?? "C";
  const providerLabels: Record<AuthProviderId, string> = {
    google: "Google",
    microsoft: "Microsoft",
    apple: "Apple",
  };

  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      view: "dashboard" as const,
      icon: LayoutGrid,
    },
    { id: "profile", label: "Profile", view: "profile" as const, icon: User },
    { id: "legal", label: "Policies", view: "legal" as const, icon: FileText },
  ];

  const viewMeta = {
    dashboard: { kicker: "Dashboard", title: "Signal desk overview" },
    profile: { kicker: "Account", title: "Profile & access" },
    legal: { kicker: "Legal", title: "Policies & usage" },
  } as const;

  const profileSections = [
    { id: "overview", label: "Overview", description: "Identity snapshot" },
    { id: "identity", label: "Identity", description: "Account and providers" },
    {
      id: "preferences",
      label: "Preferences",
      description: "Workspace defaults",
    },
    { id: "security", label: "Security", description: "Session posture" },
    { id: "policies", label: "Policies", description: "Compliance links" },
  ] as const;

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
      setSessionNotice({
        tone: "error",
        message: `Sign out failed: ${message}`,
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleProfileNav = (
    sectionId: (typeof profileSections)[number]["id"],
  ) => {
    setProfileSection(sectionId);
    const el = document.getElementById(`profile-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const currentViewMeta = viewMeta[activeView];

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
    <div className="min-h-screen w-full bg-[color:var(--shell-bg)] text-[color:var(--shell-ink)] dark:bg-slate-950 dark:text-slate-100">
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-[color:var(--shell-sidebar)] text-white shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10">
                    <div className="absolute -left-2 top-0 h-10 w-10 rounded-full bg-[#102739]" />
                    <div className="absolute left-1 top-0 h-10 w-10 rounded-full bg-[#1F3C52] opacity-90" />
                    <div className="absolute left-4 top-0 h-10 w-10 rounded-full bg-[#2D556F] opacity-80" />
                  </div>
                  <div>
                    <div
                      className="text-lg font-semibold tracking-[0.28em]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      CLARITAS
                    </div>
                    <div className="text-xs uppercase tracking-[0.32em] text-white/60">
                      Signal Desk
                    </div>
                  </div>
                </div>
              </div>
              <nav className="flex-1 px-3 py-2 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.view;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveView(item.view);
                        setMobileNavOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-white/10 text-white"
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
              <div className="border-t border-white/10 px-6 py-4 space-y-3">
                {authUser && (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-white/15 text-sm font-semibold uppercase grid place-items-center">
                      {userInitial}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {userLabel}
                      </div>
                      <div className="text-xs text-white/60 truncate">
                        {authUser.email ?? "Signed in"}
                      </div>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white/90 hover:bg-white/15 disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4" />
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-screen">
        <aside className="hidden lg:flex lg:w-72 lg:flex-col bg-[color:var(--shell-sidebar)] text-white shadow-2xl">
          <div className="px-6 pt-7 pb-5">
            <div className="flex items-center gap-3">
              <div className="relative h-11 w-11">
                <div className="absolute -left-2 top-0 h-11 w-11 rounded-full bg-[#102739]" />
                <div className="absolute left-1 top-0 h-11 w-11 rounded-full bg-[#1F3C52] opacity-90" />
                <div className="absolute left-4 top-0 h-11 w-11 rounded-full bg-[#2D556F] opacity-80" />
              </div>
              <div>
                <div
                  className="text-lg font-semibold tracking-[0.28em]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  CLARITAS
                </div>
                <div className="text-xs uppercase tracking-[0.32em] text-white/60">
                  Signal Desk
                </div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 py-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.view;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.view)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="border-t border-white/10 px-6 py-5 space-y-3">
            {authUser && (
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-white/15 text-sm font-semibold uppercase grid place-items-center">
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {userLabel}
                  </div>
                  <div className="text-xs text-white/60 truncate">
                    {authUser.email ?? "Signed in"}
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white/90 hover:bg-white/15 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-[color:var(--shell-border)] bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 gap-y-2 px-4 py-4 sm:px-6 lg:px-8">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-ink)] shadow-sm"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2 lg:hidden">
                <div className="relative h-7 w-7">
                  <div className="absolute -left-1 top-0 h-7 w-7 rounded-full bg-[#102739]" />
                  <div className="absolute left-1 top-0 h-7 w-7 rounded-full bg-[#1F3C52] opacity-90" />
                  <div className="absolute left-3.5 top-0 h-7 w-7 rounded-full bg-[#2D556F] opacity-80" />
                </div>
                <span
                  className="text-xs font-semibold tracking-[0.32em]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  CLARITAS
                </span>
              </div>

              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.32em] text-[color:var(--shell-muted)]">
                  {currentViewMeta.kicker}
                </div>
                <div className="text-lg font-semibold text-[color:var(--shell-ink)]">
                  {currentViewMeta.title}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden lg:flex items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)]">
                    Live
                  </span>
                  <span>{todayLabel}</span>
                </div>
                <div className="hidden md:flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-white px-3 py-2 text-sm text-[color:var(--shell-muted)]">
                  <Search className="h-4 w-4" />
                  <input
                    className="w-40 bg-transparent text-sm outline-none placeholder:text-[color:var(--shell-muted)]"
                    placeholder="Search signals"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button
                  aria-label="Toggle dark mode"
                  onClick={() => setDark((v) => !v)}
                  className="h-10 w-10 rounded-xl border border-[color:var(--shell-border)] bg-white text-[color:var(--shell-ink)] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <span className="grid h-full w-full place-items-center">
                    {dark ? (
                      <Sun className="h-5 w-5" />
                    ) : (
                      <Moon className="h-5 w-5" />
                    )}
                  </span>
                </button>
                <div className="hidden sm:flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-white px-3 py-1 text-xs text-[color:var(--shell-muted)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="max-w-[160px] truncate">{userLabel}</span>
                </div>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-6">
            {sessionNotice && (
              <div className="mb-6">
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

            {activeView === "dashboard" && (
              <div className="space-y-4">
                <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Live signals
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {news.length}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Stories & alerts
                    </div>
                  </div>
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Active regions
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {activeRegions}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Countries tracked
                    </div>
                  </div>
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Weather rows
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {weatherStats.length}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Latest observations
                    </div>
                  </div>
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Last sync
                    </div>
                    <div className="mt-2 text-base font-semibold text-[color:var(--shell-ink)]">
                      {latestEventLabel}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Combined feeds
                    </div>
                  </div>
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Focus
                    </div>
                    <div className="mt-2 text-base font-semibold text-[color:var(--shell-ink)]">
                      {focusLabel}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Current lens
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div
                    id="signal-map-feed"
                    className={`${cardBase} lg:col-span-12`}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr]">
                      <div className="border-b border-[color:var(--shell-border)] md:border-b-0 md:border-r">
                        <div className="flex items-center justify-between px-4 py-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Geospatial pulse
                            </div>
                            <div className="text-sm font-semibold">
                              Map:{" "}
                              {mapMode === "news"
                                ? "#News per country"
                                : "Weather (temperature) per country"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              className={`rounded-full border px-3 py-1 transition ${
                                mapMode === "news"
                                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                  : "border-[color:var(--shell-border)] bg-white text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                              }`}
                              onClick={() => {
                                setMapMode("news");
                                setListMode("news");
                              }}
                            >
                              News
                            </button>
                            <button
                              className={`rounded-full border px-3 py-1 transition ${
                                mapMode === "weather"
                                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                  : "border-[color:var(--shell-border)] bg-white text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                              }`}
                              onClick={() => {
                                setMapMode("weather");
                                setListMode("weather");
                              }}
                            >
                              Weather
                            </button>
                          </div>
                        </div>
                        <div className="relative p-4">
                          <div className="relative h-[420px] rounded-xl overflow-hidden bg-[color:var(--shell-bg)]">
                            {mapMode === "news" ? (
                              <WorldMapBubbles
                                variant="compact"
                                data={
                                  countryStats && countryStats.length > 0
                                    ? countryStats
                                    : Object.entries(
                                        (news || []).reduce<
                                          Record<string, number>
                                        >((acc, n) => {
                                          const iso = (
                                            n.country_iso2 || ""
                                          ).toUpperCase();
                                          if (!iso) return acc;
                                          acc[iso] = (acc[iso] || 0) + 1;
                                          return acc;
                                        }, {}),
                                      ).map(([country, count]) => ({
                                        country,
                                        count,
                                      }))
                                }
                                onSelect={setSelectedCountry}
                                dark={dark}
                              />
                            ) : (
                              <WorldMapBubbles
                                variant="compact"
                                data={(() => {
                                  const withTemp = (weatherStats || []).filter(
                                    (w) => typeof w.temp_c === "number",
                                  );
                                  if (withTemp.length === 0) return [];
                                  const temps = withTemp.map((w) =>
                                    Number(w.temp_c),
                                  );
                                  const min = Math.min(...temps);
                                  return withTemp.map((w) => ({
                                    country: (w.country || "").toUpperCase(),
                                    count: Number(w.temp_c) - min + 1,
                                  }));
                                })()}
                                onSelect={setSelectedCountry}
                                dark={dark}
                              />
                            )}
                          </div>
                          {mapMode === "news" && countryStats.length === 0 && (
                            <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-white px-2 py-1 rounded border border-[color:var(--shell-border)]">
                              No aggregated stats yet — showing live list
                              fallback
                            </div>
                          )}
                          {mapMode === "weather" &&
                            (weatherStats?.length ?? 0) === 0 && (
                              <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-white px-2 py-1 rounded border border-[color:var(--shell-border)] flex items-center gap-2">
                                <span>No weather stats yet.</span>
                                <button
                                  onClick={handleRefreshWeather}
                                  disabled={isRefreshingWeather}
                                  className="px-2 py-0.5 rounded border border-[color:var(--shell-border)] bg-white hover:bg-slate-50 disabled:opacity-50"
                                >
                                  {isRefreshingWeather
                                    ? "Refreshing…"
                                    : "Refresh now"}
                                </button>
                              </div>
                            )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Live feed
                            </div>
                            <div className="text-sm font-semibold">
                              Latest intelligence drops
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              className={`rounded-full border px-3 py-1 transition ${
                                listMode === "news"
                                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                  : "border-[color:var(--shell-border)] bg-white text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                              }`}
                              onClick={() => setListMode("news")}
                            >
                              News
                            </button>
                            <button
                              className={`rounded-full border px-3 py-1 transition ${
                                listMode === "weather"
                                  ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                  : "border-[color:var(--shell-border)] bg-white text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                              }`}
                              onClick={() => setListMode("weather")}
                            >
                              Weather
                            </button>
                          </div>
                        </div>

                        {listMode === "news" ? (
                          <div className="max-h-[420px] overflow-y-auto p-4 space-y-3">
                            {news.length === 0 && (
                              <div className="text-sm text-[color:var(--shell-muted)]">
                                No news items yet.
                              </div>
                            )}
                            {news.map((n) => {
                              const img = imageProxy(
                                (n as any)?.payload?.urlToImage ??
                                  (n as any)?.payload?.raw?.urlToImage,
                              );
                              return (
                                <div
                                  key={n.id}
                                  className="rounded-xl border border-[color:var(--shell-border)] bg-white p-3"
                                >
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                                  <div className="relative h-20 w-28 rounded-lg overflow-hidden border border-[color:var(--shell-border)] bg-slate-100 flex-none shrink-0">
                                      {img ? (
                                        <img
                                          src={img}
                                          alt={n.title ?? "thumbnail"}
                                          loading="lazy"
                                          decoding="async"
                                          referrerPolicy="no-referrer"
                                          className="w-full h-full object-cover"
                                          onError={(e) =>
                                            (e.currentTarget.style.display =
                                              "none")
                                          }
                                        />
                                      ) : null}
                                    </div>
                                    <div className="min-w-0">
                                      <a
                                        href={n.url ?? "#"}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-semibold text-[color:var(--shell-ink)] hover:underline"
                                      >
                                        {n.title || n.url || "Untitled"}
                                      </a>
                                      <div className="text-xs text-[color:var(--shell-muted)] mt-2 flex items-center gap-2 flex-wrap">
                                        {n.country_iso2 && (
                                          <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-[color:var(--shell-border)] text-slate-700">
                                            {n.country_iso2}
                                          </span>
                                        )}
                                        {n.event_time && (
                                          <span>
                                            {new Date(
                                              n.event_time,
                                            ).toLocaleString()}
                                          </span>
                                        )}
                                      </div>
                                      {n.summary && (
                                        <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                                          {n.summary}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="max-h-[420px] overflow-y-auto p-4 space-y-4">
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <label className="text-[color:var(--shell-muted)]">
                                Min temp (°C)
                              </label>
                              <input
                                type="number"
                                className="w-24 rounded-lg border border-[color:var(--shell-border)] bg-white px-2 py-1"
                                value={
                                  typeof minTemp === "number" ? minTemp : ""
                                }
                                onChange={(e) =>
                                  setMinTemp(
                                    e.currentTarget.value === ""
                                      ? undefined
                                      : Number(e.currentTarget.value),
                                  )
                                }
                                placeholder="Any"
                              />
                              <button
                                onClick={handleRefreshWeather}
                                disabled={isRefreshingWeather}
                                className="ml-auto rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)] hover:bg-slate-50 disabled:opacity-50"
                              >
                                {isRefreshingWeather
                                  ? "Refreshing…"
                                  : "Refresh"}
                              </button>
                            </div>
                            <ul className="list-none divide-y divide-[color:var(--shell-border)]">
                              {filteredWeather.length === 0 && (
                                <li className="text-sm text-[color:var(--shell-muted)] py-3">
                                  No weather rows.
                                </li>
                              )}
                              {filteredWeather.map((w, i) => (
                                <li
                                  key={`${w.country}-${i}`}
                                  className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-[color:var(--shell-border)] text-slate-700">
                                      {(w.country || "").toUpperCase()}
                                    </span>
                                    <span className="text-slate-700 text-sm">
                                      {new Date(w.observed_at).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="text-sm text-slate-800 flex flex-wrap items-center gap-4">
                                    <span title="Temperature">
                                      🌡️ {w.temp_c ?? "—"}°C
                                    </span>
                                    <span title="Humidity">
                                      💧 {w.humidity ?? "—"}%
                                    </span>
                                    {w.weather_main && (
                                      <span className="text-slate-600">
                                        {w.weather_main}
                                      </span>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`${cardBase} lg:col-span-4`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Country profile
                      </div>
                      <div className="text-sm font-semibold">
                        Selected location overview
                      </div>
                    </div>
                    <div className="p-4 text-sm text-[color:var(--shell-muted)] space-y-2">
                      {!selectedCountry && (
                        <div>
                          Select a bubble on the map to see a brief profile.
                        </div>
                      )}
                      {selectedCountry && (
                        <>
                          <div className="text-base font-semibold text-[color:var(--shell-ink)]">
                            Country: {selectedCountry}
                          </div>
                          <div>
                            Recent items from this country in the list are
                            highlighted by the country tag.
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={`${cardBase} lg:col-span-4`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        AI search
                      </div>
                      <div className="text-sm font-semibold">
                        Ask Claritas for signal context
                      </div>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-white px-3 py-2">
                        <Search className="h-5 w-5 text-[color:var(--shell-muted)]" />
                        <input
                          className="w-full bg-transparent outline-none placeholder:text-[color:var(--shell-muted)] text-inherit"
                          placeholder="Search events, alerts, and location activity"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <button className="rounded-lg bg-[color:var(--shell-ink)] px-3 py-1.5 text-white text-xs font-semibold uppercase tracking-[0.2em]">
                          Search
                        </button>
                      </div>
                      <p className="text-xs text-[color:var(--shell-muted)]">
                        Queries return live signal matches from the last 30
                        days.
                      </p>
                    </div>
                  </div>

                  <div className={`${cardBase} lg:col-span-4`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-sm font-semibold">
                        Analytics snapshot
                      </div>
                    </div>
                    <div className="p-4 space-y-6">
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart
                            margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
                          >
                            <XAxis dataKey="x" tick={{ fontSize: 12 }} />
                            <YAxis dataKey="y" tick={{ fontSize: 12 }} />
                            <ZAxis range={[60, 60]} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                            <Scatter data={scatterData} fill="#94a3b8" />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={50}
                              outerRadius={70}
                            >
                              {pieData.map((_, i) => (
                                <Cell
                                  key={i}
                                  fill={pieColors[i % pieColors.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className={`${cardBase} lg:col-span-12`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3 flex items-center gap-2">
                      <Bell className="h-4 w-4" />
                      <div className="text-sm font-semibold">Notifications</div>
                    </div>
                    <div className="p-4 text-sm text-[color:var(--shell-muted)]">
                      No notifications yet.
                    </div>
                  </div>
                </section>
              </div>
            )}
            {activeView === "profile" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.35em] text-[color:var(--shell-muted)]">
                      Account
                    </div>
                    <h1
                      className="mt-2 text-3xl font-semibold text-[color:var(--shell-ink)]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      Profile & access
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm text-[color:var(--shell-muted)]">
                      Review identity details, provider status, and session
                      preferences across devices.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveView("dashboard")}
                      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-2 text-sm text-[color:var(--shell-ink)] hover:border-slate-400"
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

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <aside className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Sections
                    </div>
                    <div className="mt-3 space-y-2">
                      {profileSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => handleProfileNav(section.id)}
                          className={`w-full rounded-xl px-3 py-2 text-left transition ${
                            profileSection === section.id
                              ? "bg-[color:var(--shell-bg)] text-[color:var(--shell-ink)] shadow-sm"
                              : "text-[color:var(--shell-muted)] hover:bg-slate-100"
                          }`}
                        >
                          <div className="text-sm font-semibold">
                            {section.label}
                          </div>
                          <div className="text-xs">{section.description}</div>
                        </button>
                      ))}
                    </div>
                  </aside>

                  <div className="space-y-6">
                    <section
                      id="profile-overview"
                      className="space-y-4 scroll-mt-24"
                    >
                      <div className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Overview
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-6 text-white shadow-sm">
                          <div className="absolute -top-16 right-0 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-4">
                              <div className="h-16 w-16 overflow-hidden rounded-2xl bg-white/15 text-2xl font-semibold uppercase text-white ring-1 ring-white/25">
                                {authUser?.avatar_url ? (
                                  <img
                                    src={authUser.avatar_url}
                                    alt="User avatar"
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="grid h-full w-full place-items-center">
                                    {userInitial}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="text-sm uppercase tracking-[0.2em] text-slate-300">
                                  Signed in as
                                </div>
                                <div className="text-2xl font-semibold">
                                  {userLabel}
                                </div>
                                <div className="text-sm text-slate-300">
                                  {authUser?.email ?? "Email not provided"}
                                </div>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm">
                              <div className="text-xs uppercase tracking-[0.3em] text-slate-300">
                                Session
                              </div>
                              <div className="mt-1 text-base font-semibold">
                                Active
                              </div>
                              <div className="text-xs text-slate-300">
                                Managed by identity provider
                              </div>
                            </div>
                          </div>
                          <div className="mt-6 flex flex-wrap gap-2 text-xs">
                            {(authUser?.roles?.length
                              ? authUser.roles
                              : ["Standard access"]
                            ).map((role) => (
                              <span
                                key={role}
                                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 uppercase tracking-[0.2em]"
                              >
                                {role}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className={cardBase + " p-6"}>
                          <div className="text-sm uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                            Session health
                          </div>
                          <div className="mt-4 space-y-3 text-sm text-[color:var(--shell-muted)]">
                            <div className="flex items-center justify-between">
                              <span>Session status</span>
                              <span className="font-semibold text-emerald-600">
                                Active
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Provider</span>
                              <span className="font-semibold text-[color:var(--shell-ink)]">
                                Managed
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Role count</span>
                              <span className="font-semibold text-[color:var(--shell-ink)]">
                                {authUser?.roles?.length ?? 1}
                              </span>
                            </div>
                            <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs">
                              All access events are recorded for audit
                              readiness.
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section
                      id="profile-identity"
                      className="space-y-4 scroll-mt-24"
                    >
                      <div className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Identity
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className={cardBase + " p-6"}>
                          <div className="flex items-center justify-between">
                            <div className="text-sm uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                              Account details
                            </div>
                            <Settings className="h-4 w-4 text-slate-400" />
                          </div>
                          <dl className="mt-4 divide-y divide-[color:var(--shell-border)] text-sm">
                            {[
                              {
                                label: "User ID",
                                value: authUser?.id ? String(authUser.id) : "—",
                              },
                              {
                                label: "Display name",
                                value: authUser?.display_name ?? "Not set",
                              },
                              {
                                label: "Email",
                                value: authUser?.email ?? "Not provided",
                              },
                              {
                                label: "Roles",
                                value: authUser?.roles?.length
                                  ? authUser.roles.join(", ")
                                  : "Standard access",
                              },
                            ].map((row) => (
                              <div
                                key={row.label}
                                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <dt className="text-[color:var(--shell-muted)]">
                                  {row.label}
                                </dt>
                                <dd className="font-medium text-[color:var(--shell-ink)]">
                                  {row.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>

                        <div className={cardBase + " p-6"}>
                          <div className="text-sm uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                            Identity providers
                          </div>
                          <p className="mt-2 text-sm text-[color:var(--shell-muted)]">
                            Available sign-in methods connected to this
                            environment.
                          </p>
                          <div className="mt-4 space-y-3">
                            {authProviders.length === 0 && (
                              <div className="text-sm text-[color:var(--shell-muted)]">
                                No providers reported yet.
                              </div>
                            )}
                            {authProviders.map((provider) => (
                              <div
                                key={provider.id}
                                className="flex items-center justify-between rounded-xl border border-[color:var(--shell-border)] px-4 py-3"
                              >
                                <div>
                                  <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                                    {providerLabels[provider.id]}
                                  </div>
                                  <div className="text-xs text-[color:var(--shell-muted)]">
                                    {provider.enabled
                                      ? "Enabled and ready"
                                      : "Disabled"}
                                  </div>
                                </div>
                                <span
                                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                    provider.enabled
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {provider.enabled ? "Active" : "Inactive"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section
                      id="profile-preferences"
                      className="space-y-4 scroll-mt-24"
                    >
                      <div className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Preferences
                      </div>
                      <div className={cardBase + " p-6"}>
                        <div className="flex flex-col gap-4 text-sm text-[color:var(--shell-muted)]">
                          <div className="flex items-center justify-between rounded-xl border border-[color:var(--shell-border)] px-4 py-3">
                            <div>
                              <div className="font-semibold text-[color:var(--shell-ink)]">
                                Theme
                              </div>
                              <div className="text-xs text-[color:var(--shell-muted)]">
                                Match your current workspace.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setDark((v) => !v)}
                              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-xs text-[color:var(--shell-ink)]"
                            >
                              {dark ? (
                                <Sun className="h-4 w-4" />
                              ) : (
                                <Moon className="h-4 w-4" />
                              )}
                              {dark ? "Light" : "Dark"}
                            </button>
                          </div>
                          <div className="rounded-xl border border-[color:var(--shell-border)] px-4 py-3">
                            <div className="font-semibold text-[color:var(--shell-ink)]">
                              Default map view
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  setMapMode("news");
                                  setListMode("news");
                                }}
                                className={`rounded-full border px-3 py-1 ${
                                  mapMode === "news"
                                    ? "bg-slate-900 text-white border-slate-900"
                                    : "border-slate-200 text-slate-600"
                                }`}
                              >
                                News
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMapMode("weather");
                                  setListMode("weather");
                                }}
                                className={`rounded-full border px-3 py-1 ${
                                  mapMode === "weather"
                                    ? "bg-slate-900 text-white border-slate-900"
                                    : "border-slate-200 text-slate-600"
                                }`}
                              >
                                Weather
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section
                      id="profile-security"
                      className="space-y-4 scroll-mt-24"
                    >
                      <div className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Security
                      </div>
                      <div className={cardBase + " p-6"}>
                        <div className="text-sm uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                          Access roles
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {(authUser?.roles?.length
                            ? authUser.roles
                            : ["Standard access"]
                          ).map((role) => (
                            <span
                              key={role}
                              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)]"
                            >
                              {role}
                            </span>
                          ))}
                        </div>
                        <div className="mt-4 text-sm text-[color:var(--shell-muted)]">
                          Session tokens are short-lived and scoped to your
                          approved providers.
                        </div>
                      </div>
                    </section>

                    <section
                      id="profile-policies"
                      className="space-y-4 scroll-mt-24"
                    >
                      <div className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Policies
                      </div>
                      <div className={cardBase + " p-6"}>
                        <div className="flex flex-col gap-3 text-sm text-[color:var(--shell-muted)]">
                          <div>
                            Claritas policies define how we protect data and
                            govern platform use.
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {legalPolicies.map((policy) => (
                              <span
                                key={policy.id}
                                className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-xs text-[color:var(--shell-ink)]"
                              >
                                {policy.title}
                              </span>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveView("legal")}
                            className="inline-flex w-fit items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)]"
                          >
                            View full policies
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}

            {activeView === "legal" && (
              <div className="space-y-6">
                <div>
                  <div className="text-xs uppercase tracking-[0.4em] text-[color:var(--shell-muted)]">
                    Legal
                  </div>
                  <h1
                    className="mt-2 text-3xl font-semibold text-[color:var(--shell-ink)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Policies and usage guidelines
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-[color:var(--shell-muted)]">
                    Review the policy summaries below. Each section describes
                    how Claritas protects data, governs platform use, and
                    supports compliance.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {legalPolicies.map((policy) => (
                    <article
                      key={policy.id}
                      id={policy.id}
                      className="scroll-mt-24 rounded-2xl border border-[color:var(--shell-border)] bg-white p-6 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-[color:var(--shell-ink)]">
                          {policy.title}
                        </h3>
                        <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                          Claritas
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-[color:var(--shell-muted)]">
                        {policy.intro}
                      </p>
                      <ul className="mt-4 space-y-2 text-sm text-[color:var(--shell-muted)]">
                        {policy.items.map((item) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-slate-500" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-4 text-sm text-[color:var(--shell-muted)]">
                        {policy.note}
                      </p>
                    </article>
                  ))}
                </div>

                <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 text-xs text-[color:var(--shell-muted)] flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="font-semibold uppercase tracking-[0.3em] text-[color:var(--shell-ink)]">
                    Claritas
                  </span>
                  <a
                    href="#cookie-policy"
                    className="transition hover:text-[color:var(--shell-ink)]"
                  >
                    Cookie Policy
                  </a>
                  <a
                    href="#privacy-statement"
                    className="transition hover:text-[color:var(--shell-ink)]"
                  >
                    Privacy Statement
                  </a>
                  <a
                    href="#terms-of-use"
                    className="transition hover:text-[color:var(--shell-ink)]"
                  >
                    Terms of Use
                  </a>
                  <a
                    href="#copyright"
                    className="transition hover:text-[color:var(--shell-ink)]"
                  >
                    Copyright
                  </a>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
