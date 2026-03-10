import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Search,
  Bell,
  Settings,
  User,
  CloudSun,
  Newspaper,
  ChartNoAxesCombined,
  Moon,
  Sun,
  LogOut,
  ChevronLeft,
  Menu,
  LayoutGrid,
  FileText,
  Maximize2,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  CartesianGrid,
  Legend,
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
const NEWS_ARCHIVE_PAGE_SIZE = 200;
const NEWS_ARCHIVE_MAX_PAGES = 150;
const NEWS_TREND_WINDOW_DAYS = 30;
const MAP_WINDOW_MIN = 7;
const MAP_WINDOW_MAX = 45;
const SPLIT_VIEW_MIN_WIDTH = 700;
const SPLIT_VIEW_MIN_HEIGHT = 620;

type DataWindowPreset = "30d" | "90d" | "180d" | "all";
type SearchTopic = "all" | "news" | "weather" | "markets";

const DATA_WINDOW_OPTIONS: Array<{
  id: DataWindowPreset;
  label: string;
  days: number | null;
}> = [
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "180d", label: "180d", days: 180 },
  { id: "all", label: "All", days: null },
];

const REGION_OPTIONS = [
  { id: "global", label: "Global" },
  { id: "americas", label: "Americas" },
  { id: "europe", label: "Europe" },
  { id: "africa", label: "Africa" },
  { id: "asia", label: "Asia" },
  { id: "apac", label: "APAC" },
  { id: "oceania", label: "Oceania" },
] as const;

const SEARCH_TOPIC_OPTIONS: Array<{ id: SearchTopic; label: string }> = [
  { id: "all", label: "All" },
  { id: "news", label: "News" },
  { id: "weather", label: "Weather" },
  { id: "markets", label: "Markets" },
];

const SEARCH_TOPIC_ALIASES: Record<string, SearchTopic> = {
  all: "all",
  news: "news",
  weather: "weather",
  market: "markets",
  markets: "markets",
  finance: "markets",
  financial: "markets",
  ai: "news",
  alerts: "news",
  wx: "weather",
};

const PROFILE_SECTIONS = [
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

type ParsedDashboardSearch = {
  topic: SearchTopic;
  terms: string[];
  raw: string;
};

type JsonObject = Record<string, unknown>;
type WorldCountryLike = {
  cca2?: string;
  properties?: { cca2?: string };
  name?: { common?: string; official?: string };
  region?: string;
  subregion?: string;
};

const asObject = (value: unknown): JsonObject | undefined => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return undefined;
};

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const prettySourceName = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "newsapi") return "NewsAPI";
  if (normalized === "thenewsapi") return "TheNewsAPI";
  if (normalized === "openweather") return "OpenWeather";
  if (normalized === "finnhub") return "Finnhub";
  return value.trim();
};

const getNewsImageUrl = (item: NewsItem): string | undefined => {
  const payload = asObject(item.payload);
  if (!payload) return undefined;
  const raw = asObject(payload["raw"]);
  return (
    asTrimmedString(payload["image"]) ??
    asTrimmedString(payload["urlToImage"]) ??
    asTrimmedString(payload["image_url"]) ??
    asTrimmedString(raw?.["image"]) ??
    asTrimmedString(raw?.["urlToImage"]) ??
    asTrimmedString(raw?.["image_url"])
  );
};

const resolveNewsSource = (item: NewsItem): string | undefined => {
  const sourceName = asTrimmedString(item.source_name);
  if (sourceName) return prettySourceName(sourceName);

  const payload = asObject(item.payload);
  const raw = asObject(payload?.["raw"]);

  const pickSource = (value: unknown): string | undefined => {
    const text = asTrimmedString(value);
    if (text) return text;
    const obj = asObject(value);
    return asTrimmedString(obj?.["name"]) ?? asTrimmedString(obj?.["id"]);
  };

  const source = (
    pickSource(raw?.["source"]) ??
    pickSource(payload?.["source"]) ??
    asTrimmedString(payload?.["provider"]) ??
    asTrimmedString(payload?.["publisher"]) ??
    asTrimmedString(payload?.["site"])
  );
  return source ? prettySourceName(source) : undefined;
};

const getDateKey = (value: Date | string) => {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const formatCompactNumber = (value?: number): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
};

const ANALYTICS_COLORS = [
  "#0f766e",
  "#0369a1",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#334155",
  "#0ea5e9",
  "#22c55e",
];

const OPENWEATHER_ICON_BASE = "https://openweathermap.org/img/wn";

const WEATHER_SYMBOLS: Record<string, string> = {
  clear: "☀️",
  clouds: "☁️",
  rain: "🌧️",
  drizzle: "🌦️",
  thunderstorm: "⛈️",
  snow: "❄️",
  mist: "🌫️",
  haze: "🌫️",
  fog: "🌫️",
  smoke: "🌫️",
  dust: "🌬️",
  sand: "🌬️",
  ash: "🌋",
  squall: "💨",
  tornado: "🌪️",
};

const weatherSymbol = (condition?: string | null): string => {
  if (!condition) return "🌤️";
  return WEATHER_SYMBOLS[condition.trim().toLowerCase()] ?? "🌤️";
};

const getWeatherIconUrl = (item: CountryWeather): string | undefined => {
  const code = asTrimmedString(item.icon_code);
  if (!code) return undefined;
  return `${OPENWEATHER_ICON_BASE}/${code}@2x.png`;
};

const weatherDrilldownUrl = (countryIso2?: string | null): string | undefined => {
  const iso = asTrimmedString(countryIso2)?.toUpperCase();
  if (!iso) return undefined;
  return `https://openweathermap.org/find?q=${encodeURIComponent(iso)}`;
};

const getMarketSourceLabel = (quote: MarketQuote): string => {
  const payload = asObject(quote.payload);
  const provider = asTrimmedString(payload?.["provider"]);
  if (provider) return prettySourceName(provider);
  return "Finnhub";
};

const getMarketLogoUrl = (quote: MarketQuote): string | undefined => {
  const payload = asObject(quote.payload);
  const profile = asObject(payload?.["profile"]);
  return asTrimmedString(profile?.["logo"]);
};

const getMarketProfile = (quote: MarketQuote): {
  industry?: string;
  marketCap?: number;
  ipo?: string;
  webUrl?: string;
} => {
  const payload = asObject(quote.payload);
  const profile = asObject(payload?.["profile"]);
  const marketCapRaw = profile?.["market_cap"];
  return {
    industry: asTrimmedString(profile?.["industry"]) ?? undefined,
    marketCap:
      typeof marketCapRaw === "number" && Number.isFinite(marketCapRaw)
        ? marketCapRaw
        : undefined,
    ipo: asTrimmedString(profile?.["ipo"]) ?? undefined,
    webUrl: asTrimmedString(profile?.["web_url"]) ?? undefined,
  };
};

const marketQuoteUrl = (symbol: string): string =>
  `https://finance.yahoo.com/quote/${encodeURIComponent(symbol.trim().toUpperCase())}`;

const COUNTRY_PRIMARY_MARKET_META: Record<string, { code: string; name: string }> = {
  US: { code: "NASDAQ", name: "NASDAQ Composite" },
  FR: { code: "CAC40", name: "CAC 40" },
  DE: { code: "DAX30", name: "DAX 30" },
  GB: { code: "FTSE100", name: "FTSE 100" },
  JP: { code: "NIKKEI225", name: "Nikkei 225" },
  CN: { code: "CSI300", name: "CSI 300" },
  IN: { code: "NIFTY50", name: "NIFTY 50" },
  AU: { code: "ASX200", name: "ASX 200" },
  CA: { code: "TSX", name: "S&P/TSX Composite" },
  BR: { code: "IBOVESPA", name: "Ibovespa" },
  MX: { code: "IPC", name: "S&P/BMV IPC" },
  ZA: { code: "JSE40", name: "FTSE/JSE Top 40" },
  KR: { code: "KOSPI", name: "KOSPI" },
  HK: { code: "HSI", name: "Hang Seng" },
  SG: { code: "STI", name: "Straits Times Index" },
  IT: { code: "FTSEMIB", name: "FTSE MIB" },
  ES: { code: "IBEX35", name: "IBEX 35" },
  CH: { code: "SMI", name: "Swiss Market Index" },
};

const getMarketIdentity = (quote: MarketQuote): {
  code?: string;
  name?: string;
  kind?: string;
} => {
  const payload = asObject(quote.payload);
  const market = asObject(payload?.["market"]);
  const country = asTrimmedString(quote.country)?.toUpperCase();
  const fallback = country ? COUNTRY_PRIMARY_MARKET_META[country] : undefined;
  const code =
    asTrimmedString(quote.market_code) ??
    asTrimmedString(market?.["code"]) ??
    fallback?.code ??
    asTrimmedString(quote.exchange);
  const name =
    asTrimmedString(quote.market_name) ??
    asTrimmedString(market?.["name"]) ??
    fallback?.name ??
    asTrimmedString(quote.exchange);
  const kind =
    asTrimmedString(quote.market_kind) ??
    asTrimmedString(market?.["kind"]) ??
    (fallback ? "country_primary" : undefined);
  return { code, name, kind };
};

const parseDashboardSearch = (
  raw: string,
  preferredTopic: SearchTopic,
): ParsedDashboardSearch => {
  const trimmed = raw.trim();
  if (!trimmed) return { topic: preferredTopic, terms: [], raw: "" };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let topic = preferredTopic;
  const terms: string[] = [];
  tokens.forEach((token) => {
    const lower = token.toLowerCase();
    const topicMatch = lower.match(/^(?:topic|t):([a-z]+)$/);
    if (topicMatch) {
      const mapped = SEARCH_TOPIC_ALIASES[topicMatch[1]];
      if (mapped) {
        topic = mapped;
        return;
      }
    }
    terms.push(lower);
  });
  return { topic, terms, raw: trimmed };
};

const stripDashboardSearchTopicTokens = (raw: string) =>
  raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const lower = token.toLowerCase();
      return !/^(?:topic|t):[a-z]+$/.test(lower);
    })
    .join(" ");

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
import PaywallPage from "./components/PaywallPage";
import AdminIngestionPanel from "./components/AdminIngestionPanel";
import AdminUserManagementPanel from "./components/AdminUserManagementPanel";
import WebsiteColourPalettePreview from "./components/WebsiteColourPalettePreview";
import {
  fetchAuthMe,
  fetchAuthProviders,
  fetchCountryStats,
  fetchCountryWeather,
  fetchMarketEarnings,
  fetchMarketQuotes,
  fetchMarketStatus,
  fetchNews,
  getAuthStartUrl,
  logoutAuth,
  imageProxy,
  type AuthProvider,
  type AuthProviderId,
  type AuthUser,
  type CountryStat,
  type CountryWeather,
  type EarningsEvent,
  type MarketQuote,
  type MarketStatus,
  type NewsItem,
} from "./lib/api";

export default function ClaritasDashboard() {
  const [query, setQuery] = useState("");
  const [searchTopic, setSearchTopic] = useState<SearchTopic>("all");
  const [authStatus, setAuthStatus] = useState<
    "checking" | "authed" | "unauthed"
  >("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<
    "dashboard" | "news" | "weather" | "markets" | "admin" | "profile" | "legal"
  >("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isRefreshingAccess, setIsRefreshingAccess] = useState(false);
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
  const [marketQuotes, setMarketQuotes] = useState<MarketQuote[]>([]);
  const [marketStatusRows, setMarketStatusRows] = useState<MarketStatus[]>([]);
  const [marketEarnings, setMarketEarnings] = useState<EarningsEvent[]>([]);
  const [marketEarningsWindowDays, setMarketEarningsWindowDays] = useState<7 | 14 | 30>(14);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoadMode, setNewsLoadMode] = useState<"recent" | "archive">(
    "recent",
  );
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [newsLoadError, setNewsLoadError] = useState<string | null>(null);
  const [dataWindowPreset, setDataWindowPreset] =
    useState<DataWindowPreset>("30d");
  const [mapMode, setMapMode] = useState<"news" | "weather">("news");
  const [listMode, setListMode] = useState<"news" | "weather" | "market">("news");
  const [mapScale, setMapScale] = useState<"linear" | "log">("linear");
  const [mapDayMode, setMapDayMode] = useState(false);
  const [mapWindowDays, setMapWindowDays] = useState(NEWS_TREND_WINDOW_DAYS);
  const [mapDayIndex, setMapDayIndex] = useState(0);
  const [mapPlaying, setMapPlaying] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [chartView, setChartView] = useState<"daily" | "rolling">("daily");
  const [chartRange, setChartRange] = useState<{
    startIndex?: number;
    endIndex?: number;
  }>({});
  const [minTemp, setMinTemp] = useState<number | undefined>(undefined);
  const [newsSourceFilter, setNewsSourceFilter] = useState<string>("all");
  const [newsCountryFilter, setNewsCountryFilter] = useState("");
  const [newsHasImageOnly, setNewsHasImageOnly] = useState(false);
  const [newsSortBy, setNewsSortBy] = useState<"newest" | "oldest" | "source">("newest");
  const [weatherConditionFilter, setWeatherConditionFilter] = useState<string>("all");
  const [weatherCountryFilter, setWeatherCountryFilter] = useState("");
  const [weatherHumidityFloor, setWeatherHumidityFloor] = useState<number | undefined>(undefined);
  const [weatherSortBy, setWeatherSortBy] = useState<"latest" | "hottest" | "coldest" | "humidity">(
    "latest",
  );
  const [marketExchangeFilter, setMarketExchangeFilter] = useState<string>("all");
  const [marketCountryFilter, setMarketCountryFilter] = useState<string>("all");
  const [marketIndexFilter, setMarketIndexFilter] = useState<string>("all");
  const [marketDirectionFilter, setMarketDirectionFilter] = useState<"all" | "gainers" | "losers">(
    "all",
  );
  const [marketMinAbsMove, setMarketMinAbsMove] = useState<number>(0);
  const [profileSection, setProfileSection] = useState<
    "overview" | "identity" | "preferences" | "security" | "policies"
  >("overview");
  const profileSections = PROFILE_SECTIONS;
  const feedRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const newsRequestIdRef = useRef(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
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
    } catch {
      // Ignore storage write errors (private mode, quota, etc).
    }
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
  }, [profileSections]);

  useEffect(() => {
    if (activeView === "profile") {
      setProfileSection("overview");
    }
  }, [activeView]);

  const isAdmin = (authUser?.roles ?? []).includes("admin");
  const hasPaidAccess = authUser?.billing?.has_access ?? true;

  useEffect(() => {
    if (!isAdmin && activeView === "admin") {
      setActiveView("dashboard");
    }
  }, [activeView, isAdmin]);

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

  const loadNewsData = useCallback(async (mode: "recent" | "archive") => {
    const requestId = newsRequestIdRef.current + 1;
    newsRequestIdRef.current = requestId;
    setIsLoadingNews(true);
    setNewsLoadError(null);
    try {
      if (mode === "recent") {
        const items = await fetchNews({ limit: NEWS_FETCH_LIMIT });
        if (newsRequestIdRef.current !== requestId) return;
        setNews(items);
        setNewsLoadMode("recent");
        return;
      }

      const items: NewsItem[] = [];
      const seenIds = new Set<number>();
      let offset = 0;
      for (let page = 0; page < NEWS_ARCHIVE_MAX_PAGES; page += 1) {
        const batch = await fetchNews({
          limit: NEWS_ARCHIVE_PAGE_SIZE,
          offset,
        });
        if (newsRequestIdRef.current !== requestId) return;
        if (batch.length === 0) break;
        batch.forEach((item) => {
          if (seenIds.has(item.id)) return;
          seenIds.add(item.id);
          items.push(item);
        });
        offset += batch.length;
        if (batch.length < NEWS_ARCHIVE_PAGE_SIZE) break;
      }
      setNews(items);
      setNewsLoadMode("archive");
    } catch (err) {
      if (newsRequestIdRef.current !== requestId) return;
      setNewsLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (newsRequestIdRef.current === requestId) {
        setIsLoadingNews(false);
      }
    }
  }, []);

  useEffect(() => {
    // Load initial data
    if (authStatus !== "authed" || !hasPaidAccess) return;
    fetchCountryStats({ days: 30 })
      .then(setCountryStats)
      .catch(() => setCountryStats([]));
    fetchCountryWeather()
      .then(setWeatherStats)
      .catch(() => setWeatherStats([]));
    fetchMarketQuotes({ refresh: true })
      .then(setMarketQuotes)
      .catch(() => setMarketQuotes([]));
    void loadNewsData("recent");
  }, [authStatus, hasPaidAccess, loadNewsData]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const quotes = await fetchMarketQuotes({ refresh: true });
        if (!cancelled) setMarketQuotes(quotes);
      } catch {
        // keep last successful market snapshot on transient failures
      }
    };
    const id = window.setInterval(() => {
      void refresh();
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [authStatus, hasPaidAccess]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess) return;
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const rows = await fetchMarketStatus({ refresh: true });
        if (!cancelled) setMarketStatusRows(rows);
      } catch {
        if (!cancelled) setMarketStatusRows([]);
      }
    };
    void refreshStatus();
    const id = window.setInterval(() => {
      void refreshStatus();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [authStatus, hasPaidAccess]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess) return;
    let cancelled = false;
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + marketEarningsWindowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    fetchMarketEarnings({ from, to, limit: 120 })
      .then((events) => {
        if (!cancelled) setMarketEarnings(events);
      })
      .catch(() => {
        if (!cancelled) setMarketEarnings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, hasPaidAccess, marketEarningsWindowDays]);

  const cardBase =
    "rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] shadow-sm";
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
    for (const c of worldCountries as WorldCountryLike[]) {
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

  const parsedSearch = useMemo(
    () => parseDashboardSearch(query, searchTopic),
    [query, searchTopic],
  );
  const searchTerms = parsedSearch.terms;
  const effectiveSearchTopic = parsedSearch.topic;
  const hasSearchQuery = searchTerms.length > 0;
  const searchAppliesToNews =
    effectiveSearchTopic === "all" || effectiveSearchTopic === "news";
  const searchAppliesToWeather =
    effectiveSearchTopic === "all" || effectiveSearchTopic === "weather";
  const searchAppliesToMarkets =
    effectiveSearchTopic === "all" || effectiveSearchTopic === "markets";
  const searchInputPlaceholder =
    effectiveSearchTopic === "weather"
      ? "Search weather topics (e.g. storm, humidity, US)"
      : effectiveSearchTopic === "news"
        ? "Search news topics (e.g. market, regulation, AI)"
        : effectiveSearchTopic === "markets"
          ? "Search market symbols (e.g. QQQ, CAC40, DAX30)"
        : "Search by topic or keyword (try topic:news OpenAI)";

  const getSourceLabel = useCallback((item: NewsItem) => {
    return resolveNewsSource(item);
  }, []);

  const matchesNewsSearch = useCallback(
    (item: NewsItem) => {
      if (searchTerms.length === 0) return true;
      const source = getSourceLabel(item) ?? "";
      const haystack = [
        item.title ?? "",
        item.summary ?? "",
        item.url ?? "",
        item.country_iso2 ?? "",
        source,
        item.event_time ?? "",
        item.kind ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchTerms.every((term) => haystack.includes(term));
    },
    [getSourceLabel, searchTerms],
  );

  const matchesWeatherSearch = useCallback(
    (item: CountryWeather) => {
      if (searchTerms.length === 0) return true;
      const haystack = [
        item.country ?? "",
        item.weather_main ?? "",
        item.temp_c != null ? String(item.temp_c) : "",
        item.humidity != null ? String(item.humidity) : "",
        item.observed_at ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchTerms.every((term) => haystack.includes(term));
    },
    [searchTerms],
  );

  const matchesMarketSearch = useCallback(
    (quote: MarketQuote) => {
      if (searchTerms.length === 0) return true;
      const market = getMarketIdentity(quote);
      const haystack = [
        quote.symbol ?? "",
        quote.company_name ?? "",
        quote.exchange ?? "",
        quote.country ?? "",
        quote.currency ?? "",
        market.code ?? "",
        market.name ?? "",
        quote.price != null ? String(quote.price) : "",
        quote.change != null ? String(quote.change) : "",
        quote.percent_change != null ? String(quote.percent_change) : "",
        quote.observed_at ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchTerms.every((term) => haystack.includes(term));
    },
    [searchTerms],
  );

  const newsSearchScope = useMemo(() => {
    if (!searchAppliesToNews || searchTerms.length === 0) return newsScope;
    return newsScope.filter(matchesNewsSearch);
  }, [newsScope, matchesNewsSearch, searchAppliesToNews, searchTerms.length]);

  const weatherScope = useMemo(() => {
    let rows = weatherStats;
    if (typeof minTemp === "number") {
      rows = rows.filter((x) => (x.temp_c ?? -999) >= minTemp);
    }
    if (regionCountries) {
      rows = rows.filter(
        (x) => x.country && regionCountries.has(x.country.toUpperCase()),
      );
    }
    return rows;
  }, [weatherStats, minTemp, regionCountries]);

  const weatherSearchScope = useMemo(() => {
    if (!searchAppliesToWeather || searchTerms.length === 0) {
      return weatherScope;
    }
    return weatherScope.filter(matchesWeatherSearch);
  }, [
    weatherScope,
    matchesWeatherSearch,
    searchAppliesToWeather,
    searchTerms.length,
  ]);

  const marketSearchScope = useMemo(() => {
    if (!searchAppliesToMarkets || searchTerms.length === 0) {
      return marketQuotes;
    }
    return marketQuotes.filter(matchesMarketSearch);
  }, [
    marketQuotes,
    matchesMarketSearch,
    searchAppliesToMarkets,
    searchTerms.length,
  ]);

  const selectedWindowOption = useMemo(
    () =>
      DATA_WINDOW_OPTIONS.find((option) => option.id === dataWindowPreset) ??
      DATA_WINDOW_OPTIONS[0],
    [dataWindowPreset],
  );

  const selectedWindowDays = selectedWindowOption.days;
  const selectedWindowLabel = selectedWindowOption.label;

  const newsDateBounds = useMemo(() => {
    const keys = newsSearchScope
      .map((item) => (item.event_time ? getDateKey(item.event_time) : null))
      .filter((value): value is string => Boolean(value))
      .sort();
    if (keys.length === 0) return null;
    return { start: keys[0], end: keys[keys.length - 1] };
  }, [newsSearchScope]);

  const newsCoverageLabel = useMemo(() => {
    if (!newsDateBounds) return "No dated articles loaded";
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${formatter.format(new Date(newsDateBounds.start))} – ${formatter.format(new Date(newsDateBounds.end))}`;
  }, [newsDateBounds]);

  const defaultRange = useMemo(() => {
    if (!newsDateBounds) return null;
    if (selectedWindowDays == null) return newsDateBounds;
    const endDate = new Date(newsDateBounds.end);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - selectedWindowDays + 1);
    const start = getDateKey(startDate);
    if (!start) return newsDateBounds;
    return {
      start: start < newsDateBounds.start ? newsDateBounds.start : start,
      end: newsDateBounds.end,
    };
  }, [newsDateBounds, selectedWindowDays]);

  const trendWindowLabel = useMemo(() => {
    if (selectedWindowDays == null) return "all available dates";
    return `the last ${selectedWindowDays} days`;
  }, [selectedWindowDays]);

  const newsTrend = useMemo(() => {
    if (!defaultRange) return [];
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
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
    const start = new Date(defaultRange.start);
    const end = new Date(defaultRange.end);
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = getDateKey(cursor);
      if (key) {
        buckets.set(key, {
          dateKey: key,
          label: formatter.format(cursor),
          count: 0,
          selectedCount: 0,
          comparisonCount: 0,
          rollingAvg: 0,
          selectedRollingAvg: 0,
          comparisonRollingAvg: 0,
          topCountries: [],
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const selectedIso = selectedCountry?.toUpperCase() ?? null;
    const comparisonIso = comparisonCountry?.toUpperCase() ?? null;
    const perDayCountries = new Map<string, Map<string, number>>();

    newsSearchScope.forEach((item) => {
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
      const startIdx = Math.max(0, idx - 6);
      const window = points.slice(startIdx, idx + 1);
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
  }, [newsSearchScope, selectedCountry, comparisonCountry, defaultRange]);

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
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (!activeRange) {
      if (!defaultRange) return selectedWindowLabel;
      return `${formatter.format(new Date(defaultRange.start))} – ${formatter.format(new Date(defaultRange.end))}`;
    }
    const startLabel =
      newsTrend.find((d) => d.dateKey === activeRange.start)?.label ??
      formatter.format(new Date(activeRange.start));
    const endLabel =
      newsTrend.find((d) => d.dateKey === activeRange.end)?.label ??
      formatter.format(new Date(activeRange.end));
    return `${startLabel} – ${endLabel}`;
  }, [activeRange, defaultRange, newsTrend, selectedWindowLabel]);

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
    let items = newsSearchScope;
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
  }, [newsSearchScope, effectiveRange, selectedCountries]);

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
  }, [filteredNews, getSourceLabel]);

  const mapRange = useMemo(() => {
    if (activeRange) return activeRange;
    const anchorDate = newsDateBounds?.end
      ? new Date(newsDateBounds.end)
      : new Date();
    const end = getDateKey(anchorDate);
    const windowSize = Math.min(
      MAP_WINDOW_MAX,
      Math.max(MAP_WINDOW_MIN, mapWindowDays),
    );
    const startDate = new Date(anchorDate);
    startDate.setDate(anchorDate.getDate() - windowSize + 1);
    const start = getDateKey(startDate);
    if (!start || !end) return null;
    return { start, end };
  }, [activeRange, mapWindowDays, newsDateBounds?.end]);

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
    let items = newsSearchScope;
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
  }, [
    newsSearchScope,
    mapRange,
    mapDayMode,
    mapDayIndex,
    mapDates,
  ]);

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
  }, [getSourceLabel, mapNews]);

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
    return weatherSearchScope;
  }, [weatherSearchScope]);

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
    let w = weatherSearchScope;
    if (selectedCountries.size > 0) {
      w = w.filter(
        (x) => x.country && selectedCountries.has(x.country.toUpperCase()),
      );
    }
    return w;
  }, [weatherSearchScope, selectedCountries]);

  const filteredMarket = useMemo(() => {
    return marketSearchScope;
  }, [marketSearchScope]);

  const newsSourceOptions = useMemo(() => {
    const sources = new Set<string>();
    newsSearchScope.forEach((item) => {
      const source = getSourceLabel(item);
      if (source) sources.add(source);
    });
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }, [getSourceLabel, newsSearchScope]);

  const newsPageItems = useMemo(() => {
    let items = filteredNews;
    if (newsSourceFilter !== "all") {
      const normalized = newsSourceFilter.trim().toLowerCase();
      items = items.filter((item) => (getSourceLabel(item) ?? "").toLowerCase() === normalized);
    }
    if (newsHasImageOnly) {
      items = items.filter((item) => Boolean(getNewsImageUrl(item)));
    }
    const countryTerm = newsCountryFilter.trim().toUpperCase();
    if (countryTerm) {
      items = items.filter((item) => (item.country_iso2 ?? "").toUpperCase().includes(countryTerm));
    }
    const sorted = [...items];
    if (newsSortBy === "newest") {
      sorted.sort((a, b) => (b.event_time || "").localeCompare(a.event_time || ""));
    } else if (newsSortBy === "oldest") {
      sorted.sort((a, b) => (a.event_time || "").localeCompare(b.event_time || ""));
    } else {
      sorted.sort((a, b) => {
        const sourceCmp = (getSourceLabel(a) ?? "").localeCompare(getSourceLabel(b) ?? "");
        if (sourceCmp !== 0) return sourceCmp;
        return (b.event_time || "").localeCompare(a.event_time || "");
      });
    }
    return sorted;
  }, [
    filteredNews,
    getSourceLabel,
    newsCountryFilter,
    newsHasImageOnly,
    newsSortBy,
    newsSourceFilter,
  ]);

  const newsPageTimelineData = useMemo(() => {
    const byDate = new Map<string, number>();
    newsPageItems.forEach((item) => {
      const key = item.event_time ? getDateKey(item.event_time) : null;
      if (!key) return;
      byDate.set(key, (byDate.get(key) ?? 0) + 1);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, stories]) => ({ date, stories }));
  }, [newsPageItems]);

  const newsPageSourceData = useMemo(() => {
    const bySource = new Map<string, number>();
    newsPageItems.forEach((item) => {
      const source = getSourceLabel(item) ?? "Unknown";
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
    });
    return Array.from(bySource.entries())
      .map(([source, stories]) => ({ source, stories }))
      .sort((a, b) => b.stories - a.stories)
      .slice(0, 8);
  }, [getSourceLabel, newsPageItems]);

  const weatherConditionOptions = useMemo(() => {
    const values = new Set<string>();
    weatherScope.forEach((row) => {
      const condition = asTrimmedString(row.weather_main);
      if (condition) values.add(condition);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [weatherScope]);

  const weatherPageRows = useMemo(() => {
    let rows = filteredWeather;
    if (weatherConditionFilter !== "all") {
      const normalized = weatherConditionFilter.trim().toLowerCase();
      rows = rows.filter((row) => (row.weather_main ?? "").trim().toLowerCase() === normalized);
    }
    const countryTerm = weatherCountryFilter.trim().toUpperCase();
    if (countryTerm) {
      rows = rows.filter((row) => (row.country ?? "").toUpperCase().includes(countryTerm));
    }
    if (typeof weatherHumidityFloor === "number" && Number.isFinite(weatherHumidityFloor)) {
      rows = rows.filter((row) => (row.humidity ?? -1) >= weatherHumidityFloor);
    }
    const sorted = [...rows];
    if (weatherSortBy === "hottest") {
      sorted.sort((a, b) => (b.temp_c ?? -999) - (a.temp_c ?? -999));
    } else if (weatherSortBy === "coldest") {
      sorted.sort((a, b) => (a.temp_c ?? 999) - (b.temp_c ?? 999));
    } else if (weatherSortBy === "humidity") {
      sorted.sort((a, b) => (b.humidity ?? -1) - (a.humidity ?? -1));
    } else {
      sorted.sort((a, b) => (b.observed_at || "").localeCompare(a.observed_at || ""));
    }
    return sorted;
  }, [
    filteredWeather,
    weatherConditionFilter,
    weatherCountryFilter,
    weatherHumidityFloor,
    weatherSortBy,
  ]);

  const weatherConditionChartData = useMemo(() => {
    const counts = new Map<string, number>();
    weatherPageRows.forEach((row) => {
      const condition = asTrimmedString(row.weather_main) ?? "Unknown";
      counts.set(condition, (counts.get(condition) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([condition, count]) => ({ condition, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [weatherPageRows]);

  const weatherTempChartData = useMemo(() => {
    return weatherPageRows
      .filter((row) => row.temp_c != null)
      .slice()
      .sort((a, b) => (b.temp_c ?? -999) - (a.temp_c ?? -999))
      .slice(0, 12)
      .map((row) => ({
        country: (row.country || "—").toUpperCase(),
        temp_c: row.temp_c ?? null,
        humidity: row.humidity ?? null,
      }));
  }, [weatherPageRows]);

  const weatherScatterData = useMemo(() => {
    return weatherPageRows
      .filter((row) => row.temp_c != null && row.humidity != null)
      .map((row) => ({
        country: (row.country || "—").toUpperCase(),
        temp_c: Number(row.temp_c),
        humidity: Number(row.humidity),
      }));
  }, [weatherPageRows]);

  const marketExchangeOptions = useMemo(() => {
    const set = new Set<string>();
    marketSearchScope.forEach((quote) => {
      const exchange = asTrimmedString(quote.exchange);
      if (exchange) set.add(exchange);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [marketSearchScope]);

  const marketCountryOptions = useMemo(() => {
    const set = new Set<string>();
    marketSearchScope.forEach((quote) => {
      const country = asTrimmedString(quote.country)?.toUpperCase();
      if (country) set.add(country);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [marketSearchScope]);

  const marketIndexOptions = useMemo(() => {
    const map = new Map<string, string>();
    marketSearchScope.forEach((quote) => {
      const market = getMarketIdentity(quote);
      if (!market.code) return;
      map.set(market.code, market.name ?? market.code);
    });
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [marketSearchScope]);

  const marketPageRows = useMemo(() => {
    let rows = filteredMarket;
    if (marketExchangeFilter !== "all") {
      const normalized = marketExchangeFilter.trim().toLowerCase();
      rows = rows.filter((quote) => (quote.exchange ?? "").trim().toLowerCase() === normalized);
    }
    if (marketCountryFilter !== "all") {
      const normalized = marketCountryFilter.trim().toUpperCase();
      rows = rows.filter((quote) => (quote.country ?? "").trim().toUpperCase() === normalized);
    }
    if (marketIndexFilter !== "all") {
      const normalized = marketIndexFilter.trim().toUpperCase();
      rows = rows.filter((quote) => (getMarketIdentity(quote).code ?? "").toUpperCase() === normalized);
    }
    if (marketDirectionFilter === "gainers") {
      rows = rows.filter((quote) => (quote.percent_change ?? 0) > 0);
    } else if (marketDirectionFilter === "losers") {
      rows = rows.filter((quote) => (quote.percent_change ?? 0) < 0);
    }
    if (marketMinAbsMove > 0) {
      rows = rows.filter((quote) => Math.abs(quote.percent_change ?? 0) >= marketMinAbsMove);
    }
    return [...rows].sort(
      (a, b) =>
        Math.abs(b.percent_change ?? b.change ?? 0) - Math.abs(a.percent_change ?? a.change ?? 0),
    );
  }, [
    filteredMarket,
    marketCountryFilter,
    marketDirectionFilter,
    marketExchangeFilter,
    marketIndexFilter,
    marketMinAbsMove,
  ]);

  const marketMoversChartData = useMemo(() => {
    return marketPageRows.slice(0, 12).map((quote) => ({
      symbol: quote.symbol,
      percent_change: quote.percent_change ?? 0,
      change: quote.change ?? 0,
    }));
  }, [marketPageRows]);

  const marketIndexPerfData = useMemo(() => {
    const byIndex = new Map<
      string,
      { name: string; count: number; total: number; gainers: number; losers: number; countries: Set<string> }
    >();
    marketPageRows.forEach((quote) => {
      const market = getMarketIdentity(quote);
      const code = (market.code ?? "UNMAPPED").toUpperCase();
      const current = byIndex.get(code) ?? {
        name: market.name ?? code,
        count: 0,
        total: 0,
        gainers: 0,
        losers: 0,
        countries: new Set<string>(),
      };
      current.count += 1;
      current.total += quote.percent_change ?? 0;
      if ((quote.percent_change ?? 0) > 0) current.gainers += 1;
      if ((quote.percent_change ?? 0) < 0) current.losers += 1;
      const country = asTrimmedString(quote.country)?.toUpperCase();
      if (country) current.countries.add(country);
      byIndex.set(code, current);
    });

    return Array.from(byIndex.entries())
      .map(([code, value]) => ({
        market_code: code,
        market_name: value.name,
        avg_change: value.count > 0 ? value.total / value.count : 0,
        count: value.count,
        gainers: value.gainers,
        losers: value.losers,
        country_count: value.countries.size,
      }))
      .sort((a, b) => Math.abs(b.avg_change) - Math.abs(a.avg_change))
      .slice(0, 12);
  }, [marketPageRows]);

  const marketCountryMarketRows = useMemo(() => {
    const byCountry = new Map<
      string,
      {
        count: number;
        total: number;
        topSymbol: string | null;
        topMove: number;
        indexCounts: Map<string, { name: string; count: number }>;
      }
    >();

    marketPageRows.forEach((quote) => {
      const country = (asTrimmedString(quote.country)?.toUpperCase() ?? "—");
      const market = getMarketIdentity(quote);
      const marketCode = (market.code ?? "UNMAPPED").toUpperCase();
      const marketName = market.name ?? marketCode;
      const current = byCountry.get(country) ?? {
        count: 0,
        total: 0,
        topSymbol: null,
        topMove: 0,
        indexCounts: new Map<string, { name: string; count: number }>(),
      };
      current.count += 1;
      current.total += quote.percent_change ?? 0;
      const absMove = Math.abs(quote.percent_change ?? quote.change ?? 0);
      if (!current.topSymbol || absMove > Math.abs(current.topMove)) {
        current.topSymbol = quote.symbol;
        current.topMove = quote.percent_change ?? quote.change ?? 0;
      }
      const marketCount = current.indexCounts.get(marketCode) ?? {
        name: marketName,
        count: 0,
      };
      marketCount.count += 1;
      current.indexCounts.set(marketCode, marketCount);
      byCountry.set(country, current);
    });

    return Array.from(byCountry.entries())
      .map(([country, value]) => {
        const [primaryMarketCode, primaryMarket] = Array.from(value.indexCounts.entries()).sort(
          (a, b) => b[1].count - a[1].count
        )[0] ?? ["UNMAPPED", { name: "Unmapped exchange", count: 0 }];
        return {
          country,
          market_code: primaryMarketCode,
          market_name: primaryMarket.name,
          count: value.count,
          avg_change: value.count > 0 ? value.total / value.count : 0,
          top_symbol: value.topSymbol ?? "—",
          top_move: value.topMove,
        };
      })
      .sort((a, b) => a.country.localeCompare(b.country));
  }, [marketPageRows]);

  const marketIndexMapData = useMemo(() => {
    return marketCountryMarketRows.map((row) => {
      const scaled = Math.max(1, Math.round(Math.abs(row.avg_change) * 18));
      return {
        country: row.country,
        count: scaled,
        meta: {
          subtitle: `${row.market_code} · ${row.avg_change >= 0 ? "+" : ""}${row.avg_change.toFixed(2)}%`,
          lines: [
            row.market_name,
            `${row.count} tracked symbols`,
          ],
        },
      };
    });
  }, [marketCountryMarketRows]);

  const marketStatusDisplayRows = useMemo(() => {
    return [...marketStatusRows].sort((a, b) => {
      const aOpen = a.is_open ? 1 : 0;
      const bOpen = b.is_open ? 1 : 0;
      if (aOpen !== bOpen) return bOpen - aOpen;
      return a.exchange.localeCompare(b.exchange);
    });
  }, [marketStatusRows]);

  const marketStatusSummary = useMemo(() => {
    const open = marketStatusRows.filter((row) => row.is_open).length;
    const total = marketStatusRows.length;
    return { open, total };
  }, [marketStatusRows]);

  const marketEarningsRows = useMemo(() => {
    let rows = [...marketEarnings];
    if (selectedSymbol) {
      const normalized = selectedSymbol.toUpperCase();
      rows = rows.filter((row) => row.symbol.toUpperCase() === normalized);
    }
    return rows.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }, [marketEarnings, selectedSymbol]);

  const weatherByCountry = useMemo(() => {
    const map = new Map<string, CountryWeather>();
    weatherStats.forEach((entry) => {
      const iso = entry.country?.toUpperCase();
      if (!iso) return;
      const current = map.get(iso);
      if (!current) {
        map.set(iso, entry);
        return;
      }
      if ((entry.observed_at || "") > (current.observed_at || "")) {
        map.set(iso, entry);
      }
    });
    return map;
  }, [weatherStats]);

  const marketByCountry = useMemo(() => {
    const map = new Map<string, MarketQuote[]>();
    marketQuotes.forEach((quote) => {
      const iso = quote.country?.toUpperCase();
      if (!iso) return;
      const list = map.get(iso) ?? [];
      list.push(quote);
      map.set(iso, list);
    });
    map.forEach((quotes, iso) => {
      map.set(
        iso,
        [...quotes].sort(
          (a, b) =>
            Math.abs(b.percent_change ?? 0) - Math.abs(a.percent_change ?? 0),
        ),
      );
    });
    return map;
  }, [marketQuotes]);

  const selectedSymbolQuote = useMemo(() => {
    if (!selectedSymbol) return null;
    const normalized = selectedSymbol.toUpperCase();
    return (
      marketQuotes.find((quote) => quote.symbol.toUpperCase() === normalized) ??
      null
    );
  }, [marketQuotes, selectedSymbol]);

  const selectedSymbolMarket = useMemo(() => {
    if (!selectedSymbolQuote) return null;
    return getMarketIdentity(selectedSymbolQuote);
  }, [selectedSymbolQuote]);

  const selectedSymbolProfile = useMemo(() => {
    if (!selectedSymbolQuote) return null;
    return getMarketProfile(selectedSymbolQuote);
  }, [selectedSymbolQuote]);

  const relationCountry = useMemo(() => {
    const fromCountry = selectedCountry?.toUpperCase();
    if (fromCountry) return fromCountry;
    const fromSymbol = selectedSymbolQuote?.country?.toUpperCase();
    if (fromSymbol) return fromSymbol;
    return null;
  }, [selectedCountry, selectedSymbolQuote]);

  const relatedWeather = useMemo(() => {
    if (!relationCountry) return null;
    return weatherByCountry.get(relationCountry) ?? null;
  }, [relationCountry, weatherByCountry]);

  const relatedMarkets = useMemo(() => {
    if (!relationCountry) return [];
    return (marketByCountry.get(relationCountry) ?? []).slice(0, 6);
  }, [marketByCountry, relationCountry]);

  const relatedNews = useMemo(() => {
    if (!relationCountry) return [];
    return [...news]
      .filter((item) => item.country_iso2?.toUpperCase() === relationCountry)
      .sort((a, b) => (b.event_time || "").localeCompare(a.event_time || ""))
      .slice(0, 6);
  }, [news, relationCountry]);

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
    filteredMarket.forEach((quote) => {
      const time = Date.parse(quote.observed_at);
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
  }, [filteredNews, filteredWeather, filteredMarket]);

  const focusLabel = useMemo(() => {
    if (selectedCountry && comparisonCountry) {
      return `${selectedCountry.toUpperCase()} + ${comparisonCountry.toUpperCase()}`;
    }
    if (selectedCountry) return selectedCountry.toUpperCase();
    if (comparisonCountry) return comparisonCountry.toUpperCase();
    return regionFilter === "global" ? "Global" : regionLabel;
  }, [selectedCountry, comparisonCountry, regionFilter, regionLabel]);

  const activeSearchTopicLabel =
    SEARCH_TOPIC_OPTIONS.find((option) => option.id === effectiveSearchTopic)
      ?.label ?? "All";

  const aiSearchPreview = useMemo(() => {
    const news = newsSearchScope.slice(0, 4).map((item) => ({
      key: `news-${item.id}`,
      kind: "News",
      title: item.title ?? item.url ?? "Untitled",
      subtitle: [
        item.country_iso2 ? item.country_iso2.toUpperCase() : null,
        item.event_time ? new Date(item.event_time).toLocaleString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: item.url ?? null,
    }));
    const weather = weatherSearchScope.slice(0, 4).map((row, idx) => ({
      key: `weather-${row.country}-${row.observed_at}-${idx}`,
      kind: "Weather",
      title: `${(row.country || "—").toUpperCase()} · ${row.temp_c ?? "—"}°C`,
      subtitle: [
        row.weather_main ?? null,
        row.humidity != null ? `${row.humidity}% humidity` : null,
        row.observed_at ? new Date(row.observed_at).toLocaleString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: null,
    }));
    const markets = marketSearchScope.slice(0, 4).map((quote, idx) => ({
      key: `market-${quote.symbol}-${quote.observed_at}-${idx}`,
      kind: "Market",
      title: `${quote.symbol} · ${quote.price ?? "—"}`,
      subtitle: [
        quote.company_name ?? null,
        quote.exchange ?? null,
        quote.percent_change != null ? `${quote.percent_change.toFixed(2)}%` : null,
        quote.observed_at ? new Date(quote.observed_at).toLocaleString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: null,
    }));

    if (effectiveSearchTopic === "news") {
      return news;
    }
    if (effectiveSearchTopic === "weather") {
      return weather;
    }
    if (effectiveSearchTopic === "markets") {
      return markets;
    }
    return [...news.slice(0, 2), ...weather.slice(0, 1), ...markets.slice(0, 1)];
  }, [effectiveSearchTopic, marketSearchScope, newsSearchScope, weatherSearchScope]);

  const splitViewEnabled = useMemo(
    () =>
      viewportSize.width >= SPLIT_VIEW_MIN_WIDTH &&
      viewportSize.height >= SPLIT_VIEW_MIN_HEIGHT,
    [viewportSize.height, viewportSize.width],
  );

  const dashboardPanelClass = `${cardBase} dashboard-panel flex min-h-0 flex-col overflow-hidden${
    splitViewEnabled ? " h-full" : ""
  }`;

  const dashboardHeight = useMemo(() => {
    const padding = 48; // py-6 on main (top + bottom)
    if (!headerHeight) return `calc(100dvh - ${padding}px)`;
    return `calc(100dvh - ${headerHeight}px - ${padding}px)`;
  }, [headerHeight]);

  useEffect(() => {
    if (!selectedCountry) {
      setComparisonCountry(null);
      setCompareMode(false);
    }
  }, [selectedCountry]);

  useEffect(() => {
    if (!selectedSymbol) return;
    const hasSymbol = marketQuotes.some(
      (quote) => quote.symbol.toUpperCase() === selectedSymbol.toUpperCase(),
    );
    if (!hasSymbol) setSelectedSymbol(null);
  }, [marketQuotes, selectedSymbol]);

  useEffect(() => {
    if (dataWindowPreset === "all" || !newsDateBounds) return;
    const latest = new Date(newsDateBounds.end);
    const now = new Date();
    const staleDays = Math.floor(
      (now.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (staleDays > 180) {
      setDataWindowPreset("all");
      setChartRange({});
    }
  }, [dataWindowPreset, newsDateBounds]);

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

  useEffect(() => {
    if (activeView !== "dashboard" && mapExpanded) {
      setMapExpanded(false);
    }
  }, [activeView, mapExpanded]);

  useEffect(() => {
    if (!mapExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMapExpanded(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mapExpanded]);

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
    const update = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
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

  const handleSearchTopicChange = useCallback((topic: SearchTopic) => {
    setSearchTopic(topic);
    setQuery((value) => stripDashboardSearchTopicTokens(value));
  }, []);

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
      <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-xs text-[color:var(--shell-ink)] shadow dark:bg-slate-900 dark:text-slate-100">
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
    {
      id: "news",
      label: "News",
      view: "news" as const,
      icon: Newspaper,
    },
    {
      id: "weather",
      label: "Weather",
      view: "weather" as const,
      icon: CloudSun,
    },
    {
      id: "markets",
      label: "Markets",
      view: "markets" as const,
      icon: ChartNoAxesCombined,
    },
    ...(isAdmin
      ? [{ id: "admin", label: "Admin", view: "admin" as const, icon: Settings }]
      : []),
    { id: "profile", label: "Profile", view: "profile" as const, icon: User },
    { id: "legal", label: "Policies", view: "legal" as const, icon: FileText },
  ];

  const viewMeta = {
    dashboard: { kicker: "Dashboard", title: "Signal desk overview" },
    news: { kicker: "News", title: "Global news signal stream" },
    weather: { kicker: "Weather", title: "Weather signal operations" },
    markets: { kicker: "Markets", title: "Market watch and correlations" },
    admin: { kicker: "Admin", title: "Data ingestion control" },
    profile: { kicker: "Account", title: "Profile & access" },
    legal: { kicker: "Legal", title: "Policies & usage" },
  } as const;

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

  const handleRefreshAccess = async () => {
    if (isRefreshingAccess) return;
    setIsRefreshingAccess(true);
    setSessionNotice(null);
    try {
      const user = await fetchAuthMe();
      setAuthUser(user);
      setAuthStatus(user ? "authed" : "unauthed");
      if (user?.billing?.has_access) {
        setSessionNotice({
          tone: "success",
          message: "Billing access is active. Dashboard unlocked.",
        });
      } else {
        setSessionNotice({
          tone: "info",
          message: "Payment not active yet for this account. Try again after checkout confirmation.",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSessionNotice({
        tone: "error",
        message: `Billing refresh failed: ${message}`,
      });
    } finally {
      setIsRefreshingAccess(false);
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

  if (!hasPaidAccess && authUser) {
    return (
      <PaywallPage
        user={authUser}
        billing={authUser.billing}
        onRefresh={() => void handleRefreshAccess()}
        onSignOut={() => void handleSignOut()}
        refreshing={isRefreshingAccess}
        signingOut={isSigningOut}
      />
    );
  }

  return (
    <div className="app-safe-x min-h-[100dvh] w-full bg-[color:var(--shell-bg)] text-[color:var(--shell-ink)]">
      {mobileNavOpen && (
        <div className="app-safe-top app-safe-bottom fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[min(20rem,88vw)] bg-[color:var(--shell-sidebar)] text-white shadow-2xl">
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
                          ? "bg-[color:var(--shell-surface)]/10 text-white"
                          : "text-white/70 hover:bg-[color:var(--shell-surface)]/10 hover:text-white"
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
                    <div className="h-9 w-9 rounded-full bg-[color:var(--shell-surface)]/15 text-sm font-semibold uppercase grid place-items-center">
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-[color:var(--shell-surface)]/10 px-3 py-2 text-sm text-white/90 hover:bg-[color:var(--shell-surface)]/15 disabled:opacity-60"
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
                      ? "bg-[color:var(--shell-surface)]/10 text-white"
                      : "text-white/70 hover:bg-[color:var(--shell-surface)]/10 hover:text-white"
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
                <div className="h-10 w-10 rounded-full bg-[color:var(--shell-surface)]/15 text-sm font-semibold uppercase grid place-items-center">
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-[color:var(--shell-surface)]/10 px-3 py-2 text-sm text-white/90 hover:bg-[color:var(--shell-surface)]/15 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col min-h-0">
          <header
            ref={headerRef}
            className="app-safe-top sticky top-0 z-20 border-b border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]"
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
                <div className="hidden md:flex items-center gap-2">
                  <div className="flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm text-[color:var(--shell-muted)]">
                    <Search className="h-4 w-4" />
                    <input
                      className="w-44 lg:w-64 bg-transparent text-sm outline-none placeholder:text-[color:var(--shell-muted)]"
                      placeholder={searchInputPlaceholder}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="rounded-md p-0.5 text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-1 text-xs">
                    {SEARCH_TOPIC_OPTIONS.map((option) => {
                      const active = effectiveSearchTopic === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleSearchTopicChange(option.id)}
                          className={`rounded-lg px-2.5 py-1 transition ${
                            active
                              ? "bg-[color:var(--shell-ink)] text-white"
                              : "text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  aria-label="Toggle dark mode"
                  onClick={() => setDark((v) => !v)}
                  className="h-10 w-10 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-ink)] hover:bg-slate-800/40"
                >
                  <span className="grid h-full w-full place-items-center">
                    {dark ? (
                      <Sun className="h-5 w-5" />
                    ) : (
                      <Moon className="h-5 w-5" />
                    )}
                  </span>
                </button>
                <div className="hidden sm:flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs text-[color:var(--shell-muted)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="max-w-[160px] truncate">{userLabel}</span>
                </div>
              </div>
            </div>
          </header>

          <main className="app-safe-bottom mx-auto w-full max-w-7xl flex-1 min-h-0 flex flex-col px-4 py-6 sm:px-6 lg:px-8">
            {sessionNotice && (
              <div className="mb-6">
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    sessionNotice.tone === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : sessionNotice.tone === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-[color:var(--shell-surface)] text-slate-700"
                  }`}
                >
                  {sessionNotice.message}
                </div>
              </div>
            )}

            {activeView === "dashboard" && (
              <div
                className={`relative flex flex-col gap-4 ${
                  splitViewEnabled
                    ? "flex-1 min-h-0 overflow-hidden h-[var(--dashboard-h)]"
                    : ""
                }`}
                style={{ "--dashboard-h": dashboardHeight } as CSSProperties}
              >
                <div
                  className={`relative flex flex-col gap-4 ${
                    splitViewEnabled ? "flex-1 min-h-0 overflow-hidden" : ""
                  }`}
                >
                  <div className="pointer-events-none absolute -top-20 right-0 h-64 w-64 rounded-full bg-[color:var(--signal-emerald-soft)] opacity-70 blur-3xl dark:bg-emerald-900/40 dark:opacity-40" />
                  <div className="pointer-events-none absolute -bottom-24 left-0 h-72 w-72 rounded-full bg-[color:var(--signal-sky-soft)] opacity-80 blur-3xl dark:bg-sky-900/40 dark:opacity-40" />

                  <div
                    className={`${cardBase} dashboard-panel flex flex-wrap items-center gap-3 px-4 py-3`}
                    style={{ animationDelay: "0ms" }}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Window
                      </span>
                      {DATA_WINDOW_OPTIONS.map((option) => {
                        const active = dataWindowPreset === option.id;
                        return (
                          <button
                            key={option.id}
                            onClick={() => {
                              setDataWindowPreset(option.id);
                              setChartRange({});
                            }}
                            className={`rounded-full border px-3 py-1 transition ${
                              active
                                ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                      <span>Coverage: {newsCoverageLabel}</span>
                      <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-ink)]">
                        {newsLoadMode === "archive"
                          ? `Archive (${news.length})`
                          : `Recent (${news.length})`}
                      </span>
                      <button
                        onClick={() =>
                          void loadNewsData(
                            newsLoadMode === "archive" ? "recent" : "archive",
                          )
                        }
                        disabled={isLoadingNews}
                        className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] disabled:opacity-60"
                      >
                        {isLoadingNews
                          ? "Loading…"
                          : newsLoadMode === "archive"
                            ? "Use recent"
                            : "Load all data"}
                      </button>
                    </div>
                    <div className="w-full space-y-2 md:hidden">
                      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm text-[color:var(--shell-muted)]">
                        <Search className="h-4 w-4" />
                        <input
                          className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--shell-muted)]"
                          placeholder={searchInputPlaceholder}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-1 text-xs">
                        {SEARCH_TOPIC_OPTIONS.map((option) => {
                          const active = effectiveSearchTopic === option.id;
                          return (
                            <button
                              key={`mobile-${option.id}`}
                              type="button"
                              onClick={() => handleSearchTopicChange(option.id)}
                              className={`rounded-lg px-2.5 py-1 transition ${
                                active
                                  ? "bg-[color:var(--shell-ink)] text-white"
                                  : "text-[color:var(--shell-muted)]"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {newsLoadError && (
                      <div className="w-full text-xs text-rose-600">
                        Failed to refresh news data: {newsLoadError}
                      </div>
                    )}
                  </div>

                  <section
                    className={`relative grid flex-1 min-h-0 gap-4 ${
                      splitViewEnabled
                        ? "grid-cols-2 grid-rows-2 h-full overflow-hidden"
                        : "grid-cols-1"
                    }`}
                  >
                    <div
                      id="signal-map-feed"
                      className={dashboardPanelClass}
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
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
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
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => {
                              setMapMode("weather");
                              setListMode("weather");
                            }}
                          >
                            Weather
                          </button>
                          <button
                            type="button"
                            onClick={() => setMapExpanded(true)}
                            className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] transition hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                            Expand
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
                                    : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
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
                            className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                          >
                            Scale: {mapScale === "linear" ? "Linear" : "Log"}
                          </button>
                          <button
                            onClick={() => setCompareMode((v) => !v)}
                            className={`rounded-full border px-3 py-1 transition ${
                              compareMode
                                ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
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
                            className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] disabled:opacity-50"
                            disabled={!selectedCountry}
                          >
                            Pin selection
                          </button>
                          {pinnedCountry && (
                            <button
                              onClick={() => setPinnedCountry(null)}
                              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            >
                              Unpin
                            </button>
                          )}
                          {(selectedCountry || comparisonCountry) && (
                            <button
                              onClick={handleClearSelection}
                              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
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
                        <div
                          className={`relative min-h-0 rounded-2xl overflow-hidden bg-[color:var(--shell-bg)] ${
                            splitViewEnabled
                              ? "h-full"
                              : "h-[56vh] max-h-[560px]"
                          }`}
                        >
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
                            showLabels={false}
                          />
                        </div>
                        {pinnedCountry && (
                          <div className="absolute left-4 top-4 w-56 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]/95 p-3 text-xs shadow-sm dark:bg-slate-900/90 dark:text-slate-100">
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
                            <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-[color:var(--shell-surface)] px-2 py-1 rounded border border-[color:var(--shell-border)]">
                              No news data in the selected window.
                            </div>
                          )}
                        {mapMode === "weather" &&
                          mapWeatherScope.length === 0 && (
                            <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-[color:var(--shell-surface)] px-2 py-1 rounded border border-[color:var(--shell-border)] flex items-center gap-2">
                              <span>No weather stats yet.</span>
                              {isAdmin ? (
                                <button
                                  onClick={() => setActiveView("admin")}
                                  className="px-2 py-0.5 rounded border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:bg-slate-800/40"
                                >
                                  Open admin ingest
                                </button>
                              ) : (
                                <span>Admin ingestion required.</span>
                              )}
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
                                  className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
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
                      className={dashboardPanelClass}
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
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setListMode("news")}
                          >
                            News
                          </button>
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              listMode === "weather"
                                ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setListMode("weather")}
                          >
                            Weather
                          </button>
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              listMode === "market"
                                ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setListMode("market")}
                          >
                            Markets
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
                              <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-sm text-[color:var(--shell-muted)] space-y-2">
                                <div>No news items for the current filters.</div>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  {dataWindowPreset !== "all" && (
                                    <button
                                      onClick={() => {
                                        setDataWindowPreset("all");
                                        setChartRange({});
                                      }}
                                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                                    >
                                      Show all dates
                                    </button>
                                  )}
                                  {newsLoadMode !== "archive" && (
                                    <button
                                      onClick={() => void loadNewsData("archive")}
                                      disabled={isLoadingNews}
                                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] disabled:opacity-60"
                                    >
                                      {isLoadingNews
                                        ? "Loading…"
                                        : "Load all data"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                            {filteredNews.map((n) => {
                              const img = imageProxy(getNewsImageUrl(n));
                              const sourceLabel = getSourceLabel(n);
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
                                        : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]"
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
                                        {sourceLabel && (
                                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                                            {sourceLabel}
                                          </span>
                                        )}
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
                        ) : listMode === "weather" ? (
                          <div className="h-full overflow-y-auto p-4 space-y-4">
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <label className="text-[color:var(--shell-muted)]">
                                Min temp (°C)
                              </label>
                              <input
                                type="number"
                                className="w-24 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1"
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
                              {isAdmin ? (
                                <button
                                  onClick={() => setActiveView("admin")}
                                  className="ml-auto rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)] hover:bg-slate-800/40"
                                >
                                  Open admin ingest
                                </button>
                              ) : (
                                <div className="ml-auto text-xs text-[color:var(--shell-muted)]">
                                  Ingestion is admin-only
                                </div>
                              )}
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
                        ) : (
                          <div className="h-full overflow-y-auto p-4 space-y-4">
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <div className="text-[color:var(--shell-muted)]">
                                Real-time quotes from Finnhub
                              </div>
                              <div className="ml-auto text-xs text-[color:var(--shell-muted)]">
                                {filteredMarket.length} symbols
                              </div>
                            </div>
                            <ul className="list-none divide-y divide-[color:var(--shell-border)]">
                              {filteredMarket.length === 0 && (
                                <li className="text-sm text-[color:var(--shell-muted)] py-3">
                                  No market rows.
                                </li>
                              )}
                              {filteredMarket.map((quote) => {
                                const isPositive =
                                  typeof quote.change === "number" && quote.change > 0;
                                const isNegative =
                                  typeof quote.change === "number" && quote.change < 0;
                                return (
                                  <li
                                    key={`${quote.symbol}-${quote.observed_at}`}
                                    className="py-3 flex flex-col gap-2"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                          <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-[color:var(--shell-border)] text-slate-700">
                                            {quote.symbol}
                                          </span>
                                          {quote.exchange && (
                                            <span className="text-xs text-[color:var(--shell-muted)]">
                                              {quote.exchange}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-[color:var(--shell-muted)] mt-1">
                                          {quote.company_name ?? "—"}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-base font-semibold text-[color:var(--shell-ink)]">
                                          {quote.price ?? "—"}
                                          {quote.currency ? ` ${quote.currency}` : ""}
                                        </div>
                                        <div
                                          className={`text-xs ${
                                            isPositive
                                              ? "text-emerald-600"
                                              : isNegative
                                                ? "text-rose-600"
                                                : "text-[color:var(--shell-muted)]"
                                          }`}
                                        >
                                          {quote.change != null ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}` : "—"}
                                          {" · "}
                                          {quote.percent_change != null
                                            ? `${quote.percent_change >= 0 ? "+" : ""}${quote.percent_change.toFixed(2)}%`
                                            : "—"}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-[color:var(--shell-muted)]">
                                      <span>Open {quote.open_price ?? "—"}</span>
                                      <span>High {quote.high_price ?? "—"}</span>
                                      <span>Low {quote.low_price ?? "—"}</span>
                                      <span>Prev {quote.previous_close ?? "—"}</span>
                                      <span className="ml-auto">
                                        {new Date(quote.observed_at).toLocaleString()}
                                      </span>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className={dashboardPanelClass}
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
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
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
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
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
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Market quotes
                            </div>
                            <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                              {filteredMarket.length}
                            </div>
                            <div className="text-xs text-[color:var(--shell-muted)]">
                              Realtime snapshots
                            </div>
                          </div>
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
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
                            <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
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
                      className={dashboardPanelClass}
                      style={{ animationDelay: "240ms" }}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            News volume
                          </div>
                          <div className="text-sm font-semibold">
                            Articles over {trendWindowLabel}
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
                          className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                        >
                          Reset range
                        </button>
                        <button
                          onClick={handleExportCsv}
                          className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                        >
                          Export CSV
                        </button>
                        <button
                          onClick={handleExportPng}
                          className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
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

                {mapExpanded && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
                    onClick={() => setMapExpanded(false)}
                  >
                    <div
                      className="w-full max-w-6xl rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] shadow-2xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Expanded map
                          </div>
                          <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                            {mapMode === "news"
                              ? "News coverage by country"
                              : "Weather observations by country"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMapExpanded(false)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                          aria-label="Close expanded map"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="p-4">
                        <div className="h-[min(74vh,760px)] min-h-[20rem] overflow-hidden rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)]">
                          <WorldMapBubbles
                            variant="default"
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
                      </div>
                      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--shell-border)] px-4 py-3 text-xs text-[color:var(--shell-muted)]">
                        <span>
                          Window: {mapRangeLabel}
                          {mapDayMode && mapMode === "news" ? ` · ${mapDayLabel}` : ""}
                        </span>
                        <span>
                          Countries shown:{" "}
                          {mapMode === "news"
                            ? mapBubbleData.length
                            : mapWeatherData.length}
                        </span>
                        <span className="ml-auto">
                          Search topic: {activeSearchTopicLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <details className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
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
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {SEARCH_TOPIC_OPTIONS.map((option) => {
                            const active = effectiveSearchTopic === option.id;
                            return (
                              <button
                                key={`ai-${option.id}`}
                                type="button"
                                onClick={() => handleSearchTopicChange(option.id)}
                                className={`rounded-full border px-3 py-1 transition ${
                                  active
                                    ? "border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] text-white"
                                    : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2">
                          <Search className="h-5 w-5 text-[color:var(--shell-muted)]" />
                          <input
                            className="w-full bg-transparent outline-none placeholder:text-[color:var(--shell-muted)] text-inherit"
                            placeholder={searchInputPlaceholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                          <span>Topic: {activeSearchTopicLabel}</span>
                          <span>News matches: {newsSearchScope.length}</span>
                          <span>Weather matches: {weatherSearchScope.length}</span>
                          <span>Market matches: {marketSearchScope.length}</span>
                        </div>
                        {!hasSearchQuery ? (
                          <p className="text-xs text-[color:var(--shell-muted)]">
                            Type a query to filter feeds by topic. Prefixes like
                            <code className="mx-1 rounded bg-[color:var(--shell-bg)] px-1 py-0.5">
                              topic:weather
                            </code>
                            are supported.
                          </p>
                        ) : aiSearchPreview.length === 0 ? (
                          <p className="text-xs text-[color:var(--shell-muted)]">
                            No matching signals for this topic and query.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {aiSearchPreview.map((result) => (
                              <li
                                key={result.key}
                                className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2"
                              >
                                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                                  <span>{result.kind}</span>
                                </div>
                                {result.href ? (
                                  <a
                                    href={result.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1 block text-sm font-semibold text-[color:var(--shell-ink)] hover:underline"
                                  >
                                    {result.title}
                                  </a>
                                ) : (
                                  <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                                    {result.title}
                                  </div>
                                )}
                                {result.subtitle && (
                                  <div className="text-xs text-[color:var(--shell-muted)]">
                                    {result.subtitle}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="text-[11px] text-[color:var(--shell-muted)]">
                          This card now builds structured search context so an AI
                          answer pipeline can be attached next.
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
            {activeView === "news" && (
              <div className="space-y-4">
                <section
                  className={`${cardBase} flex flex-wrap items-center gap-3 px-4 py-3`}
                >
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      News workspace
                    </div>
                    <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                      Region: {regionLabel} · Showing {newsPageItems.length} stories
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() =>
                        void loadNewsData(
                          newsLoadMode === "archive" ? "recent" : "archive",
                        )
                      }
                      disabled={isLoadingNews}
                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] disabled:opacity-60"
                    >
                      {isLoadingNews
                        ? "Loading…"
                        : newsLoadMode === "archive"
                          ? "Use recent"
                          : "Load all data"}
                    </button>
                    <button
                      onClick={() => setRegionFilter("global")}
                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                    >
                      Global
                    </button>
                  </div>
                  <div className="grid w-full gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-[color:var(--shell-muted)]">
                      Source
                      <select
                        value={newsSourceFilter}
                        onChange={(event) => setNewsSourceFilter(event.currentTarget.value)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All sources</option>
                        {newsSourceOptions.map((source) => (
                          <option key={source} value={source}>
                            {source}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Country
                      <input
                        value={newsCountryFilter}
                        onChange={(event) => setNewsCountryFilter(event.currentTarget.value)}
                        placeholder="e.g. US"
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      />
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Sort
                      <select
                        value={newsSortBy}
                        onChange={(event) => setNewsSortBy(event.currentTarget.value as "newest" | "oldest" | "source")}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="source">By source</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <label className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-[color:var(--shell-muted)]">
                        <input
                          type="checkbox"
                          checked={newsHasImageOnly}
                          onChange={(event) => setNewsHasImageOnly(event.currentTarget.checked)}
                        />
                        Images only
                      </label>
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        News map
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Country coverage
                      </div>
                    </div>
                    <div className="h-[min(56vh,520px)] min-h-[20rem] p-3">
                      <div className="h-full overflow-hidden rounded-2xl border border-[color:var(--shell-border)]">
                        <WorldMapBubbles
                          variant="default"
                          data={mapBubbleData}
                          onSelect={(iso) => {
                            setSelectedCountry(iso);
                            setActiveView("news");
                          }}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          scale={mapScale}
                        />
                      </div>
                    </div>
                  </div>

                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Headlines
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Filtered story stream
                      </div>
                    </div>
                    <div className="max-h-[56vh] min-h-[20rem] overflow-y-auto p-3 space-y-2">
                      {newsPageItems.length === 0 && (
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-sm text-[color:var(--shell-muted)]">
                          No stories match the current filters.
                        </div>
                      )}
                      {newsPageItems.map((item) => {
                        const img = imageProxy(getNewsImageUrl(item));
                        const sourceLabel = getSourceLabel(item);
                        const iso = item.country_iso2?.toUpperCase();
                        const selected = iso && selectedCountry?.toUpperCase() === iso;
                        const storyUrl = item.url ?? "#";
                        return (
                          <article
                            key={item.id}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                              selected
                                ? "border-emerald-200 bg-emerald-50/70"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:border-[color:var(--shell-ink)]"
                            }`}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                              <div className="relative h-20 w-28 overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-slate-100/50 flex-none">
                                {img && (
                                  <img
                                    src={img}
                                    alt={item.title ?? "news thumbnail"}
                                    loading="lazy"
                                    decoding="async"
                                    referrerPolicy="no-referrer"
                                    className="h-full w-full object-cover"
                                  />
                                )}
                              </div>
                              <div className="min-w-0">
                                <a
                                  href={storyUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-semibold text-[color:var(--shell-ink)] hover:underline"
                                >
                                  {item.title || item.url || "Untitled"}
                                </a>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                                  {sourceLabel && (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                      {sourceLabel}
                                    </span>
                                  )}
                                  {iso && (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedCountry(iso)}
                                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                                    >
                                      {iso}
                                    </button>
                                  )}
                                  {item.event_time && (
                                    <span>{new Date(item.event_time).toLocaleString()}</span>
                                  )}
                                </div>
                                {item.summary && (
                                  <p className="mt-2 line-clamp-2 text-xs text-[color:var(--shell-muted)]">
                                    {item.summary}
                                  </p>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      News analytics
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      Story volume by day
                    </div>
                    <div className="mt-3 h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={newsPageTimelineData}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Area
                            type="monotone"
                            dataKey="stories"
                            stroke={ANALYTICS_COLORS[0]}
                            fill={ANALYTICS_COLORS[0]}
                            fillOpacity={0.25}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Source mix
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      Top publishers in current scope
                    </div>
                    <div className="mt-3 h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={newsPageSourceData}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="source" tick={{ fontSize: 11 }} />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="stories" radius={[6, 6, 0, 0]}>
                            {newsPageSourceData.map((entry, index) => (
                              <Cell key={`news-source-${entry.source}`} fill={ANALYTICS_COLORS[index % ANALYTICS_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Index map
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Relative index volatility by country
                      </div>
                    </div>
                    <div className="h-[min(48vh,420px)] min-h-[18rem] p-3">
                      <div className="h-full overflow-hidden rounded-2xl border border-[color:var(--shell-border)]">
                        <WorldMapBubbles
                          data={marketIndexMapData}
                          onSelect={(iso) => setSelectedCountry(iso)}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          scale="linear"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <section className={`${cardBase} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Market status
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                            {marketStatusSummary.open}/{marketStatusSummary.total} tracked exchanges open
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void fetchMarketStatus({ refresh: true })
                              .then(setMarketStatusRows)
                              .catch(() => setMarketStatusRows([]))
                          }
                          className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                        >
                          Refresh
                        </button>
                      </div>
                      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                        {marketStatusDisplayRows.map((status) => (
                          <div
                            key={`mk-status-${status.exchange}`}
                            className="flex items-center justify-between rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-xs"
                          >
                            <span className="font-medium text-[color:var(--shell-ink)]">{status.exchange}</span>
                            <span
                              className={
                                status.is_open === true
                                  ? "text-emerald-600"
                                  : status.is_open === false
                                    ? "text-rose-600"
                                    : "text-[color:var(--shell-muted)]"
                              }
                            >
                              {status.is_open === true ? "Open" : status.is_open === false ? "Closed" : "Unknown"}
                            </span>
                          </div>
                        ))}
                        {marketStatusDisplayRows.length === 0 && (
                          <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-xs text-[color:var(--shell-muted)]">
                            No exchange status rows available.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className={`${cardBase} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Earnings calendar
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                            Upcoming events {selectedSymbol ? `for ${selectedSymbol}` : "(watch scope)"}
                          </div>
                        </div>
                        <div className="inline-flex rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-1 text-xs">
                          {[7, 14, 30].map((days) => (
                            <button
                              key={`earnings-window-${days}`}
                              type="button"
                              onClick={() => setMarketEarningsWindowDays(days as 7 | 14 | 30)}
                              className={`rounded-full px-2 py-0.5 ${
                                marketEarningsWindowDays === days
                                  ? "bg-[color:var(--shell-ink)] text-[color:var(--shell-bg)]"
                                  : "text-[color:var(--shell-muted)]"
                              }`}
                            >
                              {days}d
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                        {marketEarningsRows.slice(0, 24).map((event, idx) => (
                          <div
                            key={`mk-earnings-${event.symbol}-${event.date}-${idx}`}
                            className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-xs"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => setSelectedSymbol(event.symbol)}
                                className="font-semibold text-[color:var(--shell-ink)] hover:underline"
                              >
                                {event.symbol}
                              </button>
                              <span className="text-[color:var(--shell-muted)]">{event.date ?? "—"}</span>
                            </div>
                            <div className="mt-1 text-[color:var(--shell-muted)]">
                              EPS {event.eps_actual ?? "—"} / {event.eps_estimate ?? "—"} · Rev{" "}
                              {event.revenue_actual ?? "—"} / {event.revenue_estimate ?? "—"}
                            </div>
                          </div>
                        ))}
                        {marketEarningsRows.length === 0 && (
                          <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-xs text-[color:var(--shell-muted)]">
                            No earnings events in the selected window.
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </section>

                <section className={`${cardBase} p-4`}>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                    Correlation
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                    {relationCountry
                      ? `Cross-signal context for ${relationCountry}`
                      : "Select a country or symbol to relate signals"}
                  </div>
                  {relationCountry ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
                      <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs text-[color:var(--shell-muted)]">
                        <div className="text-[11px] uppercase tracking-[0.26em]">Weather</div>
                        <div className="mt-2 text-sm font-semibold text-[color:var(--shell-ink)]">
                          {relatedWeather?.temp_c ?? "—"}°C
                        </div>
                        <div>Humidity: {relatedWeather?.humidity ?? "—"}%</div>
                        <div>Condition: {relatedWeather?.weather_main ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs text-[color:var(--shell-muted)]">
                        <div className="text-[11px] uppercase tracking-[0.26em]">Markets</div>
                        {relatedMarkets.slice(0, 4).map((quote) => (
                          <button
                            key={`news-rel-${quote.symbol}`}
                            type="button"
                            onClick={() => {
                              setSelectedSymbol(quote.symbol);
                              setActiveView("markets");
                            }}
                            className="mt-2 flex w-full items-center justify-between rounded-lg border border-[color:var(--shell-border)] px-2 py-1 text-left text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                          >
                            <span>{quote.symbol}</span>
                            <span>
                              {quote.percent_change != null
                                ? `${quote.percent_change >= 0 ? "+" : ""}${quote.percent_change.toFixed(2)}%`
                                : "—"}
                            </span>
                          </button>
                        ))}
                        {relatedMarkets.length === 0 && <div className="mt-2">No symbols linked.</div>}
                      </div>
                      <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs text-[color:var(--shell-muted)]">
                        <div className="text-[11px] uppercase tracking-[0.26em]">News</div>
                        {relatedNews.slice(0, 3).map((item) => (
                          <a
                            key={`news-rel-item-${item.id}`}
                            href={item.url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 block rounded-lg border border-[color:var(--shell-border)] px-2 py-1 text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                          >
                            {item.title ?? item.url ?? "Untitled"}
                          </a>
                        ))}
                        {relatedNews.length === 0 && <div className="mt-2">No related stories.</div>}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[color:var(--shell-muted)]">
                      Pick a country on the map or choose a market symbol to unlock related weather/news context.
                    </p>
                  )}
                </section>
              </div>
            )}
            {activeView === "weather" && (
              <div className="space-y-4">
                <section className={`${cardBase} flex flex-wrap items-center gap-3 px-4 py-3`}>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Weather workspace
                    </div>
                    <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                      {weatherPageRows.length} observations in scope
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() => setMinTemp(undefined)}
                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)]"
                    >
                      Reset temp
                    </button>
                    <button
                      onClick={() => setRegionFilter("global")}
                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)]"
                    >
                      Global
                    </button>
                  </div>
                  <div className="grid w-full gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-[color:var(--shell-muted)]">
                      Condition
                      <select
                        value={weatherConditionFilter}
                        onChange={(event) => setWeatherConditionFilter(event.currentTarget.value)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All conditions</option>
                        {weatherConditionOptions.map((condition) => (
                          <option key={condition} value={condition}>
                            {condition}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Country
                      <input
                        value={weatherCountryFilter}
                        onChange={(event) => setWeatherCountryFilter(event.currentTarget.value)}
                        placeholder="e.g. US"
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      />
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Min humidity %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={weatherHumidityFloor ?? ""}
                        onChange={(event) =>
                          setWeatherHumidityFloor(
                            event.currentTarget.value === ""
                              ? undefined
                              : Number(event.currentTarget.value),
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      />
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Sort
                      <select
                        value={weatherSortBy}
                        onChange={(event) =>
                          setWeatherSortBy(
                            event.currentTarget.value as "latest" | "hottest" | "coldest" | "humidity",
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="latest">Latest first</option>
                        <option value="hottest">Hottest first</option>
                        <option value="coldest">Coldest first</option>
                        <option value="humidity">Most humid</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Weather map
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Temperature overlay by country
                      </div>
                    </div>
                    <div className="h-[min(56vh,520px)] min-h-[20rem] p-3">
                      <div className="h-full overflow-hidden rounded-2xl border border-[color:var(--shell-border)]">
                        <WorldMapBubbles
                          variant="default"
                          data={mapWeatherData}
                          onSelect={(iso) => setSelectedCountry(iso)}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          scale="linear"
                        />
                      </div>
                    </div>
                  </div>

                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Weather feed
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Live observations
                      </div>
                    </div>
                    <div className="max-h-[56vh] min-h-[20rem] overflow-y-auto p-3 space-y-2">
                      {weatherPageRows.map((entry, index) => {
                        const iso = entry.country?.toUpperCase();
                        const selected = iso && selectedCountry?.toUpperCase() === iso;
                        const weatherLink = weatherDrilldownUrl(iso);
                        const iconUrl = getWeatherIconUrl(entry);
                        const source = prettySourceName(entry.source_name ?? "openweather");
                        return (
                          <article
                            key={`${entry.country}-${entry.observed_at}-${index}`}
                            className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                              selected
                                ? "border-emerald-200 bg-emerald-50/70"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:border-[color:var(--shell-ink)]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => iso && setSelectedCountry(iso)}
                                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-1 text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                              >
                                {iconUrl ? (
                                  <img
                                    src={iconUrl}
                                    alt={entry.weather_main ?? "weather"}
                                    className="h-6 w-6"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <span>{weatherSymbol(entry.weather_main)}</span>
                                )}
                                <span>{iso ?? "—"}</span>
                              </button>
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                                {source}
                              </span>
                              {weatherLink && (
                                <a
                                  href={weatherLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-auto rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                                >
                                  Open detail
                                </a>
                              )}
                            </div>
                            <div className="mt-2 font-semibold text-[color:var(--shell-ink)]">
                              {entry.temp_c ?? "—"}°C · {entry.weather_main ?? "—"}
                            </div>
                            <div className="mt-1 text-[color:var(--shell-muted)]">
                              Humidity {entry.humidity ?? "—"}% · Wind {entry.wind_speed ?? "—"} m/s
                              {entry.weather_desc ? ` · ${entry.weather_desc}` : ""}
                            </div>
                            <div className="mt-1 text-[color:var(--shell-muted)]">
                              {new Date(entry.observed_at).toLocaleString()}
                            </div>
                          </article>
                        );
                      })}
                      {weatherPageRows.length === 0 && (
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-sm text-[color:var(--shell-muted)]">
                          No weather rows available.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
                  <div className={`${cardBase} min-w-0 p-4 xl:col-span-2`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Weather analytics
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      Temperature vs humidity
                    </div>
                    <div className="mt-3 h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="temp_c" name="Temp °C" />
                          <YAxis dataKey="humidity" name="Humidity %" />
                          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                          <Scatter data={weatherScatterData} fill={ANALYTICS_COLORS[1]} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Condition mix
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      Current weather states
                    </div>
                    <div className="mt-3 h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip />
                          <Legend />
                          <Pie
                            data={weatherConditionChartData}
                            dataKey="count"
                            nameKey="condition"
                            outerRadius={84}
                            innerRadius={42}
                          >
                            {weatherConditionChartData.map((entry, index) => (
                              <Cell key={`weather-condition-${entry.condition}`} fill={ANALYTICS_COLORS[index % ANALYTICS_COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                <section className={`${cardBase} p-4`}>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                    Temperature ranking
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                    Warmest countries in current filter set
                  </div>
                  <div className="mt-3 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weatherTempChartData}>
                        <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                        <XAxis dataKey="country" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="temp_c" fill={ANALYTICS_COLORS[0]} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className={`${cardBase} p-4`}>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                    Weather to market/news
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                    {relationCountry
                      ? `Linked market and news signals for ${relationCountry}`
                      : "Select a weather country to open linked market/news context"}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                        Related symbols
                      </div>
                      {relatedMarkets.slice(0, 6).map((quote) => (
                        <button
                          key={`wx-market-${quote.symbol}`}
                          type="button"
                          onClick={() => {
                            setSelectedSymbol(quote.symbol);
                            setActiveView("markets");
                          }}
                          className="mt-2 flex w-full items-center justify-between rounded-lg border border-[color:var(--shell-border)] px-2 py-1 text-xs text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                        >
                          <span>{quote.symbol}</span>
                          <span>
                            {quote.percent_change != null
                              ? `${quote.percent_change >= 0 ? "+" : ""}${quote.percent_change.toFixed(2)}%`
                              : "—"}
                          </span>
                        </button>
                      ))}
                      {relatedMarkets.length === 0 && (
                        <p className="mt-2 text-xs text-[color:var(--shell-muted)]">No symbols mapped for this country.</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                        Related stories
                      </div>
                      {relatedNews.slice(0, 4).map((item) => (
                        <a
                          key={`wx-news-${item.id}`}
                          href={item.url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 block rounded-lg border border-[color:var(--shell-border)] px-2 py-1 text-xs text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                        >
                          {item.title ?? item.url ?? "Untitled"}
                        </a>
                      ))}
                      {relatedNews.length === 0 && (
                        <p className="mt-2 text-xs text-[color:var(--shell-muted)]">No stories mapped for this country.</p>
                      )}
                    </div>
                  </div>
                </section>

              </div>
            )}
            {activeView === "markets" && (
              <div className="space-y-4">
                <section className={`${cardBase} flex flex-wrap items-center gap-3 px-4 py-3`}>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Market workspace
                    </div>
                    <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                      {marketPageRows.length} quotes in watch scope
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() => void fetchMarketQuotes({ refresh: true }).then(setMarketQuotes).catch(() => undefined)}
                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)]"
                    >
                      Refresh
                    </button>
                    {selectedSymbol && (
                      <button
                        onClick={() => setSelectedSymbol(null)}
                        className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)]"
                      >
                        Clear symbol
                      </button>
                    )}
                  </div>
                  <div className="grid w-full gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                    <label className="text-[color:var(--shell-muted)]">
                      Exchange
                      <select
                        value={marketExchangeFilter}
                        onChange={(event) => setMarketExchangeFilter(event.currentTarget.value)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All exchanges</option>
                        {marketExchangeOptions.map((exchange) => (
                          <option key={exchange} value={exchange}>
                            {exchange}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Country
                      <select
                        value={marketCountryFilter}
                        onChange={(event) => setMarketCountryFilter(event.currentTarget.value)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All countries</option>
                        {marketCountryOptions.map((country) => (
                          <option key={country} value={country}>
                            {country}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Index/market
                      <select
                        value={marketIndexFilter}
                        onChange={(event) => setMarketIndexFilter(event.currentTarget.value)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All markets</option>
                        {marketIndexOptions.map((market) => (
                          <option key={market.code} value={market.code}>
                            {market.code} · {market.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Direction
                      <select
                        value={marketDirectionFilter}
                        onChange={(event) =>
                          setMarketDirectionFilter(event.currentTarget.value as "all" | "gainers" | "losers")
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All</option>
                        <option value="gainers">Gainers</option>
                        <option value="losers">Losers</option>
                      </select>
                    </label>
                    <label className="text-[color:var(--shell-muted)]">
                      Min |% move|
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={marketMinAbsMove}
                        onChange={(event) => setMarketMinAbsMove(Number(event.currentTarget.value) || 0)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      />
                    </label>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Watchlist
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Select a symbol to relate with weather and news
                      </div>
                    </div>
                    <div className="max-h-[56vh] min-h-[20rem] overflow-y-auto p-3 space-y-2">
                      {marketPageRows.map((quote) => {
                        const selected = selectedSymbol?.toUpperCase() === quote.symbol.toUpperCase();
                        const isPositive = (quote.change ?? 0) > 0;
                        const isNegative = (quote.change ?? 0) < 0;
                        const logo = imageProxy(getMarketLogoUrl(quote));
                        const source = getMarketSourceLabel(quote);
                        const market = getMarketIdentity(quote);
                        const profile = getMarketProfile(quote);
                        return (
                          <button
                            key={`mk-${quote.symbol}-${quote.observed_at}`}
                            type="button"
                            onClick={() => {
                              setSelectedSymbol(quote.symbol);
                              if (quote.country) setSelectedCountry(quote.country.toUpperCase());
                            }}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                              selected
                                ? "border-emerald-200 bg-emerald-50/70"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:border-[color:var(--shell-ink)]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-10 w-10 overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)]">
                                  {logo ? (
                                    <img
                                      src={logo}
                                      alt={`${quote.symbol} logo`}
                                      loading="lazy"
                                      decoding="async"
                                      referrerPolicy="no-referrer"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="grid h-full w-full place-items-center text-xs font-semibold text-[color:var(--shell-muted)]">
                                      {quote.symbol.slice(0, 2)}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                                    {quote.symbol}
                                  </div>
                                  <div className="truncate text-xs text-[color:var(--shell-muted)]">
                                    {quote.company_name ?? "—"} · {quote.exchange ?? "—"} · {quote.country ?? "—"} · {market.code ?? "—"}
                                  </div>
                                  {(profile.industry || profile.ipo) && (
                                    <div className="truncate text-[10px] text-[color:var(--shell-muted)]">
                                      {profile.industry ?? "—"}{profile.ipo ? ` · IPO ${profile.ipo}` : ""}
                                    </div>
                                  )}
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                                      {source}
                                    </span>
                                    {market.name && (
                                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                                        {market.name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                                  {quote.price ?? "—"} {quote.currency ?? ""}
                                </div>
                                <div className={`text-xs ${isPositive ? "text-emerald-600" : isNegative ? "text-rose-600" : "text-[color:var(--shell-muted)]"}`}>
                                  {quote.percent_change != null
                                    ? `${quote.percent_change >= 0 ? "+" : ""}${quote.percent_change.toFixed(2)}%`
                                    : "—"}
                                </div>
                                <a
                                  href={marketQuoteUrl(quote.symbol)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="mt-1 inline-block rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[10px] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                                >
                                  Open quote
                                </a>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {marketPageRows.length === 0 && (
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-sm text-[color:var(--shell-muted)]">
                          No quotes match the current market filters.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Symbol correlation
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      {selectedSymbolQuote
                        ? `${selectedSymbolQuote.symbol} · ${selectedSymbolMarket?.code ?? selectedSymbolQuote.country ?? "No country"}`
                        : "Choose a symbol"}
                    </div>
                    {selectedSymbolQuote ? (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs">
                          <div className="font-semibold text-[color:var(--shell-ink)]">Primary market</div>
                          <div className="mt-1 text-[color:var(--shell-muted)]">
                            {(selectedSymbolMarket?.name ?? "Unknown market")} ({selectedSymbolMarket?.code ?? "—"}) ·{" "}
                            {selectedSymbolQuote.country ?? "—"}
                          </div>
                          <div className="mt-1 text-[color:var(--shell-muted)]">
                            Industry {selectedSymbolProfile?.industry ?? "—"} · Mkt cap {formatCompactNumber(selectedSymbolProfile?.marketCap)}
                          </div>
                          {selectedSymbolProfile?.webUrl && (
                            <a
                              href={selectedSymbolProfile.webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[10px] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                            >
                              Company profile
                            </a>
                          )}
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs">
                          <div className="font-semibold text-[color:var(--shell-ink)]">Weather in {relationCountry ?? "—"}</div>
                          <div className="mt-1 text-[color:var(--shell-muted)]">
                            Temp {relatedWeather?.temp_c ?? "—"}°C · Humidity {relatedWeather?.humidity ?? "—"}% · {relatedWeather?.weather_main ?? "—"}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs">
                          <div className="font-semibold text-[color:var(--shell-ink)]">Related stories</div>
                          {relatedNews.slice(0, 4).map((item) => (
                            <a
                              key={`mk-news-${item.id}`}
                              href={item.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 block rounded-lg border border-[color:var(--shell-border)] px-2 py-1 text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                            >
                              {item.title ?? item.url ?? "Untitled"}
                            </a>
                          ))}
                          {relatedNews.length === 0 && (
                            <div className="mt-2 text-[color:var(--shell-muted)]">No stories mapped to this country.</div>
                          )}
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs">
                          <div className="font-semibold text-[color:var(--shell-ink)]">Peer symbols in country</div>
                          {relatedMarkets
                            .filter((quote) => quote.symbol !== selectedSymbolQuote.symbol)
                            .slice(0, 5)
                            .map((quote) => (
                              <button
                                key={`mk-peer-${quote.symbol}`}
                                type="button"
                                onClick={() => setSelectedSymbol(quote.symbol)}
                                className="mt-2 flex w-full items-center justify-between rounded-lg border border-[color:var(--shell-border)] px-2 py-1 text-left text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                              >
                                <span>{quote.symbol}</span>
                                <span>
                                  {quote.percent_change != null
                                    ? `${quote.percent_change >= 0 ? "+" : ""}${quote.percent_change.toFixed(2)}%`
                                    : "—"}
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[color:var(--shell-muted)]">
                        Select a symbol from the watchlist to relate market movement with local weather and recent news.
                      </p>
                    )}
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Market analytics
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      Top movers (% change)
                    </div>
                    <div className="mt-3 h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={marketMoversChartData}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="symbol" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="percent_change" radius={[6, 6, 0, 0]}>
                            {marketMoversChartData.map((entry, index) => (
                              <Cell
                                key={`market-mover-${entry.symbol}`}
                                fill={entry.percent_change >= 0 ? ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] : "#be123c"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Index regime
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                      Average move by market benchmark
                    </div>
                    <div className="mt-3 h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={marketIndexPerfData}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="market_code" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="avg_change" radius={[6, 6, 0, 0]}>
                            {marketIndexPerfData.map((entry) => (
                              <Cell
                                key={`market-index-${entry.market_code}`}
                                fill={entry.avg_change >= 0 ? "#0f766e" : "#be123c"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                <section className={`${cardBase} p-4`}>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                    Country market map
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                    Country to benchmark linkage and pressure points
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-[color:var(--shell-muted)]">
                          <th className="px-2 py-2 font-medium">Country</th>
                          <th className="px-2 py-2 font-medium">Primary market</th>
                          <th className="px-2 py-2 font-medium">Symbols</th>
                          <th className="px-2 py-2 font-medium">Avg % move</th>
                          <th className="px-2 py-2 font-medium">Top mover</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marketCountryMarketRows.map((row) => (
                          <tr
                            key={`market-country-row-${row.country}`}
                            className="border-t border-[color:var(--shell-border)] text-[color:var(--shell-ink)]"
                          >
                            <td className="px-2 py-2">{row.country}</td>
                            <td className="px-2 py-2">
                              <span className="font-semibold">{row.market_code}</span>
                              <span className="ml-2 text-[color:var(--shell-muted)]">{row.market_name}</span>
                            </td>
                            <td className="px-2 py-2 text-[color:var(--shell-muted)]">{row.count}</td>
                            <td
                              className={`px-2 py-2 ${
                                row.avg_change > 0
                                  ? "text-emerald-600"
                                  : row.avg_change < 0
                                    ? "text-rose-600"
                                    : "text-[color:var(--shell-muted)]"
                              }`}
                            >
                              {row.avg_change >= 0 ? "+" : ""}
                              {row.avg_change.toFixed(2)}%
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => setSelectedSymbol(row.top_symbol)}
                                className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                              >
                                {row.top_symbol}
                                <span className="ml-2 text-[color:var(--shell-muted)]">
                                  {row.top_move >= 0 ? "+" : ""}
                                  {row.top_move.toFixed(2)}%
                                </span>
                              </button>
                            </td>
                          </tr>
                        ))}
                        {marketCountryMarketRows.length === 0 && (
                          <tr className="border-t border-[color:var(--shell-border)]">
                            <td className="px-2 py-3 text-[color:var(--shell-muted)]" colSpan={5}>
                              No market-country mapping rows in the current filter scope.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}
            {activeView === "admin" && isAdmin && (
              <div className="min-w-0 space-y-4">
                <AdminIngestionPanel dark={dark} />
                <AdminUserManagementPanel />
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
                      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm text-[color:var(--shell-ink)] hover:border-slate-400"
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
                          <div className="absolute -top-16 right-0 h-40 w-40 rounded-full bg-[color:var(--shell-surface)]/10 blur-2xl" />
                          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-4">
                              <div className="h-16 w-16 overflow-hidden rounded-2xl bg-[color:var(--shell-surface)]/15 text-2xl font-semibold uppercase text-white ring-1 ring-white/25">
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
                            <div className="rounded-2xl border border-white/20 bg-[color:var(--shell-surface)]/10 px-4 py-3 text-sm">
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
                                className="rounded-full border border-white/20 bg-[color:var(--shell-surface)]/10 px-3 py-1 uppercase tracking-[0.2em]"
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
                              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs text-[color:var(--shell-ink)]"
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
                            className="inline-flex w-fit items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)]"
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
                      className="scroll-mt-24 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-6 shadow-sm"
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

                <details className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[color:var(--shell-ink)]">
                    Brand colour guideline reference
                  </summary>
                  <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)]">
                    <WebsiteColourPalettePreview />
                  </div>
                </details>

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
