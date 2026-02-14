import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  Brush,
  ReferenceDot,
  Line,
} from "recharts";
import worldCountries from "world-countries";

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

const NEWS_FETCH_LIMIT = 250;
const NEWS_TREND_WINDOW_DAYS = 30;
const MAP_WINDOW_MIN = 7;
const MAP_WINDOW_MAX = 45;

const REGION_OPTIONS = [
  { id: "global", label: "Global" },
  { id: "americas", label: "Americas" },
  { id: "europe", label: "Europe" },
  { id: "africa", label: "Africa" },
  { id: "asia", label: "Asia" },
  { id: "apac", label: "APAC" },
  { id: "oceania", label: "Oceania" },
] as const;

const getDateKey = (value: Date | string) => {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const safeDownload = (filename: string, data: Blob | string) => {
  const blob = typeof data === "string" ? new Blob([data]) : data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

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
  const [comparisonCountry, setComparisonCountry] = useState<string | null>(
    null,
  );
  const [compareMode, setCompareMode] = useState(false);
  const [pinnedCountry, setPinnedCountry] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] =
    useState<(typeof REGION_OPTIONS)[number]["id"]>("global");
  const [countryStats, setCountryStats] = useState<CountryStat[]>([]);
  const [weatherStats, setWeatherStats] = useState<CountryWeather[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [mapMode, setMapMode] = useState<"news" | "weather">("news");
  const [listMode, setListMode] = useState<"news" | "weather">("news");
  const [mapScale, setMapScale] = useState<"linear" | "log">("linear");
  const [mapDayMode, setMapDayMode] = useState(false);
  const [mapWindowDays, setMapWindowDays] = useState(NEWS_TREND_WINDOW_DAYS);
  const [mapDayIndex, setMapDayIndex] = useState(0);
  const [mapPlaying, setMapPlaying] = useState(false);
  const [chartView, setChartView] = useState<"daily" | "rolling">("daily");
  const [chartRange, setChartRange] = useState<{
    startIndex?: number;
    endIndex?: number;
  }>({});
  const [minTemp, setMinTemp] = useState<number | undefined>(undefined);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [profileSection, setProfileSection] = useState<
    "overview" | "identity" | "preferences" | "security" | "policies"
  >("overview");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
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
    fetchNews({ limit: NEWS_FETCH_LIMIT })
      .then(setNews)
      .catch(() => setNews([]));
  }, [authStatus]);

  const cardBase =
    "rounded-2xl border border-[color:var(--shell-border)] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/70";
  const chartGridColor = dark ? "#1f2937" : "#e2e8f0";

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  const countryMeta = useMemo(() => {
    const map = new Map<
      string,
      { name?: string; region?: string; subregion?: string }
    >();
    for (const c of worldCountries as any[]) {
      const iso = (c.cca2 || c.properties?.cca2 || "").toUpperCase();
      if (!iso) continue;
      map.set(iso, {
        name: c.name?.common ?? c.name?.official,
        region: c.region,
        subregion: c.subregion,
      });
    }
    if (map.has("GB")) {
      map.set("UK", map.get("GB")!);
    }
    return map;
  }, []);

  const regionSets = useMemo(() => {
    const sets: Record<string, Set<string>> = {
      americas: new Set(),
      europe: new Set(),
      africa: new Set(),
      asia: new Set(),
      apac: new Set(),
      oceania: new Set(),
    };
    countryMeta.forEach((meta, iso) => {
      const region = (meta.region || "").toLowerCase();
      if (region === "americas") sets.americas.add(iso);
      if (region === "europe") sets.europe.add(iso);
      if (region === "africa") sets.africa.add(iso);
      if (region === "asia") sets.asia.add(iso);
      if (region === "oceania") sets.oceania.add(iso);
      if (region === "asia" || region === "oceania") sets.apac.add(iso);
    });
    return sets;
  }, [countryMeta]);

  const regionLabel =
    REGION_OPTIONS.find((opt) => opt.id === regionFilter)?.label ?? "Global";
  const regionCountries =
    regionFilter === "global" ? null : regionSets[regionFilter];

  const selectedCountries = useMemo(() => {
    const set = new Set<string>();
    if (selectedCountry) set.add(selectedCountry.toUpperCase());
    if (comparisonCountry) set.add(comparisonCountry.toUpperCase());
    return set;
  }, [selectedCountry, comparisonCountry]);

  const newsScope = useMemo(() => {
    if (!regionCountries) return news;
    return news.filter(
      (item) =>
        item.country_iso2 &&
        regionCountries.has(item.country_iso2.toUpperCase()),
    );
  }, [news, regionCountries]);

  const getSourceLabel = (item: NewsItem) => {
    const payload = (item as any)?.payload ?? {};
    const raw = payload?.raw ?? payload;
    const source =
      raw?.source?.name ??
      raw?.source?.id ??
      raw?.source ??
      payload?.source ??
      payload?.provider ??
      payload?.publisher ??
      payload?.site;
    if (!source) return undefined;
    return typeof source === "string" ? source : source?.name;
  };

  const newsTrend = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    const today = new Date();
    const buckets = new Map<
      string,
      {
        dateKey: string;
        label: string;
        count: number;
        selectedCount: number;
        comparisonCount: number;
        rollingAvg: number;
        selectedRollingAvg: number;
        comparisonRollingAvg: number;
        topCountries: string[];
      }
    >();
    const perDayCountries = new Map<string, Map<string, number>>();
    for (let i = NEWS_TREND_WINDOW_DAYS - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, {
        dateKey: key,
        label: formatter.format(d),
        count: 0,
        selectedCount: 0,
        comparisonCount: 0,
        rollingAvg: 0,
        selectedRollingAvg: 0,
        comparisonRollingAvg: 0,
        topCountries: [],
      });
    }

    const selectedIso = selectedCountry?.toUpperCase() ?? null;
    const comparisonIso = comparisonCountry?.toUpperCase() ?? null;

    newsScope.forEach((item) => {
      if (!item.event_time) return;
      const key = getDateKey(item.event_time);
      if (!key) return;
      const bucket = buckets.get(key);
      if (!bucket) return;
      bucket.count += 1;
      const iso = item.country_iso2?.toUpperCase();
      if (iso) {
        const countryMap = perDayCountries.get(key) ?? new Map<string, number>();
        countryMap.set(iso, (countryMap.get(iso) ?? 0) + 1);
        perDayCountries.set(key, countryMap);
        if (selectedIso && iso === selectedIso) bucket.selectedCount += 1;
        if (comparisonIso && iso === comparisonIso) bucket.comparisonCount += 1;
      }
    });

    const points = Array.from(buckets.values());
    points.forEach((bucket, idx) => {
      const start = Math.max(0, idx - 6);
      const window = points.slice(start, idx + 1);
      const avg =
        window.reduce((sum, item) => sum + item.count, 0) / window.length;
      bucket.rollingAvg = Number(avg.toFixed(2));
      const selectedAvg =
        window.reduce((sum, item) => sum + item.selectedCount, 0) /
        window.length;
      const comparisonAvg =
        window.reduce((sum, item) => sum + item.comparisonCount, 0) /
        window.length;
      bucket.selectedRollingAvg = Number(selectedAvg.toFixed(2));
      bucket.comparisonRollingAvg = Number(comparisonAvg.toFixed(2));
      const countryMap = perDayCountries.get(bucket.dateKey);
      if (!countryMap) return;
      bucket.topCountries = Array.from(countryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([iso, count]) => `${iso} (${count})`);
    });

    return points;
  }, [newsScope, selectedCountry, comparisonCountry]);

  const newsTrendTotal = useMemo(
    () => newsTrend.reduce((sum, item) => sum + item.count, 0),
    [newsTrend],
  );

  const trendAnomalies = useMemo(() => {
    if (newsTrend.length === 0) return [];
    const mean = newsTrend.reduce((sum, d) => sum + d.count, 0) / newsTrend.length;
    const variance =
      newsTrend.reduce((sum, d) => sum + (d.count - mean) ** 2, 0) /
      newsTrend.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 2 * std;
    return newsTrend.filter((d) => d.count > threshold);
  }, [newsTrend]);

  const activeRange = useMemo(() => {
    if (chartRange.startIndex == null || chartRange.endIndex == null) return null;
    const start = newsTrend[chartRange.startIndex]?.dateKey;
    const end = newsTrend[chartRange.endIndex]?.dateKey;
    if (!start || !end) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  }, [chartRange, newsTrend]);

  const activeRangeLabel = useMemo(() => {
    if (!activeRange) return `Last ${NEWS_TREND_WINDOW_DAYS} days`;
    const startLabel =
      newsTrend.find((d) => d.dateKey === activeRange.start)?.label ??
      activeRange.start;
    const endLabel =
      newsTrend.find((d) => d.dateKey === activeRange.end)?.label ??
      activeRange.end;
    return `${startLabel} – ${endLabel}`;
  }, [activeRange, newsTrend]);

  const defaultRange = useMemo(() => {
    const today = new Date();
    const end = getDateKey(today);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - NEWS_TREND_WINDOW_DAYS + 1);
    const start = getDateKey(startDate);
    if (!start || !end) return null;
    return { start, end };
  }, []);

  const effectiveRange = activeRange ?? defaultRange;

  const newsRangeTotal = useMemo(() => {
    if (!activeRange) return newsTrendTotal;
    return newsTrend.reduce((sum, item) => {
      if (item.dateKey < activeRange.start || item.dateKey > activeRange.end) {
        return sum;
      }
      return sum + item.count;
    }, 0);
  }, [activeRange, newsTrend, newsTrendTotal]);

  const filteredNews = useMemo(() => {
    let items = newsScope;
    if (effectiveRange) {
      items = items.filter((item) => {
        const key = item.event_time ? getDateKey(item.event_time) : null;
        if (!key) return true;
        return key >= effectiveRange.start && key <= effectiveRange.end;
      });
    }
    if (selectedCountries.size > 0) {
      items = items.filter(
        (item) =>
          item.country_iso2 &&
          selectedCountries.has(item.country_iso2.toUpperCase()),
      );
    }
    return items;
  }, [newsScope, effectiveRange, selectedCountries]);

  const filteredCountryStats = useMemo(() => {
    const stats = new Map<string, { count: number; sources: Map<string, number> }>();
    filteredNews.forEach((item) => {
      if (!item.country_iso2) return;
      const iso = item.country_iso2.toUpperCase();
      const entry = stats.get(iso) ?? {
        count: 0,
        sources: new Map<string, number>(),
      };
      entry.count += 1;
      const source = getSourceLabel(item);
      if (source) {
        entry.sources.set(source, (entry.sources.get(source) ?? 0) + 1);
      }
      stats.set(iso, entry);
    });
    return stats;
  }, [filteredNews]);

  const mapRange = useMemo(() => {
    if (activeRange) return activeRange;
    const today = new Date();
    const end = getDateKey(today);
    const windowSize = Math.min(
      MAP_WINDOW_MAX,
      Math.max(MAP_WINDOW_MIN, mapWindowDays),
    );
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - windowSize + 1);
    const start = getDateKey(startDate);
    if (!start || !end) return null;
    return { start, end };
  }, [activeRange, mapWindowDays]);

  const mapDates = useMemo(() => {
    if (!mapRange) return [] as string[];
    const dates: string[] = [];
    const start = new Date(mapRange.start);
    const end = new Date(mapRange.end);
    const current = new Date(start);
    while (current <= end) {
      const key = getDateKey(current);
      if (key) dates.push(key);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }, [mapRange]);

  const mapRangeLabel = useMemo(() => {
    if (!mapRange) return "No range";
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    const startLabel = formatter.format(new Date(mapRange.start));
    const endLabel = formatter.format(new Date(mapRange.end));
    return `${startLabel} – ${endLabel}`;
  }, [mapRange]);

  const mapDayLabel = useMemo(() => {
    if (mapDates.length === 0) return "—";
    const key = mapDates[Math.min(mapDayIndex, mapDates.length - 1)];
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(new Date(key));
  }, [mapDates, mapDayIndex]);

  const mapNews = useMemo(() => {
    let items = newsScope;
    if (mapRange) {
      items = items.filter((item) => {
        const key = item.event_time ? getDateKey(item.event_time) : null;
        if (!key) return false;
        return key >= mapRange.start && key <= mapRange.end;
      });
    }
    if (mapDayMode && mapDates.length > 0) {
      const dayKey = mapDates[Math.min(mapDayIndex, mapDates.length - 1)];
      items = items.filter((item) => getDateKey(item.event_time ?? "") === dayKey);
    }
    return items;
  }, [newsScope, mapRange, mapDayMode, mapDayIndex, mapDates]);

  const mapCountryStats = useMemo(() => {
    const stats = new Map<
      string,
      { count: number; lastEvent?: string; sources: Map<string, number> }
    >();
    mapNews.forEach((item) => {
      if (!item.country_iso2) return;
      const iso = item.country_iso2.toUpperCase();
      const entry = stats.get(iso) ?? {
        count: 0,
        lastEvent: undefined,
        sources: new Map<string, number>(),
      };
      entry.count += 1;
      if (item.event_time) {
        if (!entry.lastEvent || item.event_time > entry.lastEvent) {
          entry.lastEvent = item.event_time;
        }
      }
      const source = getSourceLabel(item);
      if (source) {
        entry.sources.set(source, (entry.sources.get(source) ?? 0) + 1);
      }
      stats.set(iso, entry);
    });
    return stats;
  }, [mapNews]);

  const mapBubbleData = useMemo(() => {
    if (
      mapCountryStats.size === 0 &&
      !activeRange &&
      !regionCountries &&
      !mapDayMode &&
      countryStats.length > 0
    ) {
      return countryStats.map((stat) => ({
        country: stat.country.toUpperCase(),
        count: stat.count,
        meta: {
          subtitle: `${stat.count} ${stat.count === 1 ? "story" : "stories"}`,
          lines: ["Aggregated over last 30 days"],
        },
      }));
    }
    const entries = Array.from(mapCountryStats.entries());
    return entries.map(([country, stat]) => {
      let topSource: string | undefined;
      if (stat.sources.size > 0) {
        topSource = Array.from(stat.sources.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name)[0];
      }
      const lastEvent = stat.lastEvent
        ? new Date(stat.lastEvent).toLocaleString()
        : undefined;
      return {
        country,
        count: stat.count,
        meta: {
          subtitle: `${stat.count} ${stat.count === 1 ? "story" : "stories"}`,
          lines: [
            lastEvent ? `Last event: ${lastEvent}` : "Last event: —",
            topSource ? `Top source: ${topSource}` : "Top source: —",
          ],
        },
      };
    });
  }, [
    mapCountryStats,
    activeRange,
    regionCountries,
    mapDayMode,
    countryStats,
  ]);

  const mapWeatherScope = useMemo(() => {
    let w = weatherStats;
    if (typeof minTemp === "number") {
      w = w.filter((x) => (x.temp_c ?? -999) >= minTemp);
    }
    if (regionCountries) {
      w = w.filter(
        (x) => x.country && regionCountries.has(x.country.toUpperCase()),
      );
    }
    return w;
  }, [weatherStats, minTemp, regionCountries]);

  const mapWeatherData = useMemo(() => {
    const withTemp = (mapWeatherScope || []).filter(
      (w) => typeof w.temp_c === "number",
    );
    if (withTemp.length === 0) return [];
    const temps = withTemp.map((w) => Number(w.temp_c));
    const min = Math.min(...temps);
    return withTemp.map((w) => ({
      country: (w.country || "").toUpperCase(),
      count: Number(w.temp_c) - min + 1,
      meta: {
        subtitle: `Temp: ${w.temp_c ?? "—"}°C`,
        lines: ([
          `Humidity: ${w.humidity ?? "—"}%`,
          w.weather_main ? `Condition: ${w.weather_main}` : undefined,
          `Observed: ${new Date(w.observed_at).toLocaleString()}`,
        ].filter(Boolean) as string[]),
      },
    }));
  }, [mapWeatherScope]);

  const pinnedNewsSummary = useMemo(() => {
    if (!pinnedCountry) return null;
    return mapCountryStats.get(pinnedCountry.toUpperCase()) ?? null;
  }, [pinnedCountry, mapCountryStats]);

  const pinnedTopSource = useMemo(() => {
    if (!pinnedNewsSummary || pinnedNewsSummary.sources.size === 0) return null;
    return Array.from(pinnedNewsSummary.sources.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)[0];
  }, [pinnedNewsSummary]);

  const selectedCountryStats = useMemo(() => {
    if (!selectedCountry) return null;
    return filteredCountryStats.get(selectedCountry.toUpperCase()) ?? null;
  }, [selectedCountry, filteredCountryStats]);

  const selectedTopSource = useMemo(() => {
    if (!selectedCountryStats || selectedCountryStats.sources.size === 0)
      return null;
    return Array.from(selectedCountryStats.sources.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)[0];
  }, [selectedCountryStats]);

  const comparisonCountryStats = useMemo(() => {
    if (!comparisonCountry) return null;
    return filteredCountryStats.get(comparisonCountry.toUpperCase()) ?? null;
  }, [comparisonCountry, filteredCountryStats]);

  const comparisonTopSource = useMemo(() => {
    if (!comparisonCountryStats || comparisonCountryStats.sources.size === 0)
      return null;
    return Array.from(comparisonCountryStats.sources.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)[0];
  }, [comparisonCountryStats]);

  const pinnedWeatherSummary = useMemo(() => {
    if (!pinnedCountry) return null;
    return (
      mapWeatherScope.find(
        (w) => (w.country || "").toUpperCase() === pinnedCountry.toUpperCase(),
      ) ?? null
    );
  }, [pinnedCountry, mapWeatherScope]);

  const pinnedMeta = useMemo(() => {
    if (!pinnedCountry) return null;
    return countryMeta.get(pinnedCountry.toUpperCase()) ?? null;
  }, [pinnedCountry, countryMeta]);

  const selectedMeta = useMemo(() => {
    if (!selectedCountry) return null;
    return countryMeta.get(selectedCountry.toUpperCase()) ?? null;
  }, [selectedCountry, countryMeta]);

  const comparisonMeta = useMemo(() => {
    if (!comparisonCountry) return null;
    return countryMeta.get(comparisonCountry.toUpperCase()) ?? null;
  }, [comparisonCountry, countryMeta]);

  const filteredWeather = useMemo(() => {
    let w = weatherStats;
    if (typeof minTemp === "number") {
      w = w.filter((x) => (x.temp_c ?? -999) >= minTemp);
    }
    if (regionCountries) {
      w = w.filter(
        (x) => x.country && regionCountries.has(x.country.toUpperCase()),
      );
    }
    if (selectedCountries.size > 0) {
      w = w.filter(
        (x) => x.country && selectedCountries.has(x.country.toUpperCase()),
      );
    }
    return w;
  }, [weatherStats, minTemp, regionCountries, selectedCountries]);

  const activeRegions = useMemo(() => {
    const regions = new Set<string>();
    filteredNews.forEach(
      (item) =>
        item.country_iso2 && regions.add(item.country_iso2.toUpperCase()),
    );
    filteredWeather.forEach(
      (item) => item.country && regions.add(item.country.toUpperCase()),
    );
    return regions.size;
  }, [filteredNews, filteredWeather]);

  const latestEventLabel = useMemo(() => {
    const times: number[] = [];
    filteredNews.forEach((item) => {
      if (item.event_time) {
        const time = Date.parse(item.event_time);
        if (!Number.isNaN(time)) times.push(time);
      }
    });
    filteredWeather.forEach((item) => {
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
  }, [filteredNews, filteredWeather]);

  const focusLabel = useMemo(() => {
    if (selectedCountry && comparisonCountry) {
      return `${selectedCountry.toUpperCase()} + ${comparisonCountry.toUpperCase()}`;
    }
    if (selectedCountry) return selectedCountry.toUpperCase();
    if (comparisonCountry) return comparisonCountry.toUpperCase();
    return regionFilter === "global" ? "Global" : regionLabel;
  }, [selectedCountry, comparisonCountry, regionFilter, regionLabel]);

  const dashboardHeight = useMemo(() => {
    const padding = 48; // py-6 on main (top + bottom)
    if (!headerHeight) return `calc(100vh - ${padding}px)`;
    return `calc(100vh - ${headerHeight}px - ${padding}px)`;
  }, [headerHeight]);

  useEffect(() => {
    if (!selectedCountry) {
      setComparisonCountry(null);
      setCompareMode(false);
    }
  }, [selectedCountry]);

  useEffect(() => {
    if (mapDates.length > 0) {
      setMapDayIndex(mapDates.length - 1);
    }
  }, [mapDates]);

  useEffect(() => {
    if (!mapDayMode) {
      setMapPlaying(false);
    }
  }, [mapDayMode]);

  useEffect(() => {
    if (mapMode === "weather") {
      setMapDayMode(false);
      setMapPlaying(false);
    }
  }, [mapMode]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => {
      setHeaderHeight(el.getBoundingClientRect().height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mapPlaying || mapDates.length === 0) return;
    const id = window.setInterval(() => {
      setMapDayIndex((idx) => (idx + 1) % mapDates.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [mapPlaying, mapDates.length]);

  useEffect(() => {
    if (
      chartRange.startIndex != null &&
      chartRange.startIndex >= newsTrend.length
    ) {
      setChartRange({});
    }
    if (
      chartRange.endIndex != null &&
      chartRange.endIndex >= newsTrend.length
    ) {
      setChartRange({});
    }
  }, [chartRange.endIndex, chartRange.startIndex, newsTrend.length]);

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

  const handleMapSelect = (iso: string) => {
    const key = iso.toUpperCase();
    if (compareMode && selectedCountry) {
      if (selectedCountry.toUpperCase() !== key) {
        setComparisonCountry(key);
        setCompareMode(false);
      }
      return;
    }
    if (selectedCountry && selectedCountry.toUpperCase() === key) {
      setSelectedCountry(null);
      return;
    }
    setSelectedCountry(key);
  };

  const handleClearSelection = () => {
    setSelectedCountry(null);
    setComparisonCountry(null);
    setCompareMode(false);
  };

  const handleAnomalyClick = (dateKey: string) => {
    const index = newsTrend.findIndex((d) => d.dateKey === dateKey);
    if (index >= 0) {
      setChartRange({ startIndex: index, endIndex: index });
      setListMode("news");
      requestAnimationFrame(() => {
        feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  };

  const handleExportCsv = () => {
    const range = activeRange;
    const series = range
      ? newsTrend.filter(
          (d) => d.dateKey >= range.start && d.dateKey <= range.end,
        )
      : newsTrend;
    const header = [
      "date",
      "label",
      "total",
      "selected",
      "comparison",
      "rolling_avg",
    ];
    const rows = series.map((d) =>
      [
        d.dateKey,
        d.label,
        d.count,
        d.selectedCount,
        d.comparisonCount,
        d.rollingAvg,
      ].join(","),
    );
    safeDownload(
      `news-volume-${new Date().toISOString().slice(0, 10)}.csv`,
      [header.join(","), ...rows].join("\n"),
    );
  };

  const handleExportPng = () => {
    const container = chartRef.current;
    const svg = container?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgString], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = dark ? "#0f172a" : "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        safeDownload(
          `news-volume-${new Date().toISOString().slice(0, 10)}.png`,
          blob,
        );
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const ChartTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ payload: (typeof newsTrend)[number] }>;
    label?: string;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0].payload;
    return (
      <div className="rounded-lg border border-[color:var(--shell-border)] bg-white px-3 py-2 text-xs text-[color:var(--shell-ink)] shadow dark:bg-slate-900 dark:text-slate-100">
        <div className="font-semibold">{label}</div>
        <div>Total: {point.count}</div>
        {selectedCountry && (
          <div>
            {selectedCountry.toUpperCase()}:{" "}
            {chartView === "rolling"
              ? point.selectedRollingAvg
              : point.selectedCount}
          </div>
        )}
        {comparisonCountry && (
          <div>
            {comparisonCountry.toUpperCase()}:{" "}
            {chartView === "rolling"
              ? point.comparisonRollingAvg
              : point.comparisonCount}
          </div>
        )}
        <div>7d avg: {point.rollingAvg}</div>
        {point.topCountries.length > 0 && (
          <div className="mt-1 text-[color:var(--shell-muted)]">
            Top: {point.topCountries.join(", ")}
          </div>
        )}
      </div>
    );
  };

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

        <div className="flex min-w-0 flex-1 flex-col min-h-0">
          <header
            ref={headerRef}
            className="sticky top-0 z-20 border-b border-[color:var(--shell-border)] bg-white dark:border-slate-800 dark:bg-slate-950"
          >
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

          <main className="mx-auto w-full max-w-7xl flex-1 min-h-0 flex flex-col px-4 sm:px-6 lg:px-8 py-6">
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
              <div
                className="relative flex flex-col gap-4 md:flex-1 md:min-h-0 md:overflow-hidden md:h-[var(--dashboard-h)]"
                style={{ "--dashboard-h": dashboardHeight } as React.CSSProperties}
              >
                <div className="relative flex flex-col gap-4 md:flex-1 md:min-h-0">
                  <div className="pointer-events-none absolute -top-20 right-0 h-64 w-64 rounded-full bg-[color:var(--signal-emerald-soft)] opacity-70 blur-3xl dark:bg-emerald-900/40 dark:opacity-40" />
                  <div className="pointer-events-none absolute -bottom-24 left-0 h-72 w-72 rounded-full bg-[color:var(--signal-sky-soft)] opacity-80 blur-3xl dark:bg-sky-900/40 dark:opacity-40" />

                  <section className="relative grid flex-1 min-h-0 grid-cols-1 gap-4 md:grid-cols-2 md:grid-rows-2 md:h-full md:overflow-hidden">
                    <div
                      id="signal-map-feed"
                      className={`${cardBase} dashboard-panel flex min-h-0 flex-col overflow-hidden md:h-full`}
                      style={{ animationDelay: "0ms" }}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
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
                      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--shell-border)] px-4 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          {REGION_OPTIONS.map((region) => {
                            const active = regionFilter === region.id;
                            return (
                              <button
                                key={region.id}
                                onClick={() => setRegionFilter(region.id)}
                                className={`rounded-full border px-3 py-1 transition ${
                                  active
                                    ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                    : "border-[color:var(--shell-border)] bg-white text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                                }`}
                              >
                                {region.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          <button
                            onClick={() =>
                              setMapScale((mode) =>
                                mode === "linear" ? "log" : "linear",
                              )
                            }
                            className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                          >
                            Scale: {mapScale === "linear" ? "Linear" : "Log"}
                          </button>
                          <button
                            onClick={() => setCompareMode((v) => !v)}
                            className={`rounded-full border px-3 py-1 transition ${
                              compareMode
                                ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                : "border-[color:var(--shell-border)] bg-white text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                          >
                            {compareMode ? "Compare: On" : "Compare"}
                          </button>
                          <button
                            onClick={() =>
                              setPinnedCountry(
                                selectedCountry
                                  ? selectedCountry.toUpperCase()
                                  : pinnedCountry,
                              )
                            }
                            className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] disabled:opacity-50"
                            disabled={!selectedCountry}
                          >
                            Pin selection
                          </button>
                          {pinnedCountry && (
                            <button
                              onClick={() => setPinnedCountry(null)}
                              className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            >
                              Unpin
                            </button>
                          )}
                          {(selectedCountry || comparisonCountry) && (
                            <button
                              onClick={handleClearSelection}
                              className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      {compareMode && (
                        <div className="px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                          Compare mode: click a second country
                        </div>
                      )}
                      <div className="relative flex-1 min-h-0 p-4">
                        <div className="relative h-full min-h-0 rounded-2xl overflow-hidden bg-[color:var(--shell-bg)]">
                          <WorldMapBubbles
                            variant="compact"
                            data={
                              mapMode === "news" ? mapBubbleData : mapWeatherData
                            }
                            onSelect={handleMapSelect}
                            dark={dark}
                            primaryCountry={selectedCountry}
                            secondaryCountry={comparisonCountry}
                            pinnedCountry={pinnedCountry}
                            scale={mapScale}
                          />
                        </div>
                        {pinnedCountry && (
                          <div className="absolute left-4 top-4 w-56 rounded-xl border border-[color:var(--shell-border)] bg-white/95 p-3 text-xs shadow-sm dark:bg-slate-900/90 dark:text-slate-100">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Pinned
                            </div>
                            <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                              {pinnedMeta?.name
                                ? `${pinnedMeta.name} (${pinnedCountry.toUpperCase()})`
                                : pinnedCountry.toUpperCase()}
                            </div>
                            {mapMode === "news" ? (
                              <>
                                <div className="mt-2 text-[color:var(--shell-muted)]">
                                  {pinnedNewsSummary
                                    ? `${pinnedNewsSummary.count} stories`
                                    : "No stories in range"}
                                </div>
                                <div className="text-[color:var(--shell-muted)]">
                                  Last:{" "}
                                  {pinnedNewsSummary?.lastEvent
                                    ? new Date(
                                        pinnedNewsSummary.lastEvent,
                                      ).toLocaleString()
                                    : "—"}
                                </div>
                                <div className="text-[color:var(--shell-muted)]">
                                  Top source: {pinnedTopSource ?? "—"}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="mt-2 text-[color:var(--shell-muted)]">
                                  Temp: {pinnedWeatherSummary?.temp_c ?? "—"}°C
                                </div>
                                <div className="text-[color:var(--shell-muted)]">
                                  Humidity:{" "}
                                  {pinnedWeatherSummary?.humidity ?? "—"}%
                                </div>
                                <div className="text-[color:var(--shell-muted)]">
                                  Observed:{" "}
                                  {pinnedWeatherSummary?.observed_at
                                    ? new Date(
                                        pinnedWeatherSummary.observed_at,
                                      ).toLocaleString()
                                    : "—"}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {mapMode === "news" &&
                          mapBubbleData.length === 0 &&
                          countryStats.length === 0 && (
                            <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-white px-2 py-1 rounded border border-[color:var(--shell-border)]">
                              No news data in the selected window.
                            </div>
                          )}
                        {mapMode === "weather" &&
                          mapWeatherScope.length === 0 && (
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
                      <div className="border-t border-[color:var(--shell-border)] px-4 py-3 text-xs">
                        {mapMode === "news" ? (
                          <>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                                Time
                              </span>
                              <button
                                onClick={() => setMapDayMode(false)}
                                className={`rounded-full border px-3 py-1 ${
                                  !mapDayMode
                                    ? "bg-[color:var(--shell-ink)] text-white border-[color:var(--shell-ink)]"
                                    : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                                }`}
                              >
                                Aggregate
                              </button>
                              <button
                                onClick={() => setMapDayMode(true)}
                                className={`rounded-full border px-3 py-1 ${
                                  mapDayMode
                                    ? "bg-[color:var(--shell-ink)] text-white border-[color:var(--shell-ink)]"
                                    : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                                }`}
                              >
                                Day
                              </button>
                              {!activeRange && (
                                <>
                                  <span className="text-[color:var(--shell-muted)]">
                                    Window: {mapWindowDays}d
                                  </span>
                                  <input
                                    type="range"
                                    min={MAP_WINDOW_MIN}
                                    max={MAP_WINDOW_MAX}
                                    value={mapWindowDays}
                                    onChange={(e) =>
                                      setMapWindowDays(
                                        Number(e.currentTarget.value),
                                      )
                                    }
                                    className="w-32"
                                  />
                                </>
                              )}
                              {activeRange && (
                                <span className="text-[color:var(--shell-muted)]">
                                  Using graph range ({activeRangeLabel})
                                </span>
                              )}
                              <span className="ml-auto text-[color:var(--shell-muted)]">
                                {mapRangeLabel}
                              </span>
                            </div>
                            {mapDayMode && mapDates.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-3">
                                <button
                                  onClick={() => setMapPlaying((v) => !v)}
                                  className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                                >
                                  {mapPlaying ? "Pause" : "Play"}
                                </button>
                                <input
                                  type="range"
                                  min={0}
                                  max={Math.max(0, mapDates.length - 1)}
                                  value={Math.min(
                                    mapDayIndex,
                                    mapDates.length - 1,
                                  )}
                                  onChange={(e) =>
                                    setMapDayIndex(
                                      Number(e.currentTarget.value),
                                    )
                                  }
                                  className="flex-1 min-w-[120px]"
                                />
                                <span className="text-[color:var(--shell-muted)]">
                                  {mapDayLabel}
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-[color:var(--shell-muted)]">
                            Time controls apply to news view. Switch to News to
                            animate.
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className={`${cardBase} dashboard-panel flex min-h-0 flex-col overflow-hidden md:h-full`}
                      style={{ animationDelay: "80ms" }}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Live feed
                          </div>
                          <div className="text-sm font-semibold">
                            Latest intelligence drops
                          </div>
                          <div className="text-xs text-[color:var(--shell-muted)]">
                            {regionLabel} · {activeRangeLabel}
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

                      <div className="flex-1 min-h-0 overflow-hidden">
                        {listMode === "news" ? (
                          <div
                            ref={feedRef}
                            className="h-full overflow-y-auto p-4 space-y-3"
                          >
                            {filteredNews.length === 0 && (
                              <div className="text-sm text-[color:var(--shell-muted)]">
                                No news items for the current filters.
                              </div>
                            )}
                            {filteredNews.map((n) => {
                              const img = imageProxy(
                                (n as any)?.payload?.urlToImage ??
                                  (n as any)?.payload?.raw?.urlToImage,
                              );
                              const iso = n.country_iso2?.toUpperCase();
                              const isPrimary =
                                !!selectedCountry &&
                                iso === selectedCountry.toUpperCase();
                              const isSecondary =
                                !!comparisonCountry &&
                                iso === comparisonCountry.toUpperCase();
                              return (
                                <div
                                  key={n.id}
                                  className={`rounded-xl border p-3 ${
                                    isPrimary
                                      ? "border-emerald-200 bg-emerald-50/60"
                                      : isSecondary
                                        ? "border-amber-200 bg-amber-50/60"
                                        : "border-[color:var(--shell-border)] bg-white"
                                  }`}
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
                                        {isPrimary && (
                                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                            Primary
                                          </span>
                                        )}
                                        {isSecondary && (
                                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                            Compare
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
                          <div className="h-full overflow-y-auto p-4 space-y-4">
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

                    <div
                      className={`${cardBase} dashboard-panel flex min-h-0 flex-col overflow-hidden md:h-full`}
                      style={{ animationDelay: "160ms" }}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Metrics
                          </div>
                          <div className="text-sm font-semibold">
                            Operational snapshot
                          </div>
                        </div>
                        <div className="text-xs text-[color:var(--shell-muted)]">
                          {todayLabel}
                        </div>
                      </div>
                      <div className="relative flex-1 min-h-0 p-4">
                        <div className="pointer-events-none absolute -right-10 top-6 h-24 w-24 rounded-full bg-[color:var(--signal-emerald-soft)] opacity-70 blur-2xl" />
                        <div className="relative grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Live signals
                            </div>
                            <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                              {filteredNews.length}
                            </div>
                            <div className="text-xs text-[color:var(--shell-muted)]">
                              Stories & alerts
                            </div>
                          </div>
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
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
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Weather rows
                            </div>
                            <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                              {filteredWeather.length}
                            </div>
                            <div className="text-xs text-[color:var(--shell-muted)]">
                              Latest observations
                            </div>
                          </div>
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
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
                          <div className="col-span-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-3 flex items-center justify-between">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                                Focus
                              </div>
                              <div className="text-base font-semibold text-[color:var(--shell-ink)]">
                                {focusLabel}
                              </div>
                            </div>
                            <span className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-xs uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                              {selectedCountry || comparisonCountry
                                ? "Filtered"
                                : regionFilter === "global"
                                  ? "Global"
                                  : "Region"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`${cardBase} dashboard-panel flex min-h-0 flex-col overflow-hidden md:h-full`}
                      style={{ animationDelay: "240ms" }}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            News volume
                          </div>
                          <div className="text-sm font-semibold">
                            Articles over the last {NEWS_TREND_WINDOW_DAYS} days
                          </div>
                          <div className="text-xs text-[color:var(--shell-muted)]">
                            {activeRangeLabel}
                          </div>
                        </div>
                        <div className="text-xs text-[color:var(--shell-muted)]">
                          {newsRangeTotal} stories
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--shell-border)] px-4 py-2 text-xs">
                        <button
                          onClick={() => setChartView("daily")}
                          className={`rounded-full border px-3 py-1 ${
                            chartView === "daily"
                              ? "bg-[color:var(--shell-ink)] text-white border-[color:var(--shell-ink)]"
                              : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                          }`}
                        >
                          Daily
                        </button>
                        <button
                          onClick={() => setChartView("rolling")}
                          className={`rounded-full border px-3 py-1 ${
                            chartView === "rolling"
                              ? "bg-[color:var(--shell-ink)] text-white border-[color:var(--shell-ink)]"
                              : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                          }`}
                        >
                          7d Avg
                        </button>
                        <button
                          onClick={() => setChartRange({})}
                          className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                        >
                          Reset range
                        </button>
                        <button
                          onClick={handleExportCsv}
                          className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                        >
                          Export CSV
                        </button>
                        <button
                          onClick={handleExportPng}
                          className="rounded-full border border-[color:var(--shell-border)] bg-white px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                        >
                          Export PNG
                        </button>
                      </div>
                      <div ref={chartRef} className="flex-1 min-h-0 p-4">
                        {newsTrendTotal === 0 ? (
                          <div className="h-full grid place-items-center text-sm text-[color:var(--shell-muted)]">
                            No timestamped articles yet.
                          </div>
                        ) : (
                          <>
                            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-[color:var(--shell-muted)]">
                              <span className="inline-flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                {regionLabel}
                              </span>
                              {selectedCountry && (
                                <span className="inline-flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                                  {selectedCountry.toUpperCase()}
                                </span>
                              )}
                              {comparisonCountry && (
                                <span className="inline-flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                                  {comparisonCountry.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={newsTrend}
                                margin={{ top: 10, right: 16, left: -8, bottom: 0 }}
                              >
                              <defs>
                                <linearGradient
                                  id="newsVolumeGradient"
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="1"
                                >
                                  <stop
                                    offset="5%"
                                    stopColor="var(--signal-emerald)"
                                    stopOpacity={0.4}
                                  />
                                  <stop
                                    offset="95%"
                                    stopColor="var(--signal-emerald)"
                                    stopOpacity={0.05}
                                  />
                                </linearGradient>
                              </defs>
                              <CartesianGrid
                                stroke={chartGridColor}
                                strokeDasharray="3 3"
                              />
                              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                              <YAxis
                                allowDecimals={false}
                                domain={[0, (max: number) => Math.max(2, max + 1)]}
                                tick={{ fontSize: 12 }}
                              />
                              <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                              {chartView === "daily" && (
                                <Area
                                  type="monotone"
                                  dataKey="count"
                                  stroke="var(--signal-emerald)"
                                  strokeWidth={2}
                                  fill="url(#newsVolumeGradient)"
                                />
                              )}
                              {chartView === "rolling" && (
                                <Line
                                  type="monotone"
                                  dataKey="rollingAvg"
                                  stroke="var(--signal-emerald)"
                                  strokeWidth={2}
                                  dot={false}
                                />
                              )}
                              {selectedCountry && (
                                <Line
                                  type="monotone"
                                  dataKey={
                                    chartView === "rolling"
                                      ? "selectedRollingAvg"
                                      : "selectedCount"
                                  }
                                  stroke="#0ea5e9"
                                  strokeWidth={2}
                                  dot={false}
                                />
                              )}
                              {comparisonCountry && (
                                <Line
                                  type="monotone"
                                  dataKey={
                                    chartView === "rolling"
                                      ? "comparisonRollingAvg"
                                      : "comparisonCount"
                                  }
                                  stroke="#f59e0b"
                                  strokeWidth={2}
                                  dot={false}
                                />
                              )}
                              {trendAnomalies.map((point) => (
                                <ReferenceDot
                                  key={point.dateKey}
                                  x={point.label}
                                  y={point.count}
                                  r={5}
                                  fill="#ef4444"
                                  stroke="#b91c1c"
                                  onClick={() => handleAnomalyClick(point.dateKey)}
                                />
                              ))}
                              <Brush
                                dataKey="label"
                                height={24}
                                stroke="#94a3b8"
                                startIndex={chartRange.startIndex}
                                endIndex={chartRange.endIndex}
                                onChange={(range) =>
                                  setChartRange({
                                    startIndex: range?.startIndex,
                                    endIndex: range?.endIndex,
                                  })
                                }
                              />
                              </AreaChart>
                            </ResponsiveContainer>
                          </>
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                <details className="rounded-2xl border border-[color:var(--shell-border)] bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
                  <summary className="cursor-pointer text-sm font-semibold text-[color:var(--shell-ink)]">
                    More panels
                  </summary>
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div
                      className={`${cardBase} dashboard-panel`}
                      style={{ animationDelay: "320ms" }}
                    >
                      <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                          Country profile
                        </div>
                        <div className="text-sm font-semibold">
                          Selected location overview
                        </div>
                      </div>
                      <div className="p-4 text-sm text-[color:var(--shell-muted)] space-y-2">
                        {!selectedCountry && !comparisonCountry && (
                          <div>
                            Select a bubble on the map to see a brief profile.
                          </div>
                        )}
                        {selectedCountry && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-700">
                              Primary
                            </div>
                            <div className="text-base font-semibold text-emerald-900">
                              {selectedMeta?.name
                                ? `${selectedMeta.name} (${selectedCountry.toUpperCase()})`
                                : selectedCountry.toUpperCase()}
                            </div>
                            <div className="text-xs text-emerald-700">
                              Region: {selectedMeta?.region ?? "—"}
                            </div>
                            <div className="text-xs text-emerald-700">
                              Subregion: {selectedMeta?.subregion ?? "—"}
                            </div>
                            <div className="text-xs text-emerald-700">
                              Stories in range:{" "}
                              {selectedCountryStats?.count ?? 0}
                            </div>
                            <div className="text-xs text-emerald-700">
                              Top source: {selectedTopSource ?? "—"}
                            </div>
                          </div>
                        )}
                        {comparisonCountry && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-amber-700">
                              Compare
                            </div>
                            <div className="text-base font-semibold text-amber-900">
                              {comparisonMeta?.name
                                ? `${comparisonMeta.name} (${comparisonCountry.toUpperCase()})`
                                : comparisonCountry.toUpperCase()}
                            </div>
                            <div className="text-xs text-amber-700">
                              Region: {comparisonMeta?.region ?? "—"}
                            </div>
                            <div className="text-xs text-amber-700">
                              Subregion: {comparisonMeta?.subregion ?? "—"}
                            </div>
                            <div className="text-xs text-amber-700">
                              Stories in range:{" "}
                              {comparisonCountryStats?.count ?? 0}
                            </div>
                            <div className="text-xs text-amber-700">
                              Top source: {comparisonTopSource ?? "—"}
                            </div>
                          </div>
                        )}
                        {(selectedCountry || comparisonCountry) && (
                          <div className="text-xs text-[color:var(--shell-muted)]">
                            Drill down by clicking a country bubble. Compare
                            mode lets you add a second focus.
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className={`${cardBase} dashboard-panel`}
                      style={{ animationDelay: "360ms" }}
                    >
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

                    <div
                      className={`${cardBase} dashboard-panel`}
                      style={{ animationDelay: "400ms" }}
                    >
                      <div className="border-b border-[color:var(--shell-border)] px-4 py-3 flex items-center gap-2">
                        <Bell className="h-4 w-4" />
                        <div className="text-sm font-semibold">
                          Notifications
                        </div>
                      </div>
                      <div className="p-4 text-sm text-[color:var(--shell-muted)]">
                        No notifications yet.
                      </div>
                    </div>
                  </div>
                </details>
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
