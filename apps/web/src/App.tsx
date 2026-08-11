import {
  useCallback,
  useEffect,
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
  ChevronDown,
  Menu,
  LayoutGrid,
  FileText,
  Maximize2,
  X,
  ArrowUpRight,
  CheckCheck,
  Podcast,
  RefreshCw,
  Route,
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
import PriorityNewsList from "./components/PriorityNewsList";

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
      "By using FRED-powered market data in Claritas, you also agree to the FRED API Terms of Use linked beside those observations.",
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
type SearchTopic = "all" | "news" | "podcasts" | "weather" | "markets";
type MapMode = "signals" | "news" | "weather";
type AppView =
  | "dashboard"
  | "news"
  | "podcasts"
  | "weather"
  | "markets"
  | "transport"
  | "intelligence"
  | "earth-observation"
  | "admin"
  | "profile"
  | "legal";
const OVERVIEW_DRILLDOWN_VIEWS = new Set<AppView>([
  "news",
  "podcasts",
  "weather",
  "markets",
  "transport",
  "intelligence",
  "earth-observation",
]);
type SignalNotification = {
  id: string;
  title: string;
  description: string;
  timeLabel: string;
  tone: "critical" | "attention" | "info";
  view: AppView;
  symbol?: string;
  dateKey?: string;
  country?: string;
  eventId?: string;
};

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
  { id: "podcasts", label: "Podcasts" },
  { id: "weather", label: "Weather" },
  { id: "markets", label: "Markets" },
];

const SEARCH_TOPIC_ALIASES: Record<string, SearchTopic> = {
  all: "all",
  news: "news",
  podcast: "podcasts",
  podcasts: "podcasts",
  audio: "podcasts",
  weather: "weather",
  market: "markets",
  markets: "markets",
  finance: "markets",
  financial: "markets",
  ai: "news",
  alerts: "news",
  wx: "weather",
};

const COUNTRY_LINK_ALIASES: Record<string, string[]> = {
  AE: ["uae", "united arab emirates"],
  CN: ["china", "prc"],
  GB: ["united kingdom", "britain", "great britain", "uk"],
  KR: ["south korea", "republic of korea"],
  KP: ["north korea", "dprk"],
  RU: ["russia", "russian federation"],
  US: ["united states", "united states of america", "usa"],
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

const normalizeLinkageText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return ` ${value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
};

const includesLinkageTerm = (haystack: string, value: string): boolean => {
  const normalized = normalizeLinkageText(value).trim();
  return normalized.length >= 3 && haystack.includes(` ${normalized} `);
};

const getLeadershipDisplayName = (value: string | null | undefined): string =>
  value && !/^Q\d+$/i.test(value.trim()) ? value.trim() : "Name unavailable";

const prettySourceName = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "gdelt") return "GDELT";
  if (normalized === "institutional_rss") return "Institutional RSS";
  if (normalized === "openweather") return "OpenWeather";
  if (normalized === "nws") return "NOAA/NWS";
  if (normalized === "sec_edgar") return "SEC EDGAR";
  if (normalized === "ecb") return "ECB";
  if (normalized === "oecd") return "OECD";
  if (normalized === "fred") return "FRED";
  if (normalized === "world_bank_wdi") return "World Bank WDI";
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
  const explicitPublisher = asTrimmedString(item.publisher);
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
  if (sourceName?.toLowerCase() === "gdelt" && source) {
    return `${source.replace(/^www\./i, "")} · via GDELT`;
  }
  if (sourceName?.toLowerCase() === "gdelt" && explicitPublisher) {
    return `${explicitPublisher.replace(/^www\./i, "")} · via GDELT`;
  }
  if (sourceName) return prettySourceName(sourceName);
  return source ? prettySourceName(source) : undefined;
};

const NEWS_SYMBOL_COUNTRY_HINTS: Record<string, string> = {
  AAPL: "US",
  ABBV: "US",
  ABNB: "US",
  AMD: "US",
  AMZN: "US",
  AVGO: "US",
  BAC: "US",
  "BRK.B": "US",
  CRM: "US",
  CSCO: "US",
  DIS: "US",
  DIA: "US",
  EWA: "AU",
  EWC: "CA",
  EWG: "DE",
  EWJ: "JP",
  EWQ: "FR",
  EWU: "GB",
  EWW: "MX",
  EWZ: "BR",
  EZA: "ZA",
  GOOG: "US",
  GOOGL: "US",
  IBM: "US",
  INDA: "IN",
  INTC: "US",
  IWM: "US",
  JNJ: "US",
  JPM: "US",
  KO: "US",
  MA: "US",
  MCHI: "CN",
  META: "US",
  MSFT: "US",
  NFLX: "US",
  NDX: "US",
  NVDA: "US",
  ORCL: "US",
  PEP: "US",
  PFE: "US",
  PLTR: "US",
  QQQ: "US",
  SLB: "US",
  SPX: "US",
  SPY: "US",
  TSLA: "US",
  UBER: "US",
  V: "US",
  WMT: "US",
  XOM: "US",
};

const normalizeIso2 = (value: unknown): string | undefined => {
  const text = asTrimmedString(value)?.toUpperCase();
  if (!text) return undefined;
  if (text === "UK") return "GB";
  return /^[A-Z]{2}$/.test(text) ? text : undefined;
};

const parseNewsRelatedSymbols = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value.join(" ") : asTrimmedString(value);
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((part) => part.trim().toUpperCase().split(":").pop() ?? "")
        .filter((part) => /^[A-Z0-9][A-Z0-9._-]{0,23}$/.test(part)),
    ),
  );
};

const getNewsSignalCountries = (item: NewsItem): string[] => {
  const directCountry = normalizeIso2(item.country_iso2);
  if (directCountry) return [directCountry];

  const payload = asObject(item.payload);
  const raw = asObject(payload?.["raw"]);
  const inference = asObject(payload?.["country_inference"]);
  const inferredCountry =
    normalizeIso2(inference?.["iso2"]) ??
    normalizeIso2(inference?.["related_country_hint"]);
  if (inferredCountry) return [inferredCountry];

  const symbols = [
    ...parseNewsRelatedSymbols(payload?.["related"]),
    ...parseNewsRelatedSymbols(raw?.["related"]),
  ];
  const countries = new Set<string>();
  symbols.forEach((symbol) => {
    const country = NEWS_SYMBOL_COUNTRY_HINTS[symbol];
    if (country) countries.add(country);
  });
  return Array.from(countries);
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
  "var(--viz-news)",
  "var(--viz-weather)",
  "var(--viz-amber)",
  "var(--viz-violet)",
  "var(--viz-rose)",
  "var(--shell-muted)",
  "var(--viz-market)",
  "var(--viz-positive)",
];

const formatMetricNumber = (
  value?: number | null,
  options?: Intl.NumberFormatOptions,
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
};

const formatSignedMetric = (
  value?: number | null,
  digits = 2,
  suffix = "",
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toFixed(digits);
  return `${value >= 0 ? "+" : "-"}${abs}${suffix}`;
};

const formatExactTimestamp = (
  value: string | number | Date | null | undefined,
): string => {
  if (value == null || value === "") return "Timestamp unavailable";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

const friendlyWorkspaceError = (value: string | null | undefined): string => {
  if (!value) return "";
  if (/\b(?:502|503|504)\b|<!doctype|<html|server error/i.test(value)) {
    return "The live event service is temporarily unavailable. The map remains usable; retry shortly.";
  }
  return value.length > 180 ? `${value.slice(0, 177)}…` : value;
};

const getBrowserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const isValidScheduleTime = (value: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const DAILY_BRIEFING_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

const DAILY_BRIEFING_TIMEZONE_OPTIONS = [
  "UTC",
  "Africa/Tunis",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const getScheduleTimeOptions = (selectedTime?: string): string[] => {
  const selected = selectedTime?.trim();
  if (!selected || !isValidScheduleTime(selected)) return DAILY_BRIEFING_TIME_OPTIONS;
  return Array.from(new Set([...DAILY_BRIEFING_TIME_OPTIONS, selected])).sort();
};

const getScheduleTimezoneOptions = (selectedTimezone?: string): string[] => {
  const options = new Set<string>();
  const addTimezone = (timezone?: string) => {
    const trimmed = timezone?.trim();
    if (!trimmed) return;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
      options.add(trimmed);
    } catch {
      // Ignore invalid persisted values; the API will still validate before saving.
    }
  };
  addTimezone(selectedTimezone);
  addTimezone(getBrowserTimeZone());
  DAILY_BRIEFING_TIMEZONE_OPTIONS.forEach(addTimezone);
  return Array.from(options);
};

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
  const sourceName = asTrimmedString(quote.source_name);
  if (sourceName) return prettySourceName(sourceName);
  const payload = asObject(quote.payload);
  const provider = asTrimmedString(payload?.["provider"]);
  if (provider) return prettySourceName(provider);
  return "Market data";
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

const marketQuoteUrl = (quote: MarketQuote): string | null => {
  if (quote.source_url) return quote.source_url;
  const payload = asObject(quote.payload);
  const instrument = asObject(payload?.["instrument"]);
  return asTrimmedString(instrument?.["data_url"] ?? instrument?.["quote_url"]) ?? null;
};

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
import WebsiteColourPalettePreview from "./components/WebsiteColourPalettePreview";
import TransportWorkspace from "./components/TransportWorkspace";
import IntelligenceWorkspace from "./components/IntelligenceWorkspace";
import EarthObservationWorkspace from "./components/EarthObservationWorkspace";
import IntelligenceEventStrip from "./components/IntelligenceEventStrip";
import AdminWorkspace from "./components/AdminWorkspace";
import SatelliteContextPanel from "./components/SatelliteContextPanel";
import { eventCoordinateContext } from "./components/eventPresentation";
import {
  fetchAuthMe,
  fetchAuthProviders,
  fetchCountryLeadership,
  fetchCountryStats,
  fetchCountryWeather,
  fetchCountryWeatherForecast,
  fetchDailyBriefingSchedule,
  fetchDailyBriefingEmailStatus,
  fetchDailyBriefingPreferenceOptions,
  fetchDailySignalBriefingLatest,
  fetchCountryMarketOverview,
  fetchCountryMarketDetail,
  fetchFxRates,
  fetchIntelligenceAlerts,
  fetchIntelligenceEvents,
  fetchMarketFilings,
  fetchMarketIndicators,
  fetchMarketQuotes,
  fetchNews,
  ensureNewsTranslationSummary,
  fetchPodcasts,
  fetchPolicyRates,
  fetchPersonalBriefingJob,
  fetchTransportOverview,
  getAuthStartUrl,
  logoutAuth,
  imageProxy,
  isNewsTranslationRequired,
  newsDisplayTitle,
  requestEmailVerification,
  sendPersonalBriefingPreview,
  updateDailyBriefingSchedule,
  type AuthProvider,
  type AuthProviderId,
  type AuthUser,
  type CountryLeadership,
  type CountryMarketOverview,
  type CountryMarketOverviewResponse,
  type CountryMarketDetail,
  type CountryStat,
  type CountryStatsCoverage,
  type CountryWeather,
  type CountryWeatherForecastDetail,
  type DailyBriefingSchedule,
  type DailyBriefingEmailStatus,
  type DailyBriefingPreferenceOptions,
  type DailySignalBriefing,
  type FxRate,
  type MarketFiling,
  type MarketIndicator,
  type MarketQuote,
  type NewsItem,
  type IntelligenceAlert,
  type IntelligenceEvent,
  type PodcastEpisode,
  type PodcastExternalLink,
  type PodcastSignal,
  type PolicyRate,
  type TransportOverview,
} from "./lib/api";

function getPodcastExternalLinks(episode: PodcastEpisode): PodcastExternalLink[] {
  if (!Array.isArray(episode.external_links)) return [];
  return episode.external_links.filter(
    (link): link is PodcastExternalLink =>
      Boolean(link && typeof link.url === "string" && typeof link.label === "string"),
  );
}

function formatPodcastDuration(seconds: number | null | undefined): string | null {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return null;
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(minutes, 1)}m`;
}

function formatEvidenceTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ClaritasDashboard() {
  const [query, setQuery] = useState("");
  const [searchTopic, setSearchTopic] = useState<SearchTopic>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(
    () => {
      try {
        const value = localStorage.getItem("read-signal-notifications");
        return value ? (JSON.parse(value) as string[]) : [];
      } catch {
        return [];
      }
    },
  );
  const [intelligenceAlerts, setIntelligenceAlerts] = useState<IntelligenceAlert[]>([]);
  const [overviewEvents, setOverviewEvents] = useState<IntelligenceEvent[]>([]);
  const [overviewEventsError, setOverviewEventsError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<
    "checking" | "authed" | "unauthed"
  >("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("dashboard");
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
      return true;
    } catch {
      return true;
    }
  });
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedIntelligenceEventId, setSelectedIntelligenceEventId] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get("event");
    } catch {
      return null;
    }
  });
  const [comparisonCountry, setComparisonCountry] = useState<string | null>(
    null,
  );
  const [compareMode, setCompareMode] = useState(false);
  const [pinnedCountry, setPinnedCountry] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] =
    useState<(typeof REGION_OPTIONS)[number]["id"]>("global");
  const [countryStats, setCountryStats] = useState<CountryStat[]>([]);
  const [countryStatsCoverage, setCountryStatsCoverage] = useState<CountryStatsCoverage | null>(null);
  const [weatherStats, setWeatherStats] = useState<CountryWeather[]>([]);
  const [weatherForecastDetail, setWeatherForecastDetail] = useState<CountryWeatherForecastDetail | null>(null);
  const [weatherForecastLoading, setWeatherForecastLoading] = useState(false);
  const [leadershipStats, setLeadershipStats] = useState<CountryLeadership[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<MarketQuote[]>([]);
  const [countryMarkets, setCountryMarkets] = useState<CountryMarketOverview[]>([]);
  const [countryMarketDetail, setCountryMarketDetail] = useState<CountryMarketDetail | null>(null);
  const [countryMarketMethodology, setCountryMarketMethodology] = useState<CountryMarketOverviewResponse["methodology"] | null>(null);
  const [marketMapLayer, setMarketMapLayer] = useState<"composite" | "index" | "fx" | "growth" | "filings">("composite");
  const [marketFilings, setMarketFilings] = useState<MarketFiling[]>([]);
  const [marketIndicators, setMarketIndicators] = useState<MarketIndicator[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [policyRates, setPolicyRates] = useState<PolicyRate[]>([]);
  const [transportOverview, setTransportOverview] = useState<TransportOverview | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [selectedDashboardNewsId, setSelectedDashboardNewsId] = useState<
    number | null
  >(null);
  const [podcasts, setPodcasts] = useState<PodcastEpisode[]>([]);
  const [isLoadingPodcasts, setIsLoadingPodcasts] = useState(false);
  const [podcastLoadError, setPodcastLoadError] = useState<string | null>(null);
  const [podcastQuery, setPodcastQuery] = useState("");
  const [podcastSignalFilter, setPodcastSignalFilter] = useState<PodcastSignal["type"] | "all">("all");
  const [newsLoadMode, setNewsLoadMode] = useState<"recent" | "archive">(
    "recent",
  );
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [newsLoadError, setNewsLoadError] = useState<string | null>(null);
  const [newsTranslationPendingIds, setNewsTranslationPendingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [dailyBriefing, setDailyBriefing] = useState<DailySignalBriefing | null>(null);
  const [dailyBriefingError, setDailyBriefingError] = useState<string | null>(null);
  const [dataWindowPreset, setDataWindowPreset] =
    useState<DataWindowPreset>("30d");
  const [mapMode, setMapMode] = useState<MapMode>("signals");
  const [listMode, setListMode] = useState<"news" | "weather" | "market">("news");
  const [mapWindowDays, setMapWindowDays] = useState(NEWS_TREND_WINDOW_DAYS);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [chartView, setChartView] = useState<"daily" | "rolling">("daily");
  const [chartRange, setChartRange] = useState<{
    startIndex?: number;
    endIndex?: number;
  }>({});
  const [minTemp, setMinTemp] = useState<number | undefined>(undefined);
  const [newsSourceFilter, setNewsSourceFilter] = useState<string>("all");
  const [newsCountryFilter, setNewsCountryFilter] = useState("");
  const [newsLanguageFilter, setNewsLanguageFilter] = useState("all");
  const [newsHasImageOnly, setNewsHasImageOnly] = useState(false);
  const [newsSortBy, setNewsSortBy] = useState<"newest" | "oldest" | "source">("newest");
  const [weatherConditionFilter, setWeatherConditionFilter] = useState<string>("all");
  const [weatherCountryFilter, setWeatherCountryFilter] = useState("");
  const [weatherHumidityFloor, setWeatherHumidityFloor] = useState<number | undefined>(undefined);
  const [weatherSortBy, setWeatherSortBy] = useState<"latest" | "hottest" | "coldest" | "humidity">(
    "latest",
  );
  const [profileSection, setProfileSection] = useState<
    "overview" | "identity" | "preferences" | "security" | "policies"
  >("overview");
  const [dailyBriefingSchedule, setDailyBriefingSchedule] = useState<DailyBriefingSchedule | null>(null);
  const [dailyBriefingScheduleDraft, setDailyBriefingScheduleDraft] = useState<{
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
  }>({
    enabled: true,
    email_enabled: false,
    email_theme: "dark",
    scheduled_time: "07:00",
    timezone: getBrowserTimeZone(),
    industries: [],
    company_symbols: [],
    country_iso2s: [],
    regions: [],
    max_items: 10,
  });
  const [dailyBriefingPreferenceOptions, setDailyBriefingPreferenceOptions] =
    useState<DailyBriefingPreferenceOptions | null>(null);
  const [dailyBriefingEmailStatus, setDailyBriefingEmailStatus] =
    useState<DailyBriefingEmailStatus | null>(null);
  const [isLoadingDailyBriefingSchedule, setIsLoadingDailyBriefingSchedule] = useState(false);
  const [isSavingDailyBriefingSchedule, setIsSavingDailyBriefingSchedule] = useState(false);
  const [isSendingDailyBriefingPreview, setIsSendingDailyBriefingPreview] = useState(false);
  const [dailyBriefingScheduleError, setDailyBriefingScheduleError] = useState<string | null>(null);
  const [dailyBriefingScheduleNotice, setDailyBriefingScheduleNotice] = useState<string | null>(null);
  const profileSections = PROFILE_SECTIONS;
  const feedRef = useRef<HTMLDivElement | null>(null);
  const dashboardFeedPanelRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const newsRequestIdRef = useRef(0);
  const podcastRequestIdRef = useRef(0);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  const authProviderMap = useMemo(
    () => new Map(authProviders.map((p) => [p.id, p])),
    [authProviders],
  );
  const dailyBriefingTimeOptions = useMemo(
    () => getScheduleTimeOptions(dailyBriefingScheduleDraft.scheduled_time),
    [dailyBriefingScheduleDraft.scheduled_time],
  );
  const dailyBriefingTimezoneOptions = useMemo(
    () => getScheduleTimezoneOptions(dailyBriefingScheduleDraft.timezone),
    [dailyBriefingScheduleDraft.timezone],
  );
  const dailyBriefingEmailSubscriptionLabel =
    isLoadingDailyBriefingSchedule || !dailyBriefingSchedule
      ? "Checking subscription…"
      : dailyBriefingScheduleDraft.email_enabled !== dailyBriefingSchedule.email_enabled
        ? dailyBriefingScheduleDraft.email_enabled
          ? "Save to subscribe"
          : "Save to unsubscribe"
        : dailyBriefingSchedule.email_enabled
          ? "Subscribed"
          : "Not subscribed";

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
    try {
      localStorage.setItem(
        "read-signal-notifications",
        JSON.stringify(readNotificationIds),
      );
    } catch {
      // Ignore storage write errors.
    }
  }, [readNotificationIds]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setNotificationsOpen(false);
        setSearchOpen(true);
        return;
      }
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setNotificationsOpen(false);
        setSearchOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  useEffect(() => {
    const applyEventDeepLink = () => {
      const eventId = new URLSearchParams(window.location.search).get("event");
      setSelectedIntelligenceEventId(eventId);
      if (eventId) setActiveView("intelligence");
    };
    applyEventDeepLink();
    window.addEventListener("popstate", applyEventDeepLink);
    return () => window.removeEventListener("popstate", applyEventDeepLink);
  }, []);

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
    if (authStatus !== "authed" || !hasPaidAccess) {
      setIntelligenceAlerts([]);
      return;
    }
    let active = true;
    const refresh = () => {
      void fetchIntelligenceAlerts()
        .then((alerts) => { if (active) setIntelligenceAlerts(alerts); })
        .catch(() => { /* Signal Desk keeps its own visible error state. */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [authStatus, hasPaidAccess]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess) {
      setOverviewEvents([]);
      setOverviewEventsError(null);
      return;
    }
    let active = true;
    const refresh = () => {
      void fetchIntelligenceEvents({ limit: 120 })
        .then((events) => {
          if (!active) return;
          setOverviewEvents(events);
          setOverviewEventsError(null);
        })
        .catch((error) => {
          if (!active) return;
          setOverviewEventsError(error instanceof Error ? error.message : String(error));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [authStatus, hasPaidAccess]);

  const overviewEventPoints = useMemo(() => {
    const severityRank: Record<IntelligenceEvent["severity"], number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    return overviewEvents
      // Country reference points support choropleth context but are not event
      // locations. Dots require defensible source or mapped event geography.
      .filter((event) => Boolean(eventCoordinateContext(event)))
      .sort((left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        Number(right.relevance_score) - Number(left.relevance_score),
      )
      .map((event) => {
        const normalizedType = event.event_type.toLowerCase();
        const label = normalizedType.includes("earthquake")
          ? "QUAKE"
          : normalizedType.includes("fire")
            ? "FIRE"
            : normalizedType.includes("transport") || normalizedType.includes("maritime")
              ? "MOVE"
              : normalizedType.includes("weather")
                ? "WX"
                : normalizedType.includes("market")
                  ? "MKT"
                  : "EVENT";
        return {
          id: event.id,
          latitude: Number(event.latitude),
          longitude: Number(event.longitude),
          title: event.title,
          subtitle: `${event.location_name || event.primary_country_iso2 || "Estimated event location"} · updated ${formatExactTimestamp(event.last_activity_time)} · ${event.domain_count} domain${event.domain_count === 1 ? "" : "s"}`,
          label,
          severity: event.severity,
          hasImagery: event.earth_observation_available,
          selected: event.id === selectedIntelligenceEventId,
        };
      });
  }, [overviewEvents, selectedIntelligenceEventId]);

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

  const requestNewsTranslationSummary = useCallback(async (item: NewsItem) => {
    if (
      !isNewsTranslationRequired(item) ||
      item.translation?.summary_status === "generated" ||
      item.translation?.summary_status === "insufficient"
    ) {
      return;
    }
    setNewsTranslationPendingIds((current) => new Set(current).add(item.id));
    try {
      const translation = await ensureNewsTranslationSummary(item.id);
      setNews((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                translated_title:
                  translation.translated_title ?? entry.translated_title ?? null,
                ai_summary: translation.generated_summary ?? null,
                translation: {
                  ...translation,
                  headline_kind: "ai_translation",
                  summary_kind:
                    translation.summary_status === "generated" ? "ai_generated" : null,
                },
              }
            : entry,
        ),
      );
    } catch {
      // The original source remains usable when optional AI enrichment is unavailable.
    } finally {
      setNewsTranslationPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }, []);

  const loadPodcastData = useCallback(async (q = "", signalType: PodcastSignal["type"] | "all" = "all") => {
    const requestId = podcastRequestIdRef.current + 1;
    podcastRequestIdRef.current = requestId;
    setIsLoadingPodcasts(true);
    setPodcastLoadError(null);
    try {
      const items = await fetchPodcasts({ limit: 80, q: q.trim() || undefined, signalType });
      if (podcastRequestIdRef.current !== requestId) return;
      setPodcasts(items);
    } catch (err) {
      if (podcastRequestIdRef.current !== requestId) return;
      setPodcasts([]);
      setPodcastLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (podcastRequestIdRef.current === requestId) {
        setIsLoadingPodcasts(false);
      }
    }
  }, []);

  useEffect(() => {
    // Load initial data
    if (authStatus !== "authed" || !hasPaidAccess) return;
    fetchCountryWeather()
      .then(setWeatherStats)
      .catch(() => setWeatherStats([]));
    fetchCountryLeadership()
      .then(setLeadershipStats)
      .catch(() => setLeadershipStats([]));
    fetchCountryMarketOverview()
      .then((overview) => {
        setCountryMarkets(overview.countries);
        setCountryMarketMethodology(overview.methodology);
      })
      .catch(() => {
        setCountryMarkets([]);
        setCountryMarketMethodology(null);
      });
    fetchMarketFilings({ limit: 80 }).then(setMarketFilings).catch(() => setMarketFilings([]));
    fetchMarketIndicators({ category: "company_fact", limit: 200 }).then(setMarketIndicators).catch(() => setMarketIndicators([]));
    fetchMarketQuotes().then((rows) => {
      setMarketQuotes(rows);
      setSelectedSymbol((current) => current && rows.some((row) => row.symbol === current) ? current : rows[0]?.symbol ?? null);
    }).catch(() => setMarketQuotes([]));
    fetchFxRates().then(setFxRates).catch(() => setFxRates([]));
    fetchPolicyRates().then(setPolicyRates).catch(() => setPolicyRates([]));
    fetchDailySignalBriefingLatest()
      .then((briefing) => {
        setDailyBriefing(briefing);
        setDailyBriefingError(null);
      })
      .catch((err) => {
        setDailyBriefing(null);
        setDailyBriefingError(err instanceof Error ? err.message : String(err));
      });
    void loadNewsData("recent");
    void loadPodcastData();
  }, [authStatus, hasPaidAccess, loadNewsData, loadPodcastData]);

  useEffect(() => {
    if (authStatus !== "authed") return;
    let cancelled = false;
    setIsLoadingDailyBriefingSchedule(true);
    setDailyBriefingScheduleError(null);
    fetchDailyBriefingSchedule()
      .then((schedule) => {
        if (cancelled) return;
        setDailyBriefingSchedule(schedule);
        setDailyBriefingScheduleDraft({
          enabled: schedule.enabled,
          email_enabled: schedule.email_enabled,
          email_theme: schedule.email_theme || "dark",
          scheduled_time: schedule.scheduled_time,
          timezone: schedule.timezone || getBrowserTimeZone(),
          industries: schedule.industries || [],
          company_symbols: schedule.company_symbols || [],
          country_iso2s: schedule.country_iso2s || [],
          regions: schedule.regions || [],
          max_items: schedule.max_items || 10,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setDailyBriefingScheduleError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDailyBriefingSchedule(false);
      });
    fetchDailyBriefingPreferenceOptions()
      .then((options) => {
        if (!cancelled) setDailyBriefingPreferenceOptions(options);
      })
      .catch((err) => {
        if (!cancelled) {
          setDailyBriefingScheduleError(err instanceof Error ? err.message : String(err));
        }
      });
    fetchDailyBriefingEmailStatus()
      .then((status) => {
        if (!cancelled) setDailyBriefingEmailStatus(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setDailyBriefingScheduleError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess) return;
    let cancelled = false;
    fetchCountryStats({ days: mapWindowDays })
      .then((result) => {
        if (!cancelled) {
          setCountryStats(result.stats);
          setCountryStatsCoverage(result.coverage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCountryStats([]);
          setCountryStatsCoverage(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, hasPaidAccess, mapWindowDays]);

  const cardBase = "app-card operational-panel rounded-xl";
  const chartGridColor = "var(--viz-grid)";

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  const dailyBriefingDateLabel = useMemo(() => {
    if (!dailyBriefing?.briefing_date) return todayLabel;
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${dailyBriefing.briefing_date}T00:00:00Z`));
  }, [dailyBriefing?.briefing_date, todayLabel]);

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
  const searchAppliesToPodcasts =
    effectiveSearchTopic === "all" || effectiveSearchTopic === "podcasts";
  const searchAppliesToWeather =
    effectiveSearchTopic === "all" || effectiveSearchTopic === "weather";
  const searchAppliesToMarkets =
    effectiveSearchTopic === "all" || effectiveSearchTopic === "markets";
  const searchInputPlaceholder =
    effectiveSearchTopic === "weather"
      ? "Search weather topics (e.g. storm, humidity, US)"
      : effectiveSearchTopic === "news"
        ? "Search news topics (e.g. market, regulation, AI)"
        : effectiveSearchTopic === "podcasts"
          ? "Search podcast evidence, entities, claims, events, or risks"
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
        item.translated_title ?? "",
        item.ai_summary ?? "",
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

  const matchesPodcastSearch = useCallback(
    (episode: PodcastEpisode) => {
      if (searchTerms.length === 0) return true;
      const haystack = [
        episode.title,
        episode.summary ?? "",
        episode.feed_title,
        episode.feed_author ?? "",
        ...episode.signals.flatMap((signal) => [signal.type, signal.title, signal.summary ?? "", ...signal.entities, ...signal.topics]),
        ...episode.evidence.map((evidence) => `${evidence.speaker ?? ""} ${evidence.text}`),
      ].join(" ").toLowerCase();
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

  const podcastSearchScope = useMemo(() => {
    if (!searchAppliesToPodcasts || searchTerms.length === 0) return podcasts;
    return podcasts.filter(matchesPodcastSearch);
  }, [matchesPodcastSearch, podcasts, searchAppliesToPodcasts, searchTerms.length]);

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

  const newsTrendPrimaryScope = useMemo(() => {
    if (!selectedCountry) return newsSearchScope;
    const selectedIso = selectedCountry.toUpperCase();
    return newsSearchScope.filter(
      (item) => item.country_iso2?.toUpperCase() === selectedIso,
    );
  }, [newsSearchScope, selectedCountry]);

  const newsDateBounds = useMemo(() => {
    const keys = newsTrendPrimaryScope
      .map((item) => (item.event_time ? getDateKey(item.event_time) : null))
      .filter((value): value is string => Boolean(value))
      .sort();
    if (keys.length === 0) return null;
    return { start: keys[0], end: keys[keys.length - 1] };
  }, [newsTrendPrimaryScope]);

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
        comparisonCount: number;
        rollingAvg: number;
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
          comparisonCount: 0,
          rollingAvg: 0,
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
      const iso = item.country_iso2?.toUpperCase();
      const inPrimaryScope = selectedIso ? iso === selectedIso : true;
      if (inPrimaryScope) {
        bucket.count += 1;
      }
      if (iso && inPrimaryScope) {
        const countryMap = perDayCountries.get(key) ?? new Map<string, number>();
        countryMap.set(iso, (countryMap.get(iso) ?? 0) + 1);
        perDayCountries.set(key, countryMap);
      }
      if (comparisonIso && iso === comparisonIso) bucket.comparisonCount += 1;
    });

    const points = Array.from(buckets.values());
    points.forEach((bucket, idx) => {
      const startIdx = Math.max(0, idx - 6);
      const window = points.slice(startIdx, idx + 1);
      const avg =
        window.reduce((sum, item) => sum + item.count, 0) / window.length;
      bucket.rollingAvg = Number(avg.toFixed(2));
      const comparisonAvg =
        window.reduce((sum, item) => sum + item.comparisonCount, 0) /
        window.length;
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

  const mapNews = useMemo(() => {
    let items = newsSearchScope;
    if (mapRange) {
      items = items.filter((item) => {
        const key = item.event_time ? getDateKey(item.event_time) : null;
        if (!key) return false;
        return key >= mapRange.start && key <= mapRange.end;
      });
    }
    return items;
  }, [newsSearchScope, mapRange]);

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

  const useDatabaseCountryStats =
    !activeRange &&
    (!searchAppliesToNews || searchTerms.length === 0) &&
    countryStatsCoverage?.window_days === mapWindowDays;

  const mapBubbleData = useMemo(() => {
    if (useDatabaseCountryStats) {
      const stats = regionCountries
        ? countryStats.filter((stat) => regionCountries.has(stat.country.toUpperCase()))
        : countryStats;
      return stats.map((stat) => ({
        country: stat.country.toUpperCase(),
        count: stat.count,
        tone: "news" as const,
        meta: {
          subtitle: `${stat.count} ${stat.count === 1 ? "story" : "stories"}`,
          lines: [`Aggregated from database over last ${mapWindowDays} days`],
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
        tone: "news" as const,
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
    regionCountries,
    countryStats,
    mapWindowDays,
    useDatabaseCountryStats,
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
      value: Number(w.temp_c),
      tone:
        (w.temp_c ?? 0) >= 28
          ? ("weather-hot" as const)
          : (w.temp_c ?? 0) <= 8
            ? ("weather-cold" as const)
            : ("weather-mild" as const),
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

  const podcastCountryLinks = useMemo(() => {
    type CountryPodcastLink = {
      signalCount: number;
      episodeIds: Set<number>;
      evidenceIds: Set<number>;
      maxScore: number;
      topSignal: PodcastSignal | null;
      topEpisode: PodcastEpisode | null;
      sources: Set<string>;
    };
    const links = new Map<string, CountryPodcastLink>();
    const termsByCountry = Array.from(countryMeta.entries()).map(([iso, meta]) => ({
      iso,
      terms: Array.from(
        new Set(
          [meta.name, ...(COUNTRY_LINK_ALIASES[iso] ?? [])].filter(
            (term): term is string => Boolean(term),
          ),
        ),
      ),
    }));
    const riskScore: Record<string, number> = {
      critical: 100,
      high: 82,
      medium: 60,
      low: 38,
    };
    const typeScore: Record<PodcastSignal["type"], number> = {
      risk: 70,
      event: 62,
      claim: 48,
      topic: 32,
      entity: 24,
    };

    podcasts.forEach((episode) => {
      episode.signals.forEach((signal) => {
        const explicitCountries = new Set(
          (signal.countries ?? [])
            .map((country) => normalizeIso2(country))
            .filter((country): country is string => Boolean(country)),
        );
        const signalText = normalizeLinkageText(
          [
            episode.title,
            episode.summary,
            signal.title,
            signal.summary,
            ...signal.entities,
            ...signal.topics,
          ]
            .filter(Boolean)
            .join(" "),
        );
        termsByCountry.forEach(({ iso, terms }) => {
          if (terms.some((term) => includesLinkageTerm(signalText, term))) {
            explicitCountries.add(iso);
          }
        });

        const base =
          riskScore[signal.risk_level ?? ""] ?? typeScore[signal.type] ?? 20;
        const confidence =
          typeof signal.confidence === "number" ? signal.confidence : 0.55;
        const score = Math.round(base * (0.65 + confidence * 0.35));
        explicitCountries.forEach((iso) => {
          const current = links.get(iso) ?? {
            signalCount: 0,
            episodeIds: new Set<number>(),
            evidenceIds: new Set<number>(),
            maxScore: 0,
            topSignal: null,
            topEpisode: null,
            sources: new Set<string>(),
          };
          current.signalCount += 1;
          current.episodeIds.add(episode.id);
          episode.evidence.forEach((evidence) =>
            current.evidenceIds.add(evidence.id),
          );
          current.sources.add(episode.feed_title);
          if (score > current.maxScore) {
            current.maxScore = score;
            current.topSignal = signal;
            current.topEpisode = episode;
          }
          links.set(iso, current);
        });
      });
    });

    return links;
  }, [countryMeta, podcasts]);

  const crossSourceMapData = useMemo(() => {
    const newsByCountry = new Map(
      mapBubbleData.map((row) => [row.country.toUpperCase(), row] as const),
    );
    const weatherByIso = new Map(
      weatherStats.map((row) => [row.country.toUpperCase(), row] as const),
    );
    const marketByIso = new Map(countryMarkets.map((row) => [row.country.toUpperCase(), row] as const));
    const countries = new Set<string>([
      ...newsByCountry.keys(),
      ...weatherByIso.keys(),
      ...marketByIso.keys(),
      ...podcastCountryLinks.keys(),
    ]);
    const maxNews = Math.max(
      1,
      ...Array.from(newsByCountry.values()).map((row) => row.count),
    );
    const maxMarketMove = Math.max(
      1,
      ...Array.from(marketByIso.values()).map((row) =>
        Math.abs(row.composite_change_percent ?? row.index_change_percent ?? row.fx_change_percent ?? 0),
      ),
    );

    return Array.from(countries)
      .flatMap((iso) => {
        if (regionCountries && !regionCountries.has(iso)) return [];
        const newsRow = newsByCountry.get(iso);
        const weather = weatherByIso.get(iso);
        const market = marketByIso.get(iso);
        const podcast = podcastCountryLinks.get(iso);
        const newsRelevance = newsRow
          ? Math.log1p(newsRow.count) / Math.log1p(maxNews)
          : 0;
        const temperatureSeverity =
          typeof weather?.temp_c === "number"
            ? Math.min(1, Math.max(0, (Math.abs(weather.temp_c - 20) - 8) / 24))
            : 0;
        const humiditySeverity =
          typeof weather?.humidity === "number"
            ? Math.min(1, Math.max(0, (weather.humidity - 75) / 25))
            : 0;
        const windSeverity =
          typeof weather?.wind_speed === "number"
            ? Math.min(1, weather.wind_speed / 25)
            : 0;
        const weatherRelevance = Math.max(
          temperatureSeverity,
          humiditySeverity,
          windSeverity,
        );
        const marketMove = Math.abs(
          market?.composite_change_percent ?? market?.index_change_percent ?? market?.fx_change_percent ?? 0,
        );
        const marketRelevance = market ? marketMove / maxMarketMove : 0;
        const podcastRelevance = podcast
          ? Math.min(1, (podcast.maxScore + Math.min(18, podcast.signalCount * 3)) / 100)
          : 0;
        const domains = [
          newsRelevance > 0 ? "news" : null,
          weatherRelevance > 0 ? "weather" : null,
          marketRelevance > 0 ? "markets" : null,
          podcastRelevance > 0 ? "podcast" : null,
        ].filter((domain): domain is string => Boolean(domain));
        const breadthBonus = Math.max(0, domains.length - 1) * 2;
        const relevance = Math.min(
          100,
          Math.round(
            newsRelevance * 40 +
              weatherRelevance * 15 +
              marketRelevance * 15 +
              podcastRelevance * 25 +
              breadthBonus,
          ),
        );
        if (relevance <= 0) return [];

        const lines = [
          newsRow ? `News: ${newsRow.count} mapped stories` : null,
          podcast
            ? `Podcast: ${podcast.signalCount} attributed signals · ${podcast.sources.values().next().value ?? "source"}`
            : null,
          weather && weatherRelevance > 0
            ? `Weather: ${weather.temp_c ?? "—"}°C · ${weather.weather_main ?? "condition"}`
            : null,
          market
            ? `Markets: ${market.index_symbol ?? market.currency ?? market.country} ${formatSignedMetric(
                market.composite_change_percent ?? market.index_change_percent ?? market.fx_change_percent,
                2,
                "%",
              )}`
            : null,
        ].filter((line): line is string => Boolean(line));

        return [
          {
            country: iso,
            count: relevance,
            tone: "signal" as const,
            meta: {
              subtitle: `Relevance ${relevance}/100 · ${domains.length} linked ${
                domains.length === 1 ? "domain" : "domains"
              }`,
              lines: lines.slice(0, 5),
            },
          },
        ];
      })
      .sort((a, b) => b.count - a.count);
  }, [
    mapBubbleData,
    countryMarkets,
    podcastCountryLinks,
    regionCountries,
    weatherStats,
  ]);

  const highestSignalCountry = crossSourceMapData[0] ?? null;
  const transportFocusCountry =
    normalizeIso2(selectedCountry) ?? normalizeIso2(highestSignalCountry?.country);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess || !transportFocusCountry) {
      setTransportOverview(null);
      return;
    }
    let cancelled = false;
    setTransportOverview(null);
    fetchTransportOverview({
      country: transportFocusCountry,
      detail: "aggregate",
    })
      .then((overview) => {
        if (!cancelled) setTransportOverview(overview);
      })
      .catch(() => {
        if (!cancelled) setTransportOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, hasPaidAccess, transportFocusCountry]);
  const highestMapNewsCountry = useMemo(
    () => [...mapBubbleData].sort((left, right) => right.count - left.count)[0] ?? null,
    [mapBubbleData],
  );
  const mostExtremeWeatherCountry = useMemo(
    () =>
      [...mapWeatherData].sort(
        (left, right) => Math.abs((right.value ?? 20) - 20) - Math.abs((left.value ?? 20) - 20),
      )[0] ?? null,
    [mapWeatherData],
  );

  const activeMapData =
    mapMode === "signals"
      ? crossSourceMapData
      : mapMode === "news"
        ? mapBubbleData
        : mapWeatherData;
  const activeMapLegendLabel =
    mapMode === "signals"
      ? "Signal relevance"
      : mapMode === "news"
        ? "Story concentration"
        : "Relative temperature";

  const pinnedSignalSummary = useMemo(() => {
    if (!pinnedCountry) return null;
    return (
      crossSourceMapData.find(
        (row) => row.country === pinnedCountry.toUpperCase(),
      ) ?? null
    );
  }, [crossSourceMapData, pinnedCountry]);

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

  const newsLanguageOptions = useMemo(() =>
    Array.from(new Set(newsSearchScope.map((item) => item.language_code?.toLowerCase()).filter((value): value is string => Boolean(value))))
      .sort((a, b) => a.localeCompare(b)), [newsSearchScope]);

  const newsPageItems = useMemo(() => {
    let items = filteredNews;
    if (newsSourceFilter !== "all") {
      const normalized = newsSourceFilter.trim().toLowerCase();
      items = items.filter((item) => (getSourceLabel(item) ?? "").toLowerCase() === normalized);
    }
    if (newsLanguageFilter !== "all") {
      items = items.filter((item) => item.language_code?.toLowerCase() === newsLanguageFilter);
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
    newsLanguageFilter,
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
      // This chart ranks publishers, not ingestion providers. Keeping the
      // publisher separate makes recognisable outlets such as reuters.com
      // visible instead of burying them in a long "via GDELT" label.
      const sourceLabel = getSourceLabel(item) ?? "Unknown";
      const publisher = sourceLabel.split(" · via ")[0] || sourceLabel;
      bySource.set(publisher, (bySource.get(publisher) ?? 0) + 1);
    });
    return Array.from(bySource.entries())
      .map(([source, stories]) => ({ source, stories }))
      .sort((a, b) => b.stories - a.stories)
      .slice(0, 8);
  }, [getSourceLabel, newsPageItems]);

  const newsPageCountryStats = useMemo(() => {
    const byCountry = new Map<string, { count: number; sources: Map<string, number> }>();
    newsPageItems.forEach((item) => {
      const countries = getNewsSignalCountries(item);
      countries.forEach((country) => {
        const entry = byCountry.get(country) ?? { count: 0, sources: new Map<string, number>() };
        entry.count += 1;
        const source = getSourceLabel(item);
        if (source) entry.sources.set(source, (entry.sources.get(source) ?? 0) + 1);
        byCountry.set(country, entry);
      });
    });
    return byCountry;
  }, [getSourceLabel, newsPageItems]);

  const newsPageMapData = useMemo(() => {
    return Array.from(newsPageCountryStats.entries()).map(([country, value]) => {
      const topSource = Array.from(value.sources.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)[0];
      return {
        country,
        count: value.count,
        tone: "news" as const,
        meta: {
          subtitle: `${value.count} ${value.count === 1 ? "story" : "stories"}`,
          lines: [topSource ? `Top source: ${topSource}` : "Top source: —"],
        },
      };
    });
  }, [newsPageCountryStats]);

  const highestNewsCountry = useMemo(
    () =>
      [...newsPageMapData].sort((a, b) => b.count - a.count)[0] ?? null,
    [newsPageMapData],
  );

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

  const weatherAlerts = useMemo(
    () =>
      weatherPageRows.filter(
        (row) =>
          (row.alert_count ?? row.alerts?.length ?? 0) > 0 ||
          (typeof row.temp_c === "number" && (row.temp_c >= 35 || row.temp_c <= 0)) ||
          (typeof row.humidity === "number" && row.humidity >= 85) ||
          (typeof (row.wind_gust ?? row.wind_speed) === "number" && (row.wind_gust ?? row.wind_speed ?? 0) >= 15) ||
          (row.forecast?.[0]?.precipitation_probability ?? 0) >= 70,
      ),
    [weatherPageRows],
  );

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
      .sort((a, b) => Math.abs((b.temp_c ?? 20) - 20) - Math.abs((a.temp_c ?? 20) - 20))
      .slice(0, 16)
      .map((row) => ({
        country: (row.country || "—").toUpperCase(),
        temp_c: row.temp_c ?? null,
        apparent_temp_c: row.apparent_temp_c ?? null,
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

  const weatherOperationalRows = useMemo(() => {
    return weatherPageRows
      .map((row) => {
        const forecast = row.forecast?.[0];
        const actualAlerts = row.alert_count ?? row.alerts?.length ?? 0;
        const aqi = row.air_quality?.provider_aqi ?? row.air_quality?.european_aqi ?? row.air_quality?.us_aqi ?? null;
        const heat = row.temp_c == null ? 0 : Math.max(0, row.temp_c - 30) * 3;
        const cold = row.temp_c == null ? 0 : Math.max(0, 5 - row.temp_c) * 2;
        const wind = Math.max(0, (row.wind_gust ?? row.wind_speed ?? 0) - 10) * 2;
        const rain = Math.max(0, (forecast?.precipitation_probability ?? 0) - 50) * 0.35;
        const air = aqi == null ? 0 : row.air_quality?.aqi_scale?.toLowerCase().startsWith("openweather")
          ? Math.max(0, aqi - 2) * 12
          : Math.max(0, aqi - 50) * 0.4;
        const score = Math.min(100, Math.round(Math.max(heat, cold) + wind + rain + air + actualAlerts * 35));
        const reasons = [
          actualAlerts ? `${actualAlerts} active official alert${actualAlerts === 1 ? "" : "s"}` : null,
          row.temp_c != null && row.temp_c >= 35 ? `extreme heat ${formatMetricNumber(row.temp_c)}°C` : null,
          row.temp_c != null && row.temp_c <= 0 ? `freezing ${formatMetricNumber(row.temp_c)}°C` : null,
          (row.wind_gust ?? row.wind_speed ?? 0) >= 15 ? `wind ${formatMetricNumber(row.wind_gust ?? row.wind_speed)} m/s` : null,
          (forecast?.precipitation_probability ?? 0) >= 60 ? `${forecast?.precipitation_probability}% precipitation risk` : null,
          aqi != null && air > 0 ? `air quality ${row.air_quality?.label ?? aqi}` : null,
        ].filter((reason): reason is string => Boolean(reason));
        return { ...row, score, reasons, aqi, forecast };
      })
      .sort((left, right) => right.score - left.score || (right.temp_c ?? -999) - (left.temp_c ?? -999));
  }, [weatherPageRows]);

  const weatherForecastChartData = useMemo(() =>
    (weatherForecastDetail?.hourly ?? []).map((point) => ({
      time: new Date(point.forecast_time).toLocaleString(undefined, { weekday: "short", hour: "2-digit" }),
      temperature: point.temp_c,
      feels_like: point.apparent_temp_c,
      rain_probability: point.precipitation_probability,
      wind_gust: point.wind_gust,
    })), [weatherForecastDetail]);

  const marketCountryRows = useMemo(() => {
    const terms = searchAppliesToMarkets ? searchTerms : [];
    return countryMarkets
      .filter((row) => !regionCountries || regionCountries.has(row.country.toUpperCase()))
      .filter((row) => terms.length === 0 || terms.every((term) => [row.country, row.country_name, row.currency, row.index_name, row.index_symbol]
        .filter(Boolean).join(" ").toLowerCase().includes(term)))
      .sort((left, right) => Math.abs(right.composite_change_percent ?? 0) - Math.abs(left.composite_change_percent ?? 0));
  }, [countryMarkets, regionCountries, searchAppliesToMarkets, searchTerms]);

  const marketIndexMoversData = useMemo(() => marketCountryRows
    .filter((row) => row.index_change_percent != null)
    .sort((left, right) => Math.abs(right.index_change_percent ?? 0) - Math.abs(left.index_change_percent ?? 0))
    .slice(0, 14)
    .map((row) => ({ country: row.country, country_name: row.country_name, change: row.index_change_percent ?? 0, level: row.index_value })), [marketCountryRows]);

  const marketFxMoversData = useMemo(() => marketCountryRows
    .filter((row) => row.fx_change_percent != null && row.currency !== "EUR")
    .sort((left, right) => Math.abs(right.fx_change_percent ?? 0) - Math.abs(left.fx_change_percent ?? 0))
    .slice(0, 14)
    .map((row) => ({ country: row.country, currency: row.currency, change: row.fx_change_percent ?? 0, rate: row.fx_rate })), [marketCountryRows]);

  const marketRelationshipData = useMemo(() => marketCountryRows
    .filter((row) => row.index_change_percent != null && row.fx_change_percent != null && row.currency !== "EUR")
    .map((row) => ({ country: row.country, index: row.index_change_percent, fx: row.fx_change_percent, filings: row.filing_count_7d })), [marketCountryRows]);

  const marketPageRows = useMemo(() => {
    return filteredMarket.filter((quote) => quote.instrument_type !== "macro").sort(
      (a, b) =>
        Math.abs(b.percent_change ?? b.change ?? 0) - Math.abs(a.percent_change ?? a.change ?? 0),
    );
  }, [filteredMarket]);

  const marketMoversChartData = useMemo(() => {
    return marketPageRows.slice(0, 12).map((quote) => ({
      symbol: quote.symbol,
      percent_change: quote.percent_change ?? 0,
      change: quote.change ?? 0,
    }));
  }, [marketPageRows]);

  const marketCommodityMoversData = useMemo(() => marketPageRows
    .filter((quote) => quote.instrument_type === "commodity")
    .slice(0, 12)
    .map((quote) => ({
      symbol: quote.canonical_symbol ?? quote.symbol,
      name: quote.company_name ?? quote.symbol,
      value: quote.price,
      percent_change: quote.percent_change ?? 0,
      currency: quote.currency,
    })), [marketPageRows]);

  const marketMacroGrowthData = useMemo(() => marketCountryRows
    .filter((row) => row.gdp_growth != null)
    .sort((left, right) => Math.abs(right.gdp_growth ?? 0) - Math.abs(left.gdp_growth ?? 0))
    .slice(0, 20)
    .map((row) => ({
      country: row.country,
      country_name: row.country_name,
      growth: row.gdp_growth ?? 0,
      inflation: row.inflation,
      unemployment: row.unemployment,
      current_account: row.current_account,
      year: row.macro_latest_year,
    })), [marketCountryRows]);

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
      if (quote.scope === "global") return;
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
    return countryMarkets.flatMap((row) => {
      const directionalValue =
        marketMapLayer === "index"
          ? row.index_change_percent
          : marketMapLayer === "fx"
            ? row.fx_change_percent
            : marketMapLayer === "growth"
              ? row.gdp_growth
              : row.composite_change_percent;
      const value = marketMapLayer === "filings" ? row.filing_count_7d : directionalValue;
      if (value == null || (marketMapLayer === "filings" && value <= 0)) return [];
      const scaled = Math.max(1, Math.round(Math.abs(value) * 18));
      return {
        country: row.country,
        count: scaled,
        value,
        tone:
          value > 0
            ? ("positive" as const)
            : value < 0
              ? ("negative" as const)
              : ("neutral" as const),
        meta: {
          subtitle:
            marketMapLayer === "filings"
              ? `${row.filing_count_7d} SEC filings · trailing 7 days`
              : `${value >= 0 ? "+" : ""}${value.toFixed(2)}% · ${marketMapLayer}${marketMapLayer === "growth" && row.macro_latest_year ? ` (${row.macro_latest_year})` : ""}`,
          lines: [
            row.index_symbol
              ? `${row.index_symbol}: ${formatSignedMetric(row.index_change_percent, 2, "%")}`
              : "Country index: provider not configured",
            row.fx_symbol
              ? `${row.fx_symbol}: local currency ${formatSignedMetric(row.fx_change_percent, 2, "%")} vs EUR`
              : "FX: unavailable",
            `${row.filing_count_7d} SEC filings in 7 days`,
            `Macro: GDP ${formatSignedMetric(row.gdp_growth, 1, "%")} · inflation ${row.inflation == null ? "unavailable" : `${formatMetricNumber(row.inflation, { maximumFractionDigits: 1 })}%`}`,
            `Freshness: ${row.freshness}`,
          ],
        },
      };
    });
  }, [countryMarkets, marketMapLayer]);

  const featuredMarketCountry = useMemo(
    () =>
      [...marketIndexMapData].sort(
        (left, right) => Math.abs(right.value ?? right.count) - Math.abs(left.value ?? left.count),
      )[0] ?? null,
    [marketIndexMapData],
  );
  const marketMapDomain = useMemo<[number, number]>(() => {
    if (marketMapLayer === "filings") return [0, Math.max(1, ...marketIndexMapData.map((row) => row.value ?? 0))];
    const extent = Math.max(0.25, ...marketIndexMapData.map((row) => Math.abs(row.value ?? 0)));
    return [-extent, extent];
  }, [marketIndexMapData, marketMapLayer]);
  const newsMarketContextData = useMemo(
    () => marketIndexMapData.filter((row) => newsPageCountryStats.has(row.country.toUpperCase())),
    [marketIndexMapData, newsPageCountryStats],
  );
  const featuredNewsMarketCountry = useMemo(
    () =>
      [...newsMarketContextData].sort(
        (left, right) => Math.abs(right.value ?? right.count) - Math.abs(left.value ?? left.count),
      )[0] ?? null,
    [newsMarketContextData],
  );
  const marketMapDescription =
    marketMapLayer === "filings"
      ? "SEC filing activity · trailing 7 days"
      : marketMapLayer === "index"
        ? "Latest configured national benchmark direction · source frequency shown per country"
        : marketMapLayer === "fx"
          ? "Local-currency direction versus EUR · latest daily reference rate"
          : marketMapLayer === "growth"
            ? "Latest World Bank annual real GDP growth · observation year shown per country"
          : "Mixed-frequency market regime · national benchmark 75% + ECB FX 25%";

  const selectedCountryMarket = useMemo(() => {
    const country = (selectedCountry ?? pinnedCountry ?? "").toUpperCase();
    return countryMarkets.find((row) => row.country === country) ?? null;
  }, [countryMarkets, pinnedCountry, selectedCountry]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess || !selectedCountryMarket) {
      setCountryMarketDetail(null);
      return;
    }
    let cancelled = false;
    fetchCountryMarketDetail(selectedCountryMarket.country)
      .then((detail) => {
        if (!cancelled) setCountryMarketDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setCountryMarketDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, hasPaidAccess, selectedCountryMarket]);

  const weatherFocusCountry = useMemo(() => {
    const selected = normalizeIso2(selectedCountry ?? pinnedCountry);
    if (selected && weatherStats.some((row) => row.country.toUpperCase() === selected)) return selected;
    return [...weatherStats]
      .sort((left, right) => {
        const severity = (row: CountryWeather) =>
          Math.abs((row.temp_c ?? 20) - 20) +
          (row.wind_gust ?? row.wind_speed ?? 0) * 0.8 +
          (row.alert_count ?? row.alerts?.length ?? 0) * 20;
        return severity(right) - severity(left);
      })[0]?.country.toUpperCase() ?? null;
  }, [pinnedCountry, selectedCountry, weatherStats]);

  useEffect(() => {
    if (authStatus !== "authed" || !hasPaidAccess || !weatherFocusCountry) {
      setWeatherForecastDetail(null);
      return;
    }
    let cancelled = false;
    setWeatherForecastLoading(true);
    fetchCountryWeatherForecast(weatherFocusCountry, 120)
      .then((detail) => {
        if (!cancelled) setWeatherForecastDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setWeatherForecastDetail(null);
      })
      .finally(() => {
        if (!cancelled) setWeatherForecastLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, hasPaidAccess, weatherFocusCountry]);

  const countryMarketCoverage = useMemo(() => ({
    countries: countryMarkets.length,
    indices: countryMarkets.filter((row) => row.index_change_percent != null).length,
    fx: countryMarkets.filter((row) => row.fx_change_percent != null).length,
    macro: countryMarkets.filter((row) => row.gdp_growth != null || row.inflation != null || row.unemployment != null || row.current_account != null).length,
    filings: countryMarkets.reduce((sum, row) => sum + row.filing_count_7d, 0),
  }), [countryMarkets]);

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
      if (quote.scope === "global" || quote.instrument_type === "macro") return;
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

  const selectedSymbolHistoryData = useMemo(() => (selectedSymbolQuote?.history ?? []).map((point) => ({
    period: point.period_end,
    value: point.value,
  })), [selectedSymbolQuote]);

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
    const fromSymbol = selectedSymbolQuote?.scope === "country" ? selectedSymbolQuote.country?.toUpperCase() : null;
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

  const relatedMarketCountry = useMemo(() => {
    if (!relationCountry) return null;
    return countryMarkets.find((row) => row.country.toUpperCase() === relationCountry) ?? null;
  }, [countryMarkets, relationCountry]);

  const relatedTransport = useMemo(() => {
    if (!relationCountry) return null;
    return (
      transportOverview?.countries.find(
        (country) => country.country.toUpperCase() === relationCountry,
      ) ?? null
    );
  }, [relationCountry, transportOverview]);

  const relatedNews = useMemo(() => {
    if (!relationCountry) return [];
    return [...news]
      .filter((item) => item.country_iso2?.toUpperCase() === relationCountry)
      .sort((a, b) => (b.event_time || "").localeCompare(a.event_time || ""))
      .slice(0, 6);
  }, [news, relationCountry]);

  const relatedPodcastLink = useMemo(() => {
    if (!relationCountry) return null;
    return podcastCountryLinks.get(relationCountry) ?? null;
  }, [podcastCountryLinks, relationCountry]);

  const newsSummary = useMemo(() => {
    const timelineDays = newsPageTimelineData.length;
    const withImages = newsPageItems.filter((item) => Boolean(getNewsImageUrl(item))).length;
    return {
      stories: newsPageItems.length,
      countries: newsPageCountryStats.size,
      dominantSource: newsPageSourceData[0]?.source ?? "—",
      avgPerDay: timelineDays > 0 ? newsPageItems.length / timelineDays : newsPageItems.length,
      withImages,
    };
  }, [newsPageCountryStats.size, newsPageItems, newsPageSourceData, newsPageTimelineData.length]);

  const newsCountryCoverageRows = useMemo(() => {
    return Array.from(newsPageCountryStats.entries())
      .map(([country, value]) => {
        const topSource = Array.from(value.sources.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name)[0];
        const weather = weatherByCountry.get(country);
        const market = countryMarkets.find((row) => row.country.toUpperCase() === country);
        return {
          country,
          count: value.count,
          topSource: topSource ?? "—",
          weather:
            weather && typeof weather.temp_c === "number"
              ? `${formatMetricNumber(weather.temp_c)}°C`
              : "—",
          topSymbol: market?.index_symbol ?? market?.currency ?? "—",
          topMove:
            typeof market?.composite_change_percent === "number"
              ? formatSignedMetric(market.composite_change_percent, 2, "%")
              : "—",
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [countryMarkets, newsPageCountryStats, weatherByCountry]);

  const weatherSummary = useMemo(() => {
    const tempRows = weatherPageRows.filter((row) => typeof row.temp_c === "number");
    const humidityRows = weatherPageRows.filter((row) => typeof row.humidity === "number");
    const hottest = tempRows.reduce<CountryWeather | null>(
      (current, row) =>
        !current || (row.temp_c ?? -999) > (current.temp_c ?? -999) ? row : current,
      null,
    );
    return {
      observations: weatherPageRows.length,
      avgTemp:
        tempRows.length > 0
          ? tempRows.reduce((sum, row) => sum + Number(row.temp_c), 0) / tempRows.length
          : null,
      avgHumidity:
        humidityRows.length > 0
          ? humidityRows.reduce((sum, row) => sum + Number(row.humidity), 0) / humidityRows.length
          : null,
      dominantCondition: weatherConditionChartData[0]?.condition ?? "—",
      hottestCountry: hottest?.country?.toUpperCase() ?? "—",
      hottestTemp: hottest?.temp_c ?? null,
      officialAlerts: weatherPageRows.reduce((sum, row) => sum + (row.alert_count ?? row.alerts?.length ?? 0), 0),
      poorAir: weatherPageRows.filter((row) => {
        const value = row.air_quality?.provider_aqi ?? row.air_quality?.european_aqi ?? row.air_quality?.us_aqi;
        return value != null && (row.air_quality?.aqi_scale?.toLowerCase().startsWith("openweather") ? value >= 4 : value > 75);
      }).length,
      highRainRisk: weatherPageRows.filter((row) => (row.forecast?.[0]?.precipitation_probability ?? 0) >= 70).length,
    };
  }, [weatherConditionChartData, weatherPageRows]);

  const marketSummary = useMemo(() => {
    const directional = marketCountryRows.filter((row) => row.composite_change_percent != null);
    const gainers = directional.filter((row) => (row.composite_change_percent ?? 0) > 0).length;
    const losers = directional.filter((row) => (row.composite_change_percent ?? 0) < 0).length;
    const avgAbsMove =
      directional.length > 0
        ? directional.reduce(
            (sum, row) => sum + Math.abs(row.composite_change_percent ?? 0),
            0,
          ) / directional.length
        : null;
    return {
      countries: marketCountryRows.length,
      gainers,
      losers,
      avgAbsMove,
      topMover: marketCountryRows[0] ?? null,
      filings: marketCountryRows.reduce((sum, row) => sum + row.filing_count_7d, 0),
    };
  }, [marketCountryRows]);

  const podcastSummary = useMemo(() => {
    const signalRows = podcasts.flatMap((episode) =>
      episode.signals.map((signal) => ({ episode, signal })),
    );
    const rankLabels = (values: string[]) => {
      const counts = new Map<string, { label: string; count: number }>();
      values.forEach((value) => {
        const label = value.trim();
        if (!label) return;
        const key = label.toLocaleLowerCase();
        const current = counts.get(key);
        counts.set(key, {
          label: current?.label ?? label,
          count: (current?.count ?? 0) + 1,
        });
      });
      return Array.from(counts.values()).sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      );
    };
    const riskRank: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    const prioritySignal = [...signalRows].sort((a, b) => {
      const riskDelta =
        (riskRank[b.signal.risk_level ?? ""] ?? 0) -
        (riskRank[a.signal.risk_level ?? ""] ?? 0);
      if (riskDelta !== 0) return riskDelta;
      return (b.episode.event_time ?? "").localeCompare(
        a.episode.event_time ?? "",
      );
    })[0];
    const latestEpisode = [...podcasts].sort((a, b) =>
      (b.event_time ?? "").localeCompare(a.event_time ?? ""),
    )[0];
    const transcripts = podcasts.filter(
      (episode) => episode.transcript_status === "available",
    ).length;
    const risks = signalRows.filter(
      ({ signal }) => signal.type === "risk" || Boolean(signal.risk_level),
    );
    const elevatedRisks = risks.filter(({ signal }) =>
      ["critical", "high"].includes(signal.risk_level ?? ""),
    ).length;
    const confidences = signalRows
      .map(({ signal }) => signal.confidence)
      .filter((value): value is number => typeof value === "number");
    const topTopics = rankLabels(
      signalRows.flatMap(({ signal }) => signal.topics),
    ).slice(0, 4);
    const topEntities = rankLabels(
      signalRows.flatMap(({ signal }) => signal.entities),
    ).slice(0, 4);
    const signalTypes = rankLabels(
      signalRows.map(({ signal }) => signal.type),
    );
    const topCountries = Array.from(podcastCountryLinks.entries())
      .map(([iso, linkage]) => ({
        iso,
        name: countryMeta.get(iso)?.name ?? iso,
        count: linkage.signalCount,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 4);
    const theme = topTopics[0] ?? topEntities[0] ?? signalTypes[0];
    const conclusions =
      signalRows.length === 0
        ? "No extracted signals are available in the current podcast scope, so there is not yet enough structured evidence for an overall conclusion."
        : [
            theme
              ? `${theme.label} is the leading recurring theme, appearing in ${theme.count} extracted ${theme.count === 1 ? "signal" : "signals"}.`
              : `${signalRows.length} extracted signals define the current evidence set.`,
            elevatedRisks > 0
              ? `${elevatedRisks} high or critical risk ${elevatedRisks === 1 ? "signal requires" : "signals require"} priority review.`
              : risks.length > 0
                ? `${risks.length} risk ${risks.length === 1 ? "signal is" : "signals are"} present, with none currently rated high or critical.`
                : "No explicit risk signals are present in the current scope.",
            topCountries[0]
              ? `${topCountries[0].name} has the strongest geographic linkage across the podcast evidence.`
              : "The extracted findings do not yet show a dominant geographic concentration.",
          ].join(" ");

    return {
      episodes: podcasts.length,
      signals: signalRows.length,
      transcripts,
      evidence: podcasts.reduce(
        (total, episode) => total + episode.evidence.length,
        0,
      ),
      risks: risks.length,
      elevatedRisks,
      averageConfidence:
        confidences.length > 0
          ? confidences.reduce((sum, value) => sum + value, 0) /
            confidences.length
          : null,
      topTopics,
      topEntities,
      topCountries,
      dominantSignalType: signalTypes[0] ?? null,
      conclusions,
      prioritySignal,
      latestEpisode,
    };
  }, [countryMeta, podcastCountryLinks, podcasts]);

  const selectedLeadershipProfile = useMemo(() => {
    if (!selectedCountry) return null;
    return (
      leadershipStats.find(
        (country) =>
          country.country.toUpperCase() === selectedCountry.toUpperCase(),
      ) ?? null
    );
  }, [leadershipStats, selectedCountry]);

  const selectedCountryContext = useMemo(() => {
    if (!selectedCountry) return null;
    const iso = selectedCountry.toUpperCase();
    const newsRow = mapBubbleData.find(
      (row) => row.country.toUpperCase() === iso,
    );
    const mappedNews = mapCountryStats.get(iso);
    const maxNews = Math.max(
      1,
      ...mapBubbleData.map((row) => Number(row.count) || 0),
    );
    const temperature =
      typeof relatedWeather?.temp_c === "number"
        ? relatedWeather.temp_c
        : null;
    const relevance = crossSourceMapData.find((row) => row.country === iso);

    return {
      iso,
      meta: countryMeta.get(iso),
      newsCount: newsRow?.count ?? mappedNews?.count ?? relatedNews.length,
      newsIntensity:
        ((newsRow?.count ?? mappedNews?.count ?? 0) / maxNews) * 100,
      topSource:
        mappedNews && mappedNews.sources.size > 0
          ? [...mappedNews.sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
          : null,
      temperature,
      temperaturePosition:
        temperature == null
          ? 0
          : Math.max(0, Math.min(100, ((temperature + 30) / 80) * 100)),
      humidity:
        typeof relatedWeather?.humidity === "number"
          ? relatedWeather.humidity
          : null,
      relevanceScore: relevance?.count ?? 0,
      relevanceDrivers: [
        ...(relevance?.meta?.lines ?? []),
        ...(relatedTransport && relatedTransport.active_count > 0
          ? [
              `Transport: ${relatedTransport.active_count} active links · ${relatedTransport.trend.ship_departures.current} ship departures · ${relatedTransport.trend.tracked_flights.current} tracked flights`,
            ]
          : []),
      ],
    };
  }, [
    countryMeta,
    crossSourceMapData,
    mapBubbleData,
    mapCountryStats,
    relatedNews.length,
    relatedTransport,
    relatedWeather,
    selectedCountry,
  ]);

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
    countryMarkets.forEach((row) => {
      [row.fx_period_end, row.index_period_end].forEach((period) => {
        if (!period) return;
        const time = Date.parse(period);
        if (!Number.isNaN(time)) times.push(time);
      });
    });
    if (times.length === 0) return "Awaiting new syncs";
    return formatExactTimestamp(Math.max(...times));
  }, [countryMarkets, filteredNews, filteredWeather]);

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
    const news = newsSearchScope.slice(0, 8).map((item) => ({
      key: `news-${item.id}`,
      kind: "News",
      view: "news" as const,
      title: newsDisplayTitle(item),
      subtitle: [
        item.translated_title ? "AI translation" : null,
        item.country_iso2 ? item.country_iso2.toUpperCase() : null,
        item.event_time ? new Date(item.event_time).toLocaleString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: item.url ?? null,
      country: item.country_iso2?.toUpperCase() ?? null,
      symbol: null,
    }));
    const weather = weatherSearchScope.slice(0, 8).map((row, idx) => ({
      key: `weather-${row.country}-${row.observed_at}-${idx}`,
      kind: "Weather",
      view: "weather" as const,
      title: `${(row.country || "—").toUpperCase()} · ${row.temp_c ?? "—"}°C`,
      subtitle: [
        row.weather_main ?? null,
        row.humidity != null ? `${row.humidity}% humidity` : null,
        row.observed_at ? new Date(row.observed_at).toLocaleString() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: null,
      country: row.country?.toUpperCase() ?? null,
      symbol: null,
    }));
    const podcastRows = podcastSearchScope.slice(0, 8).map((episode) => ({
      key: `podcast-${episode.id}`,
      kind: "Podcast evidence",
      view: "podcasts" as const,
      title: episode.title,
      subtitle: [
        episode.feed_title,
        episode.signals.length ? `${episode.signals.length} intelligence signals` : null,
        episode.event_time ? new Date(episode.event_time).toLocaleString() : null,
      ].filter(Boolean).join(" · "),
      href:
        getPodcastExternalLinks(episode).find((link) => link.platform === "publisher")?.url ??
        getPodcastExternalLinks(episode)[0]?.url ??
        null,
      country: null,
      symbol: null,
    }));
    const markets = marketCountryRows.slice(0, 8).map((row) => ({
      key: `market-${row.country}`,
      kind: "Country market regime",
      view: "markets" as const,
      title: `${row.country_name} · ${formatSignedMetric(row.composite_change_percent, 2, "%")}`,
      subtitle: [
        row.index_name ?? null,
        row.index_change_percent != null ? `${row.index_source ?? "Benchmark"} ${formatSignedMetric(row.index_change_percent, 2, "%")}` : null,
        row.fx_change_percent != null ? `${row.currency ?? "FX"} ${formatSignedMetric(row.fx_change_percent, 2, "%")} vs EUR` : null,
        `${row.filing_count_7d} SEC filings / 7d`,
      ]
        .filter(Boolean)
        .join(" · "),
      href: null,
      country: row.country,
      symbol: null,
    }));

    if (effectiveSearchTopic === "news") {
      return news;
    }
    if (effectiveSearchTopic === "weather") {
      return weather;
    }
    if (effectiveSearchTopic === "podcasts") {
      return podcastRows;
    }
    if (effectiveSearchTopic === "markets") {
      return markets;
    }
    return [...news.slice(0, 3), ...podcastRows.slice(0, 3), ...weather.slice(0, 1), ...markets.slice(0, 1)];
  }, [effectiveSearchTopic, marketCountryRows, newsSearchScope, podcastSearchScope, weatherSearchScope]);

  const signalNotifications = useMemo<SignalNotification[]>(() => {
    const items: SignalNotification[] = [];
    const formatTime = (value: string | null | undefined) => {
      if (!value) return "Current";
      const time = Date.parse(value);
      if (Number.isNaN(time)) return value;
      return formatExactTimestamp(time);
    };

    intelligenceAlerts.slice(0, 4).forEach((alert) => {
      items.push({
        id: `event-alert-${alert.id}`,
        title: alert.title,
        description: `${alert.body}${alert.location_name || alert.primary_country_iso2 ? ` · ${alert.location_name || alert.primary_country_iso2}` : ""}`,
        timeLabel: formatTime(alert.updated_at),
        tone: alert.severity === "critical" ? "critical" : alert.severity === "high" ? "attention" : "info",
        view: "intelligence",
        country: alert.primary_country_iso2 ?? undefined,
        eventId: alert.event_id,
      });
    });

    if (newsLoadError) {
      items.push({
        id: `news-error-${newsLoadError}`,
        title: "News refresh needs attention",
        description: newsLoadError,
        timeLabel: "Current",
        tone: "critical",
        view: "news",
      });
    }
    if (dailyBriefingError) {
      items.push({
        id: `briefing-error-${dailyBriefingError}`,
        title: "Daily briefing unavailable",
        description: dailyBriefingError,
        timeLabel: "Current",
        tone: "critical",
        view: "dashboard",
      });
    }
    if (podcastLoadError) {
      items.push({
        id: `podcast-error-${podcastLoadError}`,
        title: "Podcast intelligence refresh needs attention",
        description: podcastLoadError,
        timeLabel: "Current",
        tone: "critical",
        view: "podcasts",
      });
    }
    const podcastRisk = podcasts.flatMap((episode) =>
      episode.signals
        .filter((signal) => signal.type === "risk" && (signal.risk_level === "high" || signal.risk_level === "critical"))
        .map((signal) => ({ episode, signal })),
    )[0];
    if (podcastRisk) {
      items.push({
        id: `podcast-risk-${podcastRisk.signal.id}`,
        title: podcastRisk.signal.title,
        description: `${podcastRisk.episode.feed_title} · ${podcastRisk.signal.summary ?? "Risk signal extracted from timestamped podcast evidence."}`,
        timeLabel: formatTime(podcastRisk.episode.event_time),
        tone: podcastRisk.signal.risk_level === "critical" ? "critical" : "attention",
        view: "podcasts",
      });
    }
    if (highestSignalCountry && highestSignalCountry.count >= 55) {
      items.push({
        id: `country-relevance-${highestSignalCountry.country}-${highestSignalCountry.count}`,
        title: `${
          countryMeta.get(highestSignalCountry.country)?.name ??
          highestSignalCountry.country
        } has the highest linked relevance`,
        description:
          highestSignalCountry.meta?.lines?.slice(0, 2).join(" · ") ??
          "Multiple signal domains converge in the current scope.",
        timeLabel: `${highestSignalCountry.count}/100`,
        tone: "attention",
        view: "dashboard",
        country: highestSignalCountry.country,
      });
    }
    if (dailyBriefing?.published_at) {
      items.push({
        id: `briefing-${dailyBriefing.id}-${dailyBriefing.published_at}`,
        title: dailyBriefing.title,
        description:
          dailyBriefing.key_takeaways[0] ??
          "The latest daily signal briefing is ready to review.",
        timeLabel: formatTime(dailyBriefing.published_at),
        tone: "info",
        view: "dashboard",
      });
    }

    const latestAnomaly = trendAnomalies[trendAnomalies.length - 1];
    if (latestAnomaly) {
      items.push({
        id: `news-anomaly-${latestAnomaly.dateKey}`,
        title: "Unusual news volume detected",
        description: `${latestAnomaly.count} stories were recorded on ${latestAnomaly.label}.`,
        timeLabel: latestAnomaly.label,
        tone: "attention",
        view: "news",
        dateKey: latestAnomaly.dateKey,
      });
    }

    const topMover = [...countryMarkets]
      .filter((row) => typeof row.composite_change_percent === "number")
      .sort(
        (a, b) =>
          Math.abs(b.composite_change_percent ?? 0) - Math.abs(a.composite_change_percent ?? 0),
      )[0];
    if (topMover && Math.abs(topMover.composite_change_percent ?? 0) >= 2) {
      items.push({
        id: `market-regime-${topMover.country}-${topMover.index_period_end ?? topMover.fx_period_end ?? "current"}`,
        title: `${topMover.country_name} regime ${formatSignedMetric(topMover.composite_change_percent, 2, "%")}`,
        description: `${topMover.index_source ?? "Benchmark"} ${formatSignedMetric(topMover.index_change_percent, 2, "%")} · ${topMover.currency ?? "FX"} ${formatSignedMetric(topMover.fx_change_percent, 2, "%")} vs EUR.`,
        timeLabel: topMover.index_period_end ?? topMover.fx_period_end ?? "Current",
        tone: "attention",
        view: "markets",
        country: topMover.country,
      });
    }

    return items.slice(0, 8);
  }, [
    dailyBriefing,
    dailyBriefingError,
    countryMeta,
    highestSignalCountry,
    countryMarkets,
    intelligenceAlerts,
    newsLoadError,
    podcastLoadError,
    podcasts,
    trendAnomalies,
  ]);

  const unreadNotificationCount = useMemo(
    () =>
      signalNotifications.filter(
        (notification) => !readNotificationIds.includes(notification.id),
      ).length,
    [readNotificationIds, signalNotifications],
  );

  const splitViewEnabled = useMemo(
    () =>
      viewportSize.width >= SPLIT_VIEW_MIN_WIDTH &&
      viewportSize.height >= SPLIT_VIEW_MIN_HEIGHT,
    [viewportSize.height, viewportSize.width],
  );

  const dashboardPanelClass = `${cardBase} dashboard-panel flex min-h-0 flex-col overflow-hidden`;

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

  useEffect(() => {
    const update = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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

  const handleOpenIntelligence = useCallback((eventId?: string) => {
    if (eventId) {
      setSelectedIntelligenceEventId(eventId);
      const nextUrl = new URL(window.location.href);
      if (nextUrl.searchParams.get("event") !== eventId) {
        nextUrl.searchParams.set("event", eventId);
        window.history.pushState({ eventId }, "", nextUrl);
      }
    }
    setActiveView("intelligence");
  }, []);

  const handleOpenImagery = useCallback((eventId?: string) => {
    if (eventId) {
      setSelectedIntelligenceEventId(eventId);
      const nextUrl = new URL(window.location.href);
      if (nextUrl.searchParams.get("event") !== eventId) {
        nextUrl.searchParams.set("event", eventId);
        window.history.pushState({ eventId }, "", nextUrl);
      }
    }
    setActiveView("earth-observation");
  }, []);

  const handleClearSelection = () => {
    setSelectedCountry(null);
    setComparisonCountry(null);
    setPinnedCountry(null);
    setSelectedSymbol(null);
    setSelectedIntelligenceEventId(null);
    setCompareMode(false);
    const nextUrl = new URL(window.location.href);
    if (nextUrl.searchParams.has("event")) {
      nextUrl.searchParams.delete("event");
      window.history.replaceState(null, "", nextUrl);
    }
  };

  const hasActiveSelection = Boolean(
    selectedCountry || comparisonCountry || pinnedCountry || selectedSymbol || selectedIntelligenceEventId,
  );

  const handleSearchTopicChange = useCallback((topic: SearchTopic) => {
    setSearchTopic(topic);
    setQuery((value) => stripDashboardSearchTopicTokens(value));
  }, []);

  const handleSearchResult = (result: (typeof aiSearchPreview)[number]) => {
    setActiveView(result.view);
    if (result.country) {
      setSelectedCountry(result.country);
    }
    if (result.symbol) {
      setSelectedSymbol(result.symbol);
    }
    setSearchOpen(false);
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

  const markNotificationRead = (id: string) => {
    setReadNotificationIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
  };

  const handleNotificationClick = (notification: SignalNotification) => {
    markNotificationRead(notification.id);
    if (notification.eventId) handleOpenIntelligence(notification.eventId);
    else setActiveView(notification.view);
    if (notification.symbol) {
      setSelectedSymbol(notification.symbol);
    }
    if (notification.dateKey) {
      handleAnomalyClick(notification.dateKey);
    }
    if (notification.country) {
      setSelectedCountry(notification.country);
      setMapMode("signals");
      requestAnimationFrame(() =>
        document.getElementById("signal-map-feed")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    }
    setNotificationsOpen(false);
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
      "primary_scope",
      "comparison",
      "rolling_avg",
    ];
    const rows = series.map((d) =>
      [
        d.dateKey,
        d.label,
        d.count,
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
      ctx.fillStyle = dark ? "#0d1724" : "#ffffff";
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
    const primaryLabel = selectedCountry?.toUpperCase() ?? regionLabel;
    return (
      <div className="app-card rounded-lg px-3 py-2 text-xs text-[color:var(--shell-ink)]">
        <div className="font-semibold">{label}</div>
        <div>
          {primaryLabel}:{" "}
          {chartView === "rolling" ? point.rollingAvg : point.count}
        </div>
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
      label: "Overview",
      view: "dashboard" as const,
      icon: LayoutGrid,
      group: "core",
    },
    ...(isAdmin
      ? [{ id: "admin", label: "Admin", view: "admin" as const, icon: Settings, group: "operations" }]
      : []),
    { id: "profile", label: "Profile", view: "profile" as const, icon: User, group: "account" },
    { id: "legal", label: "Policies", view: "legal" as const, icon: FileText, group: "account" },
  ];

  const viewMeta = {
    dashboard: {
      kicker: "Global operating picture",
      title: "Overview",
      summary: "Start with material events, then trace each source and observation",
    },
    news: {
      kicker: "Source explorer",
      title: "Global news signals",
      summary: "Source, geography, significance, and recency in one stream",
    },
    podcasts: {
      kicker: "Source explorer",
      title: "Podcast intelligence",
      summary: "Extracted claims, events, risks, and timestamped evidence",
    },
    weather: {
      kicker: "Source explorer",
      title: "Weather conditions",
      summary: "Threshold breaches, affected locations, and distribution",
    },
    markets: {
      kicker: "Source explorer",
      title: "Watchlist & correlations",
      summary: "Movement, volatility, and linked contextual signals",
    },
    transport: {
      kicker: "Source explorer",
      title: "Shipping & flight routes",
      summary: "Live tracks, flight numbers, corridors, and country relationships",
    },
    intelligence: {
      kicker: "Overview drill-down",
      title: "Event investigation",
      summary: "A selected event traced across reporting, observations, operations, and impact",
    },
    "earth-observation": {
      kicker: "Event evidence drill-down",
      title: "Satellite assessment",
      summary: "Event-scoped scenes, acquisition time, quality, provenance, and defensible comparisons",
    },
    admin: {
      kicker: "Control room",
      title: "Data operations",
      summary: "Service health, automation, manual runs, and audit history",
    },
    profile: {
      kicker: "Settings",
      title: "Profile & access",
      summary: "Identity, preferences, security, and connected providers",
    },
    legal: {
      kicker: "Reference",
      title: "Policies & usage",
      summary: "Product governance, privacy, terms, and data handling",
    },
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

  const handleSaveDailyBriefingSchedule = async () => {
    if (isSavingDailyBriefingSchedule) return;
    const scheduledTime = dailyBriefingScheduleDraft.scheduled_time.trim();
    const timezone = dailyBriefingScheduleDraft.timezone.trim() || getBrowserTimeZone();
    if (!isValidScheduleTime(scheduledTime)) {
      setDailyBriefingScheduleError("Use a valid 24-hour time, for example 07:30.");
      setDailyBriefingScheduleNotice(null);
      return;
    }

    setIsSavingDailyBriefingSchedule(true);
    setDailyBriefingScheduleError(null);
    setDailyBriefingScheduleNotice(null);
    try {
      const schedule = await updateDailyBriefingSchedule({
        enabled: dailyBriefingScheduleDraft.enabled,
        email_enabled: dailyBriefingScheduleDraft.email_enabled,
        email_theme: dailyBriefingScheduleDraft.email_theme,
        scheduled_time: scheduledTime,
        timezone,
        industries: dailyBriefingScheduleDraft.industries,
        company_symbols: dailyBriefingScheduleDraft.company_symbols,
        country_iso2s: dailyBriefingScheduleDraft.country_iso2s,
        regions: dailyBriefingScheduleDraft.regions,
        max_items: dailyBriefingScheduleDraft.max_items,
      });
      setDailyBriefingSchedule(schedule);
      setDailyBriefingScheduleDraft({
        enabled: schedule.enabled,
        email_enabled: schedule.email_enabled,
        email_theme: schedule.email_theme || "dark",
        scheduled_time: schedule.scheduled_time,
        timezone: schedule.timezone || timezone,
        industries: schedule.industries || [],
        company_symbols: schedule.company_symbols || [],
        country_iso2s: schedule.country_iso2s || [],
        regions: schedule.regions || [],
        max_items: schedule.max_items || 10,
      });
      setDailyBriefingScheduleNotice(
        schedule.email_enabled
          ? "Subscribed to daily briefing emails. Preferences saved."
          : "Not subscribed to daily briefing emails. Preferences saved.",
      );
    } catch (err) {
      setDailyBriefingScheduleError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingDailyBriefingSchedule(false);
    }
  };

  const handleSendDailyBriefingPreview = async () => {
    if (isSendingDailyBriefingPreview) return;
    const scheduledTime = dailyBriefingScheduleDraft.scheduled_time.trim();
    const timezone = dailyBriefingScheduleDraft.timezone.trim() || getBrowserTimeZone();
    if (!isValidScheduleTime(scheduledTime)) {
      setDailyBriefingScheduleError("Use a valid 24-hour time, for example 07:30.");
      setDailyBriefingScheduleNotice(null);
      return;
    }
    setIsSendingDailyBriefingPreview(true);
    setDailyBriefingScheduleError(null);
    setDailyBriefingScheduleNotice("Saving preferences and generating your preview…");
    try {
      const schedule = await updateDailyBriefingSchedule({
        enabled: dailyBriefingScheduleDraft.enabled,
        email_enabled: dailyBriefingScheduleDraft.email_enabled,
        email_theme: dailyBriefingScheduleDraft.email_theme,
        scheduled_time: scheduledTime,
        timezone,
        industries: dailyBriefingScheduleDraft.industries,
        company_symbols: dailyBriefingScheduleDraft.company_symbols,
        country_iso2s: dailyBriefingScheduleDraft.country_iso2s,
        regions: dailyBriefingScheduleDraft.regions,
        max_items: dailyBriefingScheduleDraft.max_items,
      });
      setDailyBriefingSchedule(schedule);
      let job = await sendPersonalBriefingPreview();
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (
          job.status === "failed" ||
          (job.status === "success" &&
            ["sent", "failed", "suppressed"].includes(job.delivery_status || ""))
        ) {
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        job = await fetchPersonalBriefingJob(job.id);
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Preview generation failed.");
      }
      if (job.delivery_status === "sent") {
        setDailyBriefingScheduleNotice(
          `Preview sent to ${dailyBriefingEmailStatus?.recipient || "your account email"}.`,
        );
      } else if (job.delivery_status === "suppressed") {
        throw new Error(
          "The preview was generated but email delivery was suppressed. Check that SMTP is configured and your account email is verified.",
        );
      } else if (job.delivery_status === "failed") {
        throw new Error("The preview was generated, but SMTP delivery failed and will be retried.");
      } else {
        setDailyBriefingScheduleNotice(
          "Preview generation is still running. It will be emailed when ready.",
        );
      }
    } catch (err) {
      setDailyBriefingScheduleNotice(null);
      setDailyBriefingScheduleError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingDailyBriefingPreview(false);
    }
  };

  const handleRequestEmailVerification = async () => {
    setDailyBriefingScheduleError(null);
    try {
      await requestEmailVerification();
      setDailyBriefingScheduleNotice("Verification email sent. Open the link in that email, then refresh this page.");
    } catch (err) {
      setDailyBriefingScheduleError(err instanceof Error ? err.message : String(err));
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
    <div className="app-shell app-safe-x min-h-[100dvh] w-full bg-[color:var(--shell-bg)] text-[color:var(--shell-ink)]">
      {mobileNavOpen && (
        <div className="app-safe-top app-safe-bottom fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="app-sidebar absolute left-0 top-0 h-full w-[min(20rem,88vw)] text-white">
            <div className="flex h-full flex-col">
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-14 flex-none">
                    <div className="absolute left-0 top-0 h-10 w-10 rounded-full bg-[color:var(--brand-mark-1)]" />
                    <div className="absolute left-2 top-0 h-10 w-10 rounded-full bg-[color:var(--brand-mark-2)] opacity-90" />
                    <div className="absolute left-4 top-0 h-10 w-10 rounded-full bg-[color:var(--brand-mark-3)] opacity-80" />
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
                  const active = activeView === item.view || (
                    item.view === "dashboard" &&
                    OVERVIEW_DRILLDOWN_VIEWS.has(activeView)
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveView(item.view);
                        setMobileNavOpen(false);
                      }}
                      aria-current={active ? "page" : undefined}
                      data-group={item.group}
                      className={`app-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                        active ? "" : "text-white/70 hover:bg-white/10 hover:text-white"
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
        <aside className="app-sidebar relative hidden border-r border-[color:var(--shell-sidebar-border)] text-white lg:flex lg:w-[18.5rem] lg:flex-col">
          <div className="px-6 pt-7 pb-5">
            <div className="flex items-center gap-3">
              <div className="relative h-11 w-16 flex-none">
                <div className="absolute left-0 top-0 h-11 w-11 rounded-full bg-[color:var(--brand-mark-1)]" />
                <div className="absolute left-2.5 top-0 h-11 w-11 rounded-full bg-[color:var(--brand-mark-2)] opacity-90" />
                <div className="absolute left-5 top-0 h-11 w-11 rounded-full bg-[color:var(--brand-mark-3)] opacity-80" />
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
              const active = activeView === item.view || (
                item.view === "dashboard" &&
                OVERVIEW_DRILLDOWN_VIEWS.has(activeView)
              );
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.view)}
                  aria-current={active ? "page" : undefined}
                  data-group={item.group}
                  className={`app-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                    active ? "" : "text-white/70 hover:bg-white/10 hover:text-white"
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
          <header className="app-safe-top app-topbar sticky top-0 z-20 border-b border-[color:var(--shell-border)]">
            <div className="mx-auto flex w-full max-w-[1720px] flex-wrap items-center gap-4 gap-y-2 px-4 py-4 sm:px-6 xl:px-8 2xl:px-10">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-ink)] shadow-sm"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2 lg:hidden">
                <div className="relative h-7 w-11 flex-none">
                  <div className="absolute left-0 top-0 h-7 w-7 rounded-full bg-[color:var(--brand-mark-1)]" />
                  <div className="absolute left-2 top-0 h-7 w-7 rounded-full bg-[color:var(--brand-mark-2)] opacity-90" />
                  <div className="absolute left-4 top-0 h-7 w-7 rounded-full bg-[color:var(--brand-mark-3)] opacity-80" />
                </div>
                <span
                  className="text-xs font-semibold tracking-[0.32em]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  CLARITAS
                </span>
              </div>

              <div className="page-header-copy min-w-0">
                <div className="page-kicker text-xs uppercase tracking-[0.22em] text-[color:var(--shell-muted)]">
                  {currentViewMeta.kicker}
                </div>
                <div className="page-title text-lg font-semibold text-[color:var(--shell-ink)]">
                  {currentViewMeta.title}
                </div>
                <div className="page-scope hidden text-xs text-[color:var(--shell-muted)] sm:block">
                  {currentViewMeta.summary}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-3">
                <div className="live-state hidden lg:flex items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--signal-emerald)]" />
                  <span className="font-semibold text-[color:var(--shell-ink)]">
                    Live
                  </span>
                  <span>Updated {latestEventLabel}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(false);
                    setSearchOpen(true);
                  }}
                  className="app-control hidden min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm text-[color:var(--shell-muted)] md:flex"
                  aria-label="Open search"
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <span className="w-36 truncate text-left lg:w-56">
                    {query || "Search signals"}
                  </span>
                  <span className="rounded-md border border-[color:var(--shell-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--shell-muted)]">
                    ⌘K
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(false);
                    setSearchOpen(true);
                  }}
                  className="app-control inline-flex h-10 w-10 items-center justify-center rounded-xl text-[color:var(--shell-ink)] md:hidden"
                  aria-label="Open search"
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setNotificationsOpen(true);
                  }}
                  className="app-control relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-[color:var(--shell-ink)]"
                  aria-label={`Open notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
                >
                  <Bell className="h-4 w-4" />
                  {unreadNotificationCount > 0 && (
                    <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-[color:var(--shell-accent)] px-1 text-[9px] font-bold text-[color:var(--shell-on-accent)]">
                      {unreadNotificationCount}
                    </span>
                  )}
                </button>
                <button
                  aria-label="Toggle dark mode"
                  onClick={() => setDark((v) => !v)}
                  className="app-control h-10 w-10 rounded-xl text-[color:var(--shell-ink)] hover:bg-[color:var(--shell-surface-strong)]"
                >
                  <span className="grid h-full w-full place-items-center">
                    {dark ? (
                      <Sun className="h-5 w-5" />
                    ) : (
                      <Moon className="h-5 w-5" />
                    )}
                  </span>
                </button>
                <div className="app-control hidden items-center gap-2 rounded-xl px-3 py-1 text-xs text-[color:var(--shell-muted)] sm:flex">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--signal-emerald)]" />
                  <span className="max-w-[160px] truncate">{userLabel}</span>
                </div>
              </div>
            </div>
          </header>

          {searchOpen && (
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-[color:var(--shell-sidebar)]/55 p-3 pt-[max(4rem,10vh)] backdrop-blur-sm sm:p-6"
              onClick={() => setSearchOpen(false)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label="Search signals"
                className="app-card flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center gap-3 border-b border-[color:var(--shell-border)] px-4 py-3">
                  <Search className="h-5 w-5 shrink-0 text-[color:var(--shell-muted)]" />
                  <input
                    autoFocus
                    className="min-w-0 flex-1 bg-transparent text-base text-[color:var(--shell-ink)] outline-none placeholder:text-[color:var(--shell-muted)]"
                    placeholder={searchInputPlaceholder}
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--shell-muted)] hover:bg-[color:var(--shell-surface-muted)] hover:text-[color:var(--shell-ink)]"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSearchOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--shell-border)] text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                    aria-label="Close search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--shell-border)] px-4 py-3">
                  {SEARCH_TOPIC_OPTIONS.map((option) => {
                    const active = effectiveSearchTopic === option.id;
                    return (
                      <button
                        key={`search-dialog-${option.id}`}
                        type="button"
                        onClick={() => handleSearchTopicChange(option.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          active
                            ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                            : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  <div className="ml-auto flex flex-wrap gap-3 text-xs text-[color:var(--shell-muted)]">
                    <span>{newsSearchScope.length} news</span>
                    <span>{podcastSearchScope.length} podcasts</span>
                    <span>{weatherSearchScope.length} weather</span>
                    <span>{marketCountryRows.length} markets</span>
                  </div>
                </div>

                <div className="app-scroll-panel min-h-0 flex-1 overflow-y-auto p-3">
                  {!hasSearchQuery ? (
                    <div className="grid min-h-48 place-items-center px-6 text-center">
                      <div>
                        <Search className="mx-auto h-7 w-7 text-[color:var(--shell-accent)]" />
                        <div className="mt-3 text-sm font-semibold text-[color:var(--shell-ink)]">
                          Search across the live signal desk
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
                          Find headlines, countries, weather conditions, companies, or market symbols.
                        </div>
                      </div>
                    </div>
                  ) : aiSearchPreview.length === 0 ? (
                    <div className="grid min-h-48 place-items-center px-6 text-center text-sm text-[color:var(--shell-muted)]">
                      No matching signals for this topic and query.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {aiSearchPreview.map((result) => (
                        <div
                          key={result.key}
                          className="flex items-start gap-2 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-2"
                        >
                          <button
                            type="button"
                            onClick={() => handleSearchResult(result)}
                            className="min-w-0 flex-1 rounded-md px-2 py-1 text-left hover:bg-[color:var(--signal-sky-soft)]"
                          >
                            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--shell-muted)]">
                              {result.kind}
                            </div>
                            <div className="mt-1 text-sm font-semibold leading-5 text-[color:var(--shell-ink)]">
                              {result.title}
                            </div>
                            {result.subtitle && (
                              <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
                                {result.subtitle}
                              </div>
                            )}
                          </button>
                          {result.href && (
                            <a
                              href={result.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[color:var(--shell-border)] text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                              aria-label={`Open ${result.title} in a new tab`}
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {notificationsOpen && (
            <div
              className="fixed inset-0 z-50 flex justify-end bg-[color:var(--shell-sidebar)]/45 backdrop-blur-sm"
              onClick={() => setNotificationsOpen(false)}
            >
              <aside
                role="dialog"
                aria-modal="true"
                aria-label="Signal notifications"
                className="app-card flex h-full w-full max-w-md flex-col rounded-none border-y-0 border-r-0"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start gap-3 border-b border-[color:var(--shell-border)] px-4 py-4">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--signal-amber-soft)] text-[color:var(--shell-ink)]">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[color:var(--shell-ink)]">
                      Signal notifications
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      {unreadNotificationCount} unread · {signalNotifications.length} active
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen(false)}
                    className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--shell-border)] text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                    aria-label="Close notifications"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-2 text-xs">
                  <span className="text-[color:var(--shell-muted)]">
                    Generated from live workspace signals
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setReadNotificationIds((current) => [
                        ...new Set([
                          ...current,
                          ...signalNotifications.map((notification) => notification.id),
                        ]),
                      ])
                    }
                    disabled={unreadNotificationCount === 0}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-[color:var(--shell-ink)] hover:bg-[color:var(--shell-surface-muted)] disabled:opacity-40"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                </div>

                <div className="app-scroll-panel min-h-0 flex-1 overflow-y-auto p-3">
                  {signalNotifications.length === 0 ? (
                    <div className="grid min-h-64 place-items-center px-6 text-center">
                      <div>
                        <CheckCheck className="mx-auto h-7 w-7 text-[color:var(--shell-accent-2)]" />
                        <div className="mt-3 text-sm font-semibold text-[color:var(--shell-ink)]">
                          No active notifications
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
                          Briefings, anomalies, major market moves, and system issues will appear here.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {signalNotifications.map((notification) => {
                        const unread = !readNotificationIds.includes(notification.id);
                        return (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => handleNotificationClick(notification)}
                            className={`w-full rounded-lg border p-3 text-left transition hover:border-[color:var(--shell-border-strong)] ${
                              unread
                                ? "border-[color:var(--shell-accent)] bg-[color:var(--signal-amber-soft)]"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)]"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                                  notification.tone === "critical"
                                    ? "bg-[color:var(--signal-rose)]"
                                    : notification.tone === "attention"
                                      ? "bg-[color:var(--signal-amber)]"
                                      : "bg-[color:var(--signal-sky)]"
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                                  {notification.title}
                                </div>
                                <div className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">
                                  {notification.description}
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                                  <span>{notification.timeLabel}</span>
                                  <span>Open {notification.view}</span>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}

          <main
            data-view={activeView}
            className="app-workspace app-safe-bottom mx-auto w-full max-w-[1720px] flex-1 min-h-0 flex flex-col px-4 py-4 sm:px-6 xl:px-8 2xl:px-10"
          >
            {sessionNotice && (
              <div className="mb-6">
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    sessionNotice.tone === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : sessionNotice.tone === "success"
                        ? "border-[color:var(--signal-emerald)] bg-[color:var(--signal-emerald-soft)] text-[color:var(--shell-ink)]"
                        : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
                  }`}
                >
                  {sessionNotice.message}
                </div>
              </div>
            )}

            {hasActiveSelection && (
              <div className="mb-4">
                <div className="selection-bar flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-4 py-3 text-xs text-[color:var(--shell-muted)]">
                  <span className="uppercase tracking-[0.3em]">Selection</span>
                  {selectedCountry && (
                    <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-[color:var(--shell-ink)]">
                      Country: {selectedCountry.toUpperCase()}
                    </span>
                  )}
                  {comparisonCountry && (
                    <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-[color:var(--shell-ink)]">
                      Compare: {comparisonCountry.toUpperCase()}
                    </span>
                  )}
                  {pinnedCountry && (
                    <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-[color:var(--shell-ink)]">
                      Pinned: {pinnedCountry.toUpperCase()}
                    </span>
                  )}
                  {selectedSymbol && (
                    <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-[color:var(--shell-ink)]">
                      Symbol: {selectedSymbol.toUpperCase()}
                    </span>
                  )}
                  {selectedIntelligenceEventId && (
                    <button
                      type="button"
                      onClick={() => handleOpenIntelligence(selectedIntelligenceEventId)}
                      className="rounded-full border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-3 py-1 font-semibold text-[color:var(--shell-ink)]"
                      title={selectedIntelligenceEventId}
                    >
                      Event investigation: {selectedIntelligenceEventId.slice(0, 8)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="ml-auto rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                  >
                    Reset selection
                  </button>
                </div>
              </div>
            )}

            {OVERVIEW_DRILLDOWN_VIEWS.has(activeView) && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView("dashboard")}
                  className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm font-semibold text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back to overview map
                </button>
                {activeView === "earth-observation" && selectedIntelligenceEventId && (
                  <button
                    type="button"
                    onClick={() => setActiveView("intelligence")}
                    className="inline-flex items-center gap-2 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm font-semibold text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                  >
                    Back to event investigation
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {activeView === "dashboard" && (
              <div className="workspace-page dashboard-workspace relative flex flex-col gap-4">
                <div className="relative flex flex-col gap-4">
                  <div
                    className="kpi-strip dashboard-kpis app-card-hero dashboard-panel order-[3] rounded-xl px-4 py-3"
                    style={{ animationDelay: "0ms" }}
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_repeat(4,minmax(7.25rem,0.5fr))] lg:items-center">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[color:var(--shell-muted)]">
                          Global operations · {regionLabel}
                        </div>
                        <div
                          className="mt-1 text-base font-semibold text-[color:var(--shell-ink)]"
                        >
                          {signalNotifications.length} current signals need attention
                        </div>
                        <p className="mt-1 max-w-2xl text-xs text-[color:var(--shell-muted)] sm:text-sm">
                          {activeRangeLabel} · Latest source update {latestEventLabel}
                        </p>
                      </div>
                      <div className="app-stat-card rounded-lg px-3 py-2">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
                          News pace
                        </div>
                        <div className="metric-value mt-1 text-xl font-semibold text-[color:var(--shell-ink)]">
                          {formatMetricNumber(newsSummary.avgPerDay)}
                        </div>
                        <div className="text-[11px] text-[color:var(--shell-muted)]">
                          Stories/day
                        </div>
                      </div>
                      <div className="app-stat-card rounded-lg px-3 py-2">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
                          Weather mean
                        </div>
                        <div className="metric-value mt-1 text-xl font-semibold text-[color:var(--shell-ink)]">
                          {formatMetricNumber(weatherSummary.avgTemp)}°C
                        </div>
                        <div className="text-[11px] text-[color:var(--shell-muted)]">
                          Current scope
                        </div>
                      </div>
                      <div className="app-stat-card rounded-lg px-3 py-2">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
                          Market breadth
                        </div>
                        <div className="metric-value mt-1 text-xl font-semibold text-[color:var(--shell-ink)]">
                          {marketSummary.gainers}/{marketSummary.losers}
                        </div>
                        <div className="text-[11px] text-[color:var(--shell-muted)]">
                          Gainers/losers
                        </div>
                      </div>
                      <div className="app-stat-card rounded-lg px-3 py-2">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
                          Podcast evidence
                        </div>
                        <div className="metric-value mt-1 text-xl font-semibold text-[color:var(--shell-ink)]">
                          {podcastSummary.signals}
                        </div>
                        <div className="text-[11px] text-[color:var(--shell-muted)]">
                          Across {podcastSummary.episodes} episodes
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="operational-control-bar dashboard-panel order-[4] rounded-xl px-4 py-3"
                    style={{ animationDelay: "40ms" }}
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
                                  ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                  : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
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
                    </div>
                    <div className="mt-3 grid gap-3 md:hidden">
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
                                  ? "bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
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
                      <div className="mt-3 w-full text-xs text-[color:var(--viz-negative)]">
                        {friendlyWorkspaceError(newsLoadError)}
                      </div>
                    )}
                  </div>

                  <section
                    className={`${cardBase} briefing-rail dashboard-panel order-[5] p-4`}
                    style={{ animationDelay: "80ms" }}
                  >
                    <details className="group">
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              <FileText className="h-3.5 w-3.5" />
                              Daily briefing · map context
                            </div>
                            <div className="mt-1 truncate text-base font-semibold text-[color:var(--shell-ink)]">
                              {dailyBriefing?.title ?? "Daily signal brief"}
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-col gap-1 text-xs text-[color:var(--shell-muted)] lg:max-w-2xl lg:items-end">
                            <span>
                              {dailyBriefing?.published_at
                                ? `Published ${formatExactTimestamp(dailyBriefing.published_at)}`
                                : "No published briefing"}
                            </span>
                            <span className="line-clamp-1 text-[color:var(--shell-ink)]">
                              {dailyBriefing?.key_takeaways?.[0] ??
                                (dailyBriefingError ? "Briefing unavailable." : "Takeaways pending.")}
                            </span>
                            <span className="inline-flex items-center gap-1 self-start font-semibold text-[color:var(--shell-accent-2)] lg:self-auto">
                              Open full briefing
                              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                            </span>
                          </div>
                        </div>
                      </summary>
                      <div className="mt-4 grid gap-4 border-t border-[color:var(--shell-border)] pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                            <span>{dailyBriefing ? dailyBriefingDateLabel : "No published briefing"}</span>
                            {dailyBriefing?.generated_by && <span>{dailyBriefing.generated_by}</span>}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-[color:var(--shell-muted)]">
                            {dailyBriefing?.update_text ||
                              (dailyBriefingError ? "Briefing unavailable." : "Awaiting briefing.")}
                          </p>
                          <div className="briefing-source-links mt-3">
                            <span>Linked evidence</span>
                            <button type="button" onClick={() => setActiveView("podcasts")}>
                              <Podcast className="h-3.5 w-3.5" />
                              <strong>Podcast</strong>
                              <small>{podcastSummary.signals} signals · {podcastSummary.evidence} excerpts</small>
                            </button>
                          </div>
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--shell-muted)]">Key takeaways</div>
                          {dailyBriefing?.key_takeaways?.length ? (
                            <ul className="mt-2 space-y-2 text-sm text-[color:var(--shell-ink)]">
                              {dailyBriefing.key_takeaways.map((item, idx) => (
                                <li key={`${dailyBriefing.id}-takeaway-${idx}`} className="flex gap-2">
                                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--signal-amber)]" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-2 text-sm text-[color:var(--shell-muted)]">Takeaways pending.</div>
                          )}
                        </div>
                      </div>
                    </details>
                  </section>

                  <section
                    className={`analytics-workspace-grid relative order-[1] grid gap-4 ${
                      splitViewEnabled
                        ? "xl:grid-cols-12 xl:items-stretch"
                        : "grid-cols-1"
                    }`}
                  >
                    <div
                      id="signal-map-feed"
                      className={`${dashboardPanelClass} geo-panel dashboard-map-panel xl:col-span-8`}
                      style={{
                        animationDelay: "0ms",
                        gridColumn: splitViewEnabled ? "span 8 / span 8" : undefined,
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--shell-border)] px-3 py-2.5">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Global event picture
                          </div>
                          <div className="text-sm font-semibold">
                            Map:{" "}
                            {mapMode === "signals"
                              ? `${overviewEventPoints.length} located events · ${overviewEventPoints.filter((point) => point.hasImagery).length} with imagery`
                              : mapMode === "news"
                                ? "#News per country"
                                : "Weather (temperature) per country"}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-[color:var(--shell-muted)]">
                            <span>Dots = canonical events</span>
                            <span>Dashed rings = imagery available</span>
                            <span>Country fill = context layer</span>
                          </div>
                        </div>
                        <div className="map-mode-tabs flex flex-wrap items-center gap-2 text-xs">
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              mapMode === "signals"
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setMapMode("signals")}
                          >
                            Event context
                          </button>
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              mapMode === "news"
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
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
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
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
                      <div className="map-analysis-controls flex flex-wrap items-center gap-2 border-b border-[color:var(--shell-border)] px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {REGION_OPTIONS.map((region) => {
                            const active = regionFilter === region.id;
                            return (
                              <button
                                key={region.id}
                                onClick={() => setRegionFilter(region.id)}
                                className={`rounded-full border px-2.5 py-1 transition ${
                                  active
                                    ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
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
                            onClick={() => setCompareMode((v) => !v)}
                            className={`rounded-full border px-3 py-1 transition ${
                              compareMode
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
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
                          {hasActiveSelection && (
                            <button
                              onClick={handleClearSelection}
                              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                      {compareMode && (
                        <div className="px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                          Compare mode: click a second country
                        </div>
                      )}
                      <div className="relative flex-1 min-h-0 p-3">
                        <div
                          className={`app-map-frame relative min-h-0 ${
                            splitViewEnabled
                              ? "h-[clamp(24rem,50vh,36rem)]"
                              : "h-[58vh] max-h-[30rem] min-h-[20rem]"
                          }`}
                        >
                          <WorldMapBubbles
                            variant="compact"
                            data={activeMapData}
                            onSelect={handleMapSelect}
                            points={overviewEventPoints}
                            onSelectPoint={(point) => handleOpenIntelligence(point.id)}
                            dark={dark}
                            primaryCountry={selectedCountry}
                            secondaryCountry={comparisonCountry}
                            pinnedCountry={pinnedCountry}
                            featuredCountry={
                              mapMode === "signals"
                                ? highestSignalCountry?.country
                                : mapMode === "news"
                                  ? highestMapNewsCountry?.country
                                  : mostExtremeWeatherCountry?.country
                            }
                            featuredLabel={
                              mapMode === "signals"
                                ? "Highest signal relevance"
                                : mapMode === "news"
                                  ? "Highest story concentration"
                                  : "Most extreme temperature"
                            }
                            scale={
                              mapMode === "news" || mapMode === "signals"
                                ? "log"
                                : "linear"
                            }
                            fillMode={
                              mapMode === "weather" ? "temperature" : "relevance"
                            }
                            valueDomain={
                              mapMode === "signals"
                                ? [0, 100]
                                : mapMode === "news"
                                  ? [0, Math.max(1, ...mapBubbleData.map((row) => row.count))]
                                  : [-30, 45]
                            }
                            valueUnit={mapMode === "signals" ? "/100" : mapMode === "weather" ? "°C" : ""}
                            showBubbles={false}
                            showLabels
                            legendLabel={activeMapLegendLabel}
                          />
                        </div>
                        {pinnedCountry && (
                          <div className="app-card-muted absolute bottom-3 right-3 w-56 rounded-lg p-3 text-xs">
                            <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Pinned
                            </div>
                            <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                              {pinnedMeta?.name
                                ? `${pinnedMeta.name} (${pinnedCountry.toUpperCase()})`
                                : pinnedCountry.toUpperCase()}
                            </div>
                            {mapMode === "signals" ? (
                              <>
                                <div className="mt-2 text-[color:var(--shell-muted)]">
                                  Relevance: {pinnedSignalSummary?.count ?? 0}/100
                                </div>
                                {pinnedSignalSummary?.meta?.lines?.map((line) => (
                                  <div
                                    key={`pinned-signal-${line}`}
                                    className="text-[color:var(--shell-muted)]"
                                  >
                                    {line}
                                  </div>
                                ))}
                              </>
                            ) : mapMode === "news" ? (
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
                        {mapMode === "signals" &&
                          crossSourceMapData.length === 0 && (
                            <div className="absolute bottom-4 right-4 rounded border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-xs text-[color:var(--shell-muted)]">
                              No linked cross-source signals in this scope.
                            </div>
                          )}
                        {overviewEventsError && (
                          <div className="absolute bottom-4 left-4 rounded border border-rose-400/40 bg-[color:var(--shell-surface)] px-2 py-1 text-xs text-rose-600">
                            {friendlyWorkspaceError(overviewEventsError)}
                          </div>
                        )}
                        {mapMode === "news" &&
                          mapBubbleData.length === 0 && (
                            <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-[color:var(--shell-surface)] px-2 py-1 rounded border border-[color:var(--shell-border)]">
                              {useDatabaseCountryStats && countryStatsCoverage?.total
                                ? "No country-tagged news in the selected window."
                                : "No news data in the selected window."}
                            </div>
                          )}
                        {mapMode === "weather" &&
                          mapWeatherScope.length === 0 && (
                            <div className="absolute bottom-4 right-4 text-xs text-[color:var(--shell-muted)] bg-[color:var(--shell-surface)] px-2 py-1 rounded border border-[color:var(--shell-border)] flex items-center gap-2">
                              <span>No weather stats yet.</span>
                              {isAdmin ? (
                                <button
                                  onClick={() => setActiveView("admin")}
                                  className="px-2 py-0.5 rounded border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] hover:bg-[color:var(--signal-sky-soft)]"
                                >
                                  Open admin ingest
                                </button>
                              ) : (
                                <span>Admin ingestion required.</span>
                              )}
                            </div>
                          )}
                      </div>
                      <div className="dashboard-map-footer border-t border-[color:var(--shell-border)] px-3 py-2 text-xs">
                        {mapMode === "signals" ? (
                          <div className="flex flex-wrap items-center gap-2 text-[color:var(--shell-muted)]">
                            <span className="font-semibold text-[color:var(--shell-ink)]">
                              Event evidence model
                            </span>
                            <span>
                              Select a located event to open its news, official feeds,
                              transport, weather, market and satellite evidence as one thread.
                            </span>
                            {highestSignalCountry && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCountry(highestSignalCountry.country)
                                }
                                className="ml-auto font-semibold text-[color:var(--shell-accent-2)]"
                              >
                                Explore #1 {highestSignalCountry.country} ·{" "}
                                {highestSignalCountry.count}/100
                              </button>
                            )}
                          </div>
                        ) : mapMode === "news" ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                              Coverage window
                            </span>
                            {!activeRange && (
                              <>
                                <span className="text-[color:var(--shell-muted)]">
                                  {mapWindowDays}d
                                </span>
                                <input
                                  type="range"
                                  min={MAP_WINDOW_MIN}
                                  max={MAP_WINDOW_MAX}
                                  value={mapWindowDays}
                                  aria-label="News map coverage window in days"
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
                            {useDatabaseCountryStats && countryStatsCoverage && (
                              <span className="text-[color:var(--shell-muted)]">
                                {countryStatsCoverage.mapped.toLocaleString()} /{" "}
                                {countryStatsCoverage.total.toLocaleString()} stories mapped
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[color:var(--shell-muted)]">
                            Coverage windows apply to the news layer. Weather uses
                            the latest observation for each country.
                          </div>
                        )}
                      </div>
                    </div>

                    <section
                      className={`${dashboardPanelClass} context-intelligence-band max-h-[clamp(28rem,62vh,46rem)] xl:col-span-4`}
                      style={{
                        animationDelay: "40ms",
                        gridColumn: splitViewEnabled ? "span 4 / span 4" : undefined,
                      }}
                    >
                      {selectedCountryContext ? (
                        <>
                          <div className="flex items-start gap-3 border-b border-[color:var(--shell-border)] px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                                Country profile · {selectedCountryContext.iso}
                              </div>
                              <div className="mt-0.5 text-lg font-semibold text-[color:var(--shell-ink)]">
                                {selectedCountryContext.meta?.name ??
                                  selectedCountryContext.iso}
                              </div>
                              <div className="text-xs text-[color:var(--shell-muted)]">
                                {[
                                  selectedCountryContext.meta?.region,
                                  selectedCountryContext.meta?.subregion,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "Global country context"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedCountry(null)}
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:text-[color:var(--shell-ink)]"
                              aria-label="Close country profile"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="country-profile-scroll app-scroll-panel min-h-0 flex-1 overflow-y-auto">
                            <SatelliteContextPanel
                              country={selectedCountryContext.iso}
                              compact
                              onOpenEvent={handleOpenIntelligence}
                              onOpenImagery={(eventId) => handleOpenImagery(eventId)}
                            />
                            <div
                              className="country-profile-metrics"
                              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                            >
                              <div>
                                <span>Relevance</span>
                                <strong>
                                  {selectedCountryContext.relevanceScore}/100
                                </strong>
                                <small>cross-source rank</small>
                              </div>
                              <div>
                                <span>News</span>
                                <strong>{selectedCountryContext.newsCount}</strong>
                                <small>mapped stories</small>
                              </div>
                              <div>
                                <span>Weather</span>
                                <strong>
                                  {selectedCountryContext.temperature == null
                                    ? "—"
                                    : `${formatMetricNumber(
                                        selectedCountryContext.temperature,
                                      )}°`}
                                </strong>
                                <small>
                                  {relatedWeather?.weather_main ??
                                    "No observation"}
                                </small>
                              </div>
                              <div>
                                <span>Podcast</span>
                                <strong>
                                  {relatedPodcastLink?.signalCount ?? 0}
                                </strong>
                                <small>attributed signals</small>
                              </div>
                              <div>
                                <span>Leadership</span>
                                <strong>
                                  {selectedLeadershipProfile?.roles.length ?? 0}
                                </strong>
                                <small>current officeholders</small>
                              </div>
                              <div>
                                <span>Markets</span>
                                <strong>{formatSignedMetric(relatedMarketCountry?.composite_change_percent, 1, "%")}</strong>
                                <small>{relatedMarketCountry ? `${relatedMarketCountry.composite_basis.length} regime inputs` : "No country regime"}</small>
                              </div>
                              <div>
                                <span>Transport</span>
                                <strong>{relatedTransport?.active_count ?? 0}</strong>
                                <small>
                                  {(relatedTransport?.trend.ship_departures.current ?? 0) +
                                    (relatedTransport?.trend.tracked_flights.current ?? 0)}{" "}
                                  24h movements
                                </small>
                              </div>
                            </div>

                            <section className="country-profile-section">
                              <div className="country-profile-section-heading">
                                <ChartNoAxesCombined className="h-4 w-4" />
                                <span>Why this country is relevant</span>
                                <small>
                                  {selectedCountryContext.relevanceScore > 0
                                    ? "weighted cross-source evidence"
                                    : "no active linked drivers"}
                                </small>
                              </div>
                              <div className="country-relevance-drivers">
                                {selectedCountryContext.relevanceDrivers.map(
                                  (driver) => (
                                    <span key={`country-driver-${driver}`}>
                                      {driver}
                                    </span>
                                  ),
                                )}
                                {selectedCountryContext.relevanceDrivers.length ===
                                  0 && (
                                  <div className="product-state">
                                    No active cross-source drivers for this
                                    country in the selected scope.
                                  </div>
                                )}
                              </div>
                            </section>

                            <section className="country-profile-section">
                              <div className="country-profile-section-heading">
                                <Newspaper className="h-4 w-4" />
                                <span>News concentration</span>
                                <small>
                                  {selectedCountryContext.topSource ??
                                    "Source mix unavailable"}
                                </small>
                              </div>
                              <div className="country-profile-bar">
                                <span
                                  style={{
                                    width: `${Math.max(
                                      2,
                                      selectedCountryContext.newsIntensity,
                                    )}%`,
                                  }}
                                />
                              </div>
                              <div className="country-profile-scale">
                                <span>Relative to highest-volume country</span>
                                <strong>
                                  {formatMetricNumber(
                                    selectedCountryContext.newsIntensity,
                                  )}
                                  %
                                </strong>
                              </div>
                            </section>

                            {relatedPodcastLink && (
                              <section className="country-profile-section">
                                <div className="country-profile-section-heading">
                                  <Podcast className="h-4 w-4" />
                                  <span>Podcast evidence</span>
                                  <small>
                                    {relatedPodcastLink.episodeIds.size}{" "}
                                    {relatedPodcastLink.episodeIds.size === 1
                                      ? "episode"
                                      : "episodes"}{" "}
                                    · {relatedPodcastLink.evidenceIds.size} evidence
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  className="country-podcast-link"
                                  onClick={() => setActiveView("podcasts")}
                                >
                                  <span>
                                    <strong>
                                      {relatedPodcastLink.topSignal?.title ??
                                        "Linked podcast finding"}
                                    </strong>
                                    <small>
                                      Attributed to{" "}
                                      {relatedPodcastLink.topEpisode?.feed_title ??
                                        "podcast source"}
                                      . Review the transcript evidence before
                                      treating a claim as verified.
                                    </small>
                                  </span>
                                  <ArrowUpRight className="h-4 w-4" />
                                </button>
                              </section>
                            )}

                            <section className="country-profile-section">
                              <div className="country-profile-section-heading">
                                <CloudSun className="h-4 w-4" />
                                <span>Weather now</span>
                                <small>
                                  {relatedWeather?.observed_at
                                    ? new Date(
                                        relatedWeather.observed_at,
                                      ).toLocaleString()
                                    : "No current observation"}
                                </small>
                              </div>
                              <div className="country-weather-visual">
                                <div>
                                  <span>Temperature</span>
                                  <div className="temperature-track">
                                    <span
                                      style={{
                                        left: `${selectedCountryContext.temperaturePosition}%`,
                                      }}
                                    />
                                  </div>
                                  <small>−30°C</small>
                                  <small>50°C</small>
                                </div>
                                <div>
                                  <span>Humidity</span>
                                  <div className="humidity-track">
                                    <span
                                      style={{
                                        width: `${
                                          selectedCountryContext.humidity ?? 0
                                        }%`,
                                      }}
                                    />
                                  </div>
                                  <strong>
                                    {selectedCountryContext.humidity == null
                                      ? "—"
                                      : `${formatMetricNumber(
                                          selectedCountryContext.humidity,
                                        )}%`}
                                  </strong>
                                </div>
                              </div>
                              {relatedWeather && (
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                                  <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><span className="text-[color:var(--shell-muted)]">Feels like</span><strong className="mt-1 block">{formatMetricNumber(relatedWeather.apparent_temp_c)}°C</strong></div>
                                  <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><span className="text-[color:var(--shell-muted)]">Wind / gust</span><strong className="mt-1 block">{formatMetricNumber(relatedWeather.wind_speed)} / {formatMetricNumber(relatedWeather.wind_gust)} m/s</strong></div>
                                  <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><span className="text-[color:var(--shell-muted)]">Air quality</span><strong className="mt-1 block">{relatedWeather.air_quality?.label ?? "—"}</strong></div>
                                  <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><span className="text-[color:var(--shell-muted)]">Next-day range</span><strong className="mt-1 block">{relatedWeather.forecast?.[0] ? `${formatMetricNumber(relatedWeather.forecast[0].temp_min_c)}–${formatMetricNumber(relatedWeather.forecast[0].temp_max_c)}°C` : "—"}</strong></div>
                                  <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><span className="text-[color:var(--shell-muted)]">Rain risk</span><strong className="mt-1 block">{relatedWeather.forecast?.[0]?.precipitation_probability ?? "—"}%</strong></div>
                                  <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><span className="text-[color:var(--shell-muted)]">Official alerts</span><strong className="mt-1 block">{relatedWeather.alert_count ?? relatedWeather.alerts?.length ?? 0}</strong></div>
                                </div>
                              )}
                            </section>

                            <section className="country-profile-section">
                              <div className="country-profile-section-heading">
                                <ChartNoAxesCombined className="h-4 w-4" />
                                <span>Market regime</span>
                                <small>{relatedMarketCountry?.freshness ?? "unavailable"} · market + macro context</small>
                              </div>
                              {relatedMarketCountry ? (
                                <>
                                  <div className="country-transport-grid">
                                    <div><span>{relatedMarketCountry.index_source ?? "National benchmark"}</span><strong>{formatSignedMetric(relatedMarketCountry.index_change_percent, 2, "%")}</strong><small>{relatedMarketCountry.index_frequency ?? "unknown frequency"} · {relatedMarketCountry.index_period_end ?? "No period"}</small></div>
                                    <div><span>{relatedMarketCountry.currency ?? "FX"} vs EUR</span><strong>{formatSignedMetric(relatedMarketCountry.fx_change_percent, 2, "%")}</strong><small>{relatedMarketCountry.fx_period_end ?? "No period"}</small></div>
                                    <div><span>SEC activity</span><strong>{relatedMarketCountry.filing_count_7d}</strong><small>filings · trailing 7d</small></div>
                                    <div><span>GDP growth</span><strong>{formatSignedMetric(relatedMarketCountry.gdp_growth, 1, "%")}</strong><small>World Bank · {relatedMarketCountry.macro_latest_year ?? "year unavailable"}</small></div>
                                    <div><span>Inflation</span><strong>{relatedMarketCountry.inflation == null ? "—" : `${formatMetricNumber(relatedMarketCountry.inflation, { maximumFractionDigits: 1 })}%`}</strong><small>annual consumer prices</small></div>
                                    <div><span>Current account</span><strong>{formatSignedMetric(relatedMarketCountry.current_account, 1, "% GDP")}</strong><small>external-balance context</small></div>
                                  </div>
                                  <p className="country-transport-note">OECD and ECB form the directional regime; annual World Bank indicators remain a separate macro layer so unlike frequencies are never silently blended.</p>
                                  <button type="button" className="country-transport-open" onClick={() => setActiveView("markets")}>Open market analysis <ArrowUpRight className="h-3.5 w-3.5" /></button>
                                </>
                              ) : (
                                <div className="product-state">No configured benchmark, ECB currency or SEC country event is mapped for this country yet.</div>
                              )}
                            </section>

                            {relatedTransport && (
                              <section className="country-profile-section">
                                <div className="country-profile-section-heading">
                                  <Route className="h-4 w-4" />
                                  <span>Transport movement</span>
                                  <small>24h compared with previous 24h</small>
                                </div>
                                <div className="country-transport-grid">
                                  {[
                                    {
                                      label: "Ship departures",
                                      metric: relatedTransport.trend.ship_departures,
                                    },
                                    {
                                      label: "Cargo vessels",
                                      metric:
                                        relatedTransport.trend
                                          .cargo_vessel_departures,
                                    },
                                    {
                                      label: "Tracked flights",
                                      metric: relatedTransport.trend.tracked_flights,
                                    },
                                  ].map(({ label, metric }) => (
                                    <div key={label}>
                                      <span>{label}</span>
                                      <strong>{metric.current}</strong>
                                      <small data-direction={metric.direction}>
                                        {metric.direction === "new"
                                          ? "New baseline"
                                          : metric.change_pct == null
                                            ? "No comparison"
                                            : formatSignedMetric(
                                                metric.change_pct,
                                                1,
                                                "%",
                                              )}
                                      </small>
                                    </div>
                                  ))}
                                </div>
                                <p className="country-transport-note">
                                  Cargo-vessel departures are an AIS movement
                                  proxy, not measured cargo tonnage.
                                </p>
                                <button
                                  type="button"
                                  className="country-transport-open"
                                  onClick={() => setActiveView("transport")}
                                >
                                  Open live transport detail
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </button>
                              </section>
                            )}

                            <section className="country-profile-section">
                              <div className="country-profile-section-heading">
                                <User className="h-4 w-4" />
                                <span>Current leadership</span>
                                <small>
                                  {selectedLeadershipProfile?.government_type ??
                                    "Government type unavailable"}
                                </small>
                              </div>
                              <div className="country-leadership-list">
                                {selectedLeadershipProfile?.roles.map((role) => (
                                  <div
                                    key={`${role.role_type}-${role.person_wikidata_id}`}
                                  >
                                    <span>
                                      {role.role_type === "head_of_state"
                                        ? "Head of state"
                                        : "Head of government"}
                                    </span>
                                    <strong>
                                      {getLeadershipDisplayName(role.person_name)}
                                    </strong>
                                    <small>
                                      {role.started_at
                                        ? `In office since ${new Date(
                                            role.started_at,
                                          ).toLocaleDateString()}`
                                        : "Term start unavailable"}
                                    </small>
                                  </div>
                                ))}
                                {!selectedLeadershipProfile?.roles.length && (
                                  <div className="product-state">
                                    Current leadership has not been retrieved for
                                    this country.
                                  </div>
                                )}
                              </div>
                            </section>

                          </div>

                          <div className="country-profile-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setListMode("news");
                                requestAnimationFrame(() => {
                                  dashboardFeedPanelRef.current?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start",
                                  });
                                });
                              }}
                            >
                              View country news below
                              <Newspaper className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveView("transport")}
                            >
                              Open scoped transport
                              <Route className="h-3.5 w-3.5" />
                            </button>
                            {relatedPodcastLink && (
                              <button
                                type="button"
                                onClick={() => setActiveView("podcasts")}
                              >
                                Open podcast evidence
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="app-scroll-panel min-h-0 flex-1 overflow-y-auto">
                          <SatelliteContextPanel
                            country={selectedCountry}
                            compact
                            onOpenEvent={handleOpenIntelligence}
                            onOpenImagery={(eventId) => handleOpenImagery(eventId)}
                          />
                        </div>
                      )}
                    </section>

                    <div
                      className="order-[3] xl:col-span-12"
                      style={{ gridColumn: "1 / -1" }}
                    >
                      <IntelligenceEventStrip
                        country={selectedCountry}
                        onOpen={handleOpenIntelligence}
                      />
                    </div>

                    <div
                      ref={dashboardFeedPanelRef}
                      className={`${dashboardPanelClass} feed-panel xl:col-span-12`}
                      style={{ animationDelay: "80ms" }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--shell-border)] px-3 py-2.5">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Live feed
                          </div>
                          <div className="text-sm font-semibold">
                            Latest intelligence drops
                          </div>
                          <div className="text-xs text-[color:var(--shell-muted)]">
                            {regionLabel} · latest source update {latestEventLabel}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              listMode === "news"
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setListMode("news")}
                          >
                            News
                          </button>
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              listMode === "weather"
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setListMode("weather")}
                          >
                            Weather
                          </button>
                          <button
                            className={`rounded-full border px-3 py-1 transition ${
                              listMode === "market"
                                ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                            }`}
                            onClick={() => setListMode("market")}
                          >
                            Markets
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveView(
                                listMode === "news"
                                  ? "news"
                                  : listMode === "weather"
                                    ? "weather"
                                    : "markets",
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                          >
                            Open {listMode} workspace
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="h-[clamp(20rem,42vh,28rem)] min-h-0 overflow-hidden">
                        {listMode === "news" ? (
                          <div
                            ref={feedRef}
                            className="dashboard-news-stream app-scroll-panel h-full overflow-y-auto"
                          >
                            <PriorityNewsList
                              items={filteredNews}
                              selectedId={selectedDashboardNewsId}
                              primaryCountry={selectedCountry}
                              secondaryCountry={comparisonCountry}
                              getImageUrl={(item) =>
                                imageProxy(getNewsImageUrl(item))
                              }
                              getSourceLabel={getSourceLabel}
                              getCountryName={(iso) =>
                                countryMeta.get(iso)?.name ?? iso
                              }
                              onToggle={(item, iso) => {
                                const nextId =
                                  selectedDashboardNewsId === item.id
                                    ? null
                                    : item.id;
                                setSelectedDashboardNewsId(nextId);
                                if (nextId && iso) setSelectedCountry(iso);
                              }}
                              onRequestTranslation={requestNewsTranslationSummary}
                              translationPendingIds={newsTranslationPendingIds}
                              onSelectCountry={setSelectedCountry}
                              onOpenWorkspace={() => setActiveView("news")}
                              onOpenEvent={handleOpenIntelligence}
                              emptyState={
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
                                        {isLoadingNews ? "Loading…" : "Load all data"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              }
                            />
                          </div>
                        ) : listMode === "weather" ? (
                          <div className="app-scroll-panel h-full overflow-y-auto p-4 space-y-4">
                            
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
                                  className="ml-auto rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-ink)] hover:bg-[color:var(--signal-sky-soft)]"
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
                                    <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[color:var(--shell-muted)]">
                                      {(w.country || "").toUpperCase()}
                                    </span>
                                    <span className="text-sm text-[color:var(--shell-ink)]">
                                      {new Date(w.observed_at).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-4 text-sm text-[color:var(--shell-ink)]">
                                    <span title="Temperature">
                                      🌡️ {w.temp_c ?? "—"}°C
                                    </span>
                                    <span title="Humidity">
                                      💧 {w.humidity ?? "—"}%
                                    </span>
                                    {w.weather_main && (
                                      <span className="text-[color:var(--shell-muted)]">
                                        {w.weather_main}
                                      </span>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="app-scroll-panel h-full overflow-y-auto p-4 space-y-4">
                            
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <div className="text-[color:var(--shell-muted)]">
                                Country regimes from configured benchmarks, ECB and SEC
                              </div>
                              <div className="ml-auto text-xs text-[color:var(--shell-muted)]">
                                {marketCountryRows.length} countries
                              </div>
                            </div>
                            <ul className="list-none divide-y divide-[color:var(--shell-border)]">
                              {marketCountryRows.length === 0 && (
                                <li className="text-sm text-[color:var(--shell-muted)] py-3">
                                  No country market regimes match this scope.
                                </li>
                              )}
                              {marketCountryRows.map((row) => {
                                const isPositive =
                                  typeof row.composite_change_percent === "number" && row.composite_change_percent > 0;
                                const isNegative =
                                  typeof row.composite_change_percent === "number" && row.composite_change_percent < 0;
                                return (
                                  <li
                                    key={`dashboard-market-${row.country}`}
                                    className="cursor-pointer py-3 flex flex-col gap-2"
                                    onClick={() => setSelectedCountry(row.country)}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                          <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[color:var(--shell-muted)]">
                                            {row.country}
                                          </span>
                                          <span className="text-xs text-[color:var(--shell-muted)]">{row.country_name}</span>
                                        </div>
                                        <div className="text-xs text-[color:var(--shell-muted)] mt-1">
                                          {row.index_name ?? "No national benchmark series"}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-base font-semibold text-[color:var(--shell-ink)]">
                                          {formatSignedMetric(row.composite_change_percent, 2, "%")}
                                        </div>
                                        <div
                                          className={`text-xs ${
                                            isPositive
                                              ? "text-[color:var(--viz-positive)]"
                                              : isNegative
                                                ? "text-rose-600"
                                                : "text-[color:var(--shell-muted)]"
                                          }`}
                                        >
                                          {row.index_source ?? "Benchmark"} {formatSignedMetric(row.index_change_percent, 2, "%")} · {row.currency ?? "FX"} {formatSignedMetric(row.fx_change_percent, 2, "%")}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-[color:var(--shell-muted)]">
                                      <span>{row.index_frequency ?? "Benchmark"} period {row.index_period_end ?? "—"}</span>
                                      <span>ECB period {row.fx_period_end ?? "—"}</span>
                                      <span>SEC filings 7d {row.filing_count_7d}</span>
                                      <span className="ml-auto">
                                        {row.freshness}
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

                  </section>
                </div>

                {mapExpanded && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
                    onClick={() => setMapExpanded(false)}
                  >
                    <div
                      className="app-card w-full max-w-6xl rounded-[1.6rem]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Expanded map
                          </div>
                          <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                            {mapMode === "signals"
                              ? "Cross-source signal relevance"
                              : mapMode === "news"
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
                        <div className="app-map-frame h-[min(74vh,760px)] min-h-[20rem]">
                          <WorldMapBubbles
                            variant="default"
                            data={activeMapData}
                            onSelect={handleMapSelect}
                            points={overviewEventPoints}
                            onSelectPoint={(point) => handleOpenIntelligence(point.id)}
                            dark={dark}
                            primaryCountry={selectedCountry}
                            secondaryCountry={comparisonCountry}
                            pinnedCountry={pinnedCountry}
                            featuredCountry={
                              mapMode === "signals"
                                ? highestSignalCountry?.country
                                : mapMode === "news"
                                  ? highestMapNewsCountry?.country
                                  : mostExtremeWeatherCountry?.country
                            }
                            featuredLabel={
                              mapMode === "signals"
                                ? "Highest signal relevance"
                                : mapMode === "news"
                                  ? "Highest story concentration"
                                  : "Most extreme temperature"
                            }
                            scale={
                              mapMode === "news" || mapMode === "signals"
                                ? "log"
                                : "linear"
                            }
                            fillMode={
                              mapMode === "weather" ? "temperature" : "relevance"
                            }
                            valueDomain={
                              mapMode === "signals"
                                ? [0, 100]
                                : mapMode === "news"
                                  ? [0, Math.max(1, ...mapBubbleData.map((row) => row.count))]
                                  : [-30, 45]
                            }
                            valueUnit={mapMode === "signals" ? "/100" : mapMode === "weather" ? "°C" : ""}
                            showBubbles={false}
                            legendLabel={activeMapLegendLabel}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--shell-border)] px-4 py-3 text-xs text-[color:var(--shell-muted)]">
                        <span>
                          Window: {mapRangeLabel}
                        </span>
                        <span>
                          Countries shown:{" "}
                          {activeMapData.length}
                        </span>
                        <span className="ml-auto">
                          Search topic: {activeSearchTopicLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
            {activeView === "news" && (
              <div className="workspace-page news-workspace space-y-4">
                <IntelligenceEventStrip country={selectedCountry} onOpen={handleOpenIntelligence} />
                <section
                  className="operational-control-bar flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
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
                  <div className="grid w-full gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
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
                      Language
                      <select
                        value={newsLanguageFilter}
                        onChange={(event) => setNewsLanguageFilter(event.currentTarget.value)}
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-[color:var(--shell-ink)]"
                      >
                        <option value="all">All languages</option>
                        {newsLanguageOptions.map((language) => (
                          <option key={language} value={language}>{language.toUpperCase()}</option>
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

                <section className="kpi-strip grid grid-cols-2 gap-3 xl:grid-cols-6">
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Stories
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {newsSummary.stories}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Items after filters
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Coverage
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {newsSummary.countries}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Countries represented
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Dominant source
                    </div>
                    <div className="mt-2 truncate text-base font-semibold text-[color:var(--shell-ink)]">
                      {newsSummary.dominantSource}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Highest share in scope
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Visual richness
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {newsSummary.withImages}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Stories with imagery
                    </div>
                  </div>
                </section>

                <section className="news-primary-grid grid grid-cols-1 gap-4 xl:grid-cols-[minmax(20rem,0.72fr)_minmax(32rem,1.28fr)]">
                  <div className={`${cardBase} geo-panel news-map-panel overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        News map
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Country coverage
                      </div>
                    </div>
                    <div className="h-[min(64vh,680px)] min-h-[24rem] p-3">
                      <div className="app-map-frame">
                        <WorldMapBubbles
                          variant="default"
                          data={newsPageMapData}
                          onSelect={(iso) => {
                            setSelectedCountry(iso);
                            setActiveView("news");
                          }}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          featuredCountry={highestNewsCountry?.country}
                          featuredLabel="Highest story concentration"
                          scale="log"
                          fillMode="relevance"
                          valueDomain={[0, Math.max(1, ...newsPageMapData.map((row) => row.count))]}
                          showBubbles={false}
                          legendLabel="Story concentration"
                        />
                      </div>
                    </div>
                  </div>

                  <div className={`${cardBase} feed-panel news-stream-panel overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Headlines
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Filtered story stream
                      </div>
                    </div>
                    <div
                      ref={feedRef}
                      className="app-scroll-panel h-[min(64vh,680px)] min-h-[24rem] overflow-y-auto"
                    >
                      <PriorityNewsList
                        items={newsPageItems}
                        selectedId={selectedDashboardNewsId}
                        primaryCountry={selectedCountry}
                        secondaryCountry={comparisonCountry}
                        getImageUrl={(item) =>
                          imageProxy(getNewsImageUrl(item))
                        }
                        getSourceLabel={getSourceLabel}
                        getCountryName={(iso) =>
                          countryMeta.get(iso)?.name ?? iso
                        }
                        onToggle={(item, iso) => {
                          const nextId =
                            selectedDashboardNewsId === item.id ? null : item.id;
                          setSelectedDashboardNewsId(nextId);
                          if (nextId && iso) setSelectedCountry(iso);
                        }}
                        onRequestTranslation={requestNewsTranslationSummary}
                        translationPendingIds={newsTranslationPendingIds}
                        onOpenEvent={handleOpenIntelligence}
                        onSelectCountry={(iso) => {
                          setSelectedCountry(iso);
                          setMapMode("signals");
                          setActiveView("dashboard");
                        }}
                        emptyState={
                          <div className="m-3 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-sm text-[color:var(--shell-muted)]">
                            No stories match the current filters.
                          </div>
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="news-analysis-grid grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,0.9fr)]">
                  <div
                    className={`${cardBase} news-volume-panel primary-analytics-panel flex min-h-0 flex-col overflow-hidden`}
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
                        type="button"
                        onClick={() => setChartView("daily")}
                        className={`rounded-full border px-3 py-1 ${
                          chartView === "daily"
                            ? "bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)] border-[color:var(--shell-strong)]"
                            : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                        }`}
                      >
                        Daily
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartView("rolling")}
                        className={`rounded-full border px-3 py-1 ${
                          chartView === "rolling"
                            ? "bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)] border-[color:var(--shell-strong)]"
                            : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                        }`}
                      >
                        7d Avg
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartRange({})}
                        className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                      >
                        Reset range
                      </button>
                      <button
                        type="button"
                        onClick={handleExportCsv}
                        className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                      >
                        Export CSV
                      </button>
                      <button
                        type="button"
                        onClick={handleExportPng}
                        className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)]"
                      >
                        Export PNG
                      </button>
                    </div>
                    <div ref={chartRef} className="h-[22rem] min-h-[18rem] p-4">
                      {newsTrendTotal === 0 ? (
                        <div className="grid h-full place-items-center text-sm text-[color:var(--shell-muted)]">
                          No timestamped articles in the current country scope.
                        </div>
                      ) : (
                        <>
                          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-[color:var(--shell-muted)]">
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-[color:var(--signal-emerald)]" />
                              {selectedCountry?.toUpperCase() ?? regionLabel}
                            </span>
                            {comparisonCountry && (
                              <span className="inline-flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-[color:var(--signal-amber)]" />
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
                                  id="newsWorkspaceVolumeGradient"
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
                              <Tooltip
                                content={<ChartTooltip />}
                                cursor={{ strokeDasharray: "3 3" }}
                              />
                              {chartView === "daily" && (
                                <Area
                                  type="monotone"
                                  dataKey="count"
                                  stroke="var(--signal-emerald)"
                                  strokeWidth={2}
                                  fill="url(#newsWorkspaceVolumeGradient)"
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
                              {comparisonCountry && (
                                <Line
                                  type="monotone"
                                  dataKey={
                                    chartView === "rolling"
                                      ? "comparisonRollingAvg"
                                      : "comparisonCount"
                                  }
                                  stroke="var(--signal-amber)"
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
                                  fill="var(--signal-rose)"
                                  stroke="var(--viz-negative)"
                                  onClick={() => handleAnomalyClick(point.dateKey)}
                                />
                              ))}
                              <Brush
                                dataKey="label"
                                height={24}
                                stroke="var(--shell-muted)"
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

                  <div className="grid min-w-0 gap-4">
                    <div className={`${cardBase} insights-rail overflow-hidden`}>
                      <div className="flex items-center justify-between border-b border-[color:var(--shell-border)] px-4 py-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                            Attention queue
                          </div>
                          <div className="text-sm font-semibold">
                            Highest-priority signals
                          </div>
                        </div>
                        <div className="text-xs text-[color:var(--shell-muted)]">
                          {todayLabel}
                        </div>
                      </div>
                      <div className="relative min-h-0 p-3">
                        <div className="insight-list">
                          {signalNotifications.slice(0, 4).map((notification) => (
                            <button
                              key={`news-insight-${notification.id}`}
                              type="button"
                              onClick={() => handleNotificationClick(notification)}
                              className="insight-row"
                            >
                              <span
                                className={`signal-dot signal-dot-${notification.tone}`}
                                aria-hidden="true"
                              />
                              <span className="min-w-0">
                                <strong>{notification.title}</strong>
                                <small>{notification.description}</small>
                              </span>
                              <span className="insight-time">
                                {notification.timeLabel}
                              </span>
                            </button>
                          ))}
                          {signalNotifications.length === 0 && (
                            <div className="product-state product-state-success">
                              <CheckCheck className="h-5 w-5" />
                              <strong>No active exceptions</strong>
                              <span>
                                All monitored signals are within current thresholds.
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="insights-focus">
                          <span>Current news scope</span>
                          <strong>{focusLabel}</strong>
                          <small>
                            {newsSummary.countries} countries · {newsSummary.stories} stories
                          </small>
                        </div>
                      </div>
                    </div>

                    <div className={`${cardBase} news-source-panel min-w-0 p-4`}>
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Source mix
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                        Top publishers in current scope
                      </div>
                      <div className="mt-3 h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={newsPageSourceData}>
                            <CartesianGrid
                              stroke={chartGridColor}
                              strokeDasharray="3 3"
                            />
                            <XAxis dataKey="source" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="stories" radius={[6, 6, 0, 0]}>
                              {newsPageSourceData.map((entry, index) => (
                                <Cell
                                  key={`news-source-${entry.source}`}
                                  fill={
                                    ANALYTICS_COLORS[
                                      index % ANALYTICS_COLORS.length
                                    ]
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Market context map
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Directional market pressure around the story footprint
                      </div>
                    </div>
                    <div className="h-[min(48vh,420px)] min-h-[18rem] p-3">
                      <div className="app-map-frame">
                        <WorldMapBubbles
                          data={newsMarketContextData}
                          onSelect={(iso) => setSelectedCountry(iso)}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          featuredCountry={featuredNewsMarketCountry?.country}
                          featuredLabel={marketMapLayer === "filings" ? "Highest filing activity" : marketMapLayer === "growth" ? "Largest GDP growth move" : "Strongest market move"}
                          scale="linear"
                          fillMode={marketMapLayer === "filings" ? "sequential" : "diverging"}
                          valueDomain={marketMapDomain}
                          valueUnit={marketMapLayer === "filings" ? "" : "%"}
                          showBubbles={false}
                          legendLabel="Market pressure"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <section className={`${cardBase} p-4`}>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                          Coverage matrix
                        </div>
                        <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                          Countries carrying the strongest story load right now
                        </div>
                      </div>
                      <div className="app-scroll-panel mt-3 max-h-52 overflow-y-auto pr-1">
                        <div className="space-y-2">
                          {newsCountryCoverageRows.map((row) => (
                            <button
                              key={`news-country-${row.country}`}
                              type="button"
                              onClick={() => setSelectedCountry(row.country)}
                              className="w-full rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-left text-xs transition hover:border-[color:var(--shell-ink)]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-[color:var(--shell-ink)]">
                                  {row.country}
                                </span>
                                <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[color:var(--shell-muted)]">
                                  {row.count} stories
                                </span>
                              </div>
                              <div className="mt-1 text-[color:var(--shell-muted)]">
                                Top source: {row.topSource}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[color:var(--shell-muted)]">
                                <span>Weather {row.weather}</span>
                                <span>Top symbol {row.topSymbol}</span>
                                <span>{row.topMove}</span>
                              </div>
                            </button>
                          ))}
                          {newsCountryCoverageRows.length === 0 && (
                            <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-xs text-[color:var(--shell-muted)]">
                              No country clusters are available for the current filters.
                            </div>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className={`${cardBase} p-4`}>
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Primary-source catalysts
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                        Recent SEC filings connected to the current signal set
                      </div>
                      <div className="app-scroll-panel mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                        {marketFilings.slice(0, 12).map((filing) => (
                          <a
                            key={`news-filing-${filing.id}`}
                            href={filing.url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-xs hover:border-[color:var(--shell-ink)]"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-semibold text-[color:var(--shell-ink)]">{filing.symbol ?? "SEC"} · {filing.event_type}</span>
                              <span className="text-[color:var(--shell-muted)]">{new Date(filing.event_time).toLocaleDateString()}</span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-[color:var(--shell-muted)]">{filing.title}</div>
                          </a>
                        ))}
                        {marketFilings.length === 0 && (
                          <div className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-xs text-[color:var(--shell-muted)]">
                            No recent SEC filing events are loaded yet.
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </section>

                <section className={`${cardBase} p-4`}>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                    Cross-signal context
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
                            {item.translated_title ? "AI translation · " : ""}{newsDisplayTitle(item)}
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
            {activeView === "podcasts" && (
              <div className="space-y-4">
                <IntelligenceEventStrip
                  country={selectedCountry}
                  onOpen={handleOpenIntelligence}
                />
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loadPodcastData(podcastQuery, podcastSignalFilter);
                  }}
                  className="app-card-muted flex flex-wrap items-end gap-3 rounded-[1.45rem] px-4 py-3"
                >
                  <label className="min-w-[14rem] flex-1 text-xs text-[color:var(--shell-muted)]">
                    Search podcast evidence
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2">
                      <Search className="h-4 w-4 shrink-0" />
                      <input
                        value={podcastQuery}
                        onChange={(event) => setPodcastQuery(event.currentTarget.value)}
                        placeholder="Episode, entity, claim, event, or risk"
                        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-[color:var(--shell-ink)] outline-none"
                      />
                      {podcastQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setPodcastQuery("");
                            void loadPodcastData("", podcastSignalFilter);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--shell-muted)] hover:bg-[color:var(--shell-surface-muted)]"
                          aria-label="Clear podcast search"
                          title="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </label>
                  <label className="w-full text-xs text-[color:var(--shell-muted)] sm:w-48">
                    Signal type
                    <select
                      value={podcastSignalFilter}
                      onChange={(event) => {
                        const next = event.currentTarget.value as PodcastSignal["type"] | "all";
                        setPodcastSignalFilter(next);
                        void loadPodcastData(podcastQuery, next);
                      }}
                      className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-sm text-[color:var(--shell-ink)]"
                    >
                      <option value="all">All signals</option>
                      <option value="entity">Entities</option>
                      <option value="topic">Topics</option>
                      <option value="claim">Claims</option>
                      <option value="event">Events</option>
                      <option value="risk">Risks</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={isLoadingPodcasts}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-4 text-sm font-semibold text-[color:var(--shell-on-strong)] disabled:opacity-50"
                  >
                    <Search className="h-4 w-4" />
                    Search
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadPodcastData(podcastQuery, podcastSignalFilter)}
                    disabled={isLoadingPodcasts}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)] disabled:opacity-50"
                    aria-label="Refresh podcast intelligence"
                    title="Refresh podcast intelligence"
                  >
                    <RefreshCw className={`h-4 w-4 ${isLoadingPodcasts ? "animate-spin" : ""}`} />
                  </button>
                </form>

                <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Episodes
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {podcastSummary.episodes}
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Transcripts
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {podcastSummary.transcripts}
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Signals
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {podcastSummary.signals}
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Evidence
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {podcastSummary.evidence}
                    </div>
                  </div>
                </section>

                {podcastSummary.episodes > 0 && (
                  <section className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Podcast conclusions
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Overall readout from the current evidence
                      </div>
                    </div>
                    <div className="space-y-4 p-4">
                      <p className="max-w-[90ch] text-sm leading-6 text-[color:var(--shell-ink)]">
                        {podcastSummary.conclusions}
                      </p>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                            Leading themes
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(podcastSummary.topTopics.length > 0
                              ? podcastSummary.topTopics
                              : podcastSummary.topEntities
                            ).map((item) => (
                              <span
                                key={`podcast-theme-${item.label}`}
                                className="rounded-full border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-2 py-1 text-xs text-[color:var(--shell-ink)]"
                              >
                                {item.label} · {item.count}
                              </span>
                            ))}
                            {podcastSummary.topTopics.length === 0 &&
                              podcastSummary.topEntities.length === 0 && (
                                <span className="text-xs text-[color:var(--shell-muted)]">
                                  No recurring topics extracted yet.
                                </span>
                              )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                            Risk posture
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                            {podcastSummary.elevatedRisks}
                          </div>
                          <div className="text-xs text-[color:var(--shell-muted)]">
                            High or critical · {podcastSummary.risks} total risk signals
                          </div>
                          {podcastSummary.prioritySignal && (
                            <div className="mt-2 line-clamp-2 text-xs font-semibold text-[color:var(--shell-ink)]">
                              {podcastSummary.prioritySignal.signal.title}
                            </div>
                          )}
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                            Geographic focus
                          </div>
                          <div className="mt-2 space-y-1">
                            {podcastSummary.topCountries.map((country) => (
                              <button
                                key={`podcast-conclusion-country-${country.iso}`}
                                type="button"
                                onClick={() => {
                                  setSelectedCountry(country.iso);
                                  setMapMode("signals");
                                  setActiveView("dashboard");
                                }}
                                className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-left text-xs text-[color:var(--shell-ink)] hover:bg-[color:var(--shell-surface-muted)]"
                              >
                                <span>{country.name}</span>
                                <span className="text-[color:var(--shell-muted)]">
                                  {country.count}
                                </span>
                              </button>
                            ))}
                            {podcastSummary.topCountries.length === 0 && (
                              <span className="text-xs text-[color:var(--shell-muted)]">
                                No country concentration detected.
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                            Evidence quality
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                            {podcastSummary.episodes > 0
                              ? `${Math.round((podcastSummary.transcripts / podcastSummary.episodes) * 100)}%`
                              : "—"}
                          </div>
                          <div className="text-xs text-[color:var(--shell-muted)]">
                            Transcript coverage
                            {podcastSummary.averageConfidence != null
                              ? ` · ${Math.round(podcastSummary.averageConfidence * 100)}% avg confidence`
                              : ""}
                          </div>
                          {podcastSummary.dominantSignalType && (
                            <div className="mt-2 text-xs text-[color:var(--shell-ink)]">
                              Dominant extraction:{" "}
                              <strong>{podcastSummary.dominantSignalType.label}</strong>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {podcastLoadError && (
                  <section className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {podcastLoadError}
                  </section>
                )}

                <section className="space-y-3">
                  {podcastSummary.episodes > 0 && (
                    <div className="px-1">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Episode evidence
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Source detail behind the conclusions
                      </div>
                    </div>
                  )}
                  {!isLoadingPodcasts && podcasts.length === 0 && !podcastLoadError && (
                    <div className={`${cardBase} px-4 py-10 text-center text-sm text-[color:var(--shell-muted)]`}>
                      No podcast intelligence matches the current filters.
                    </div>
                  )}
                  {podcasts.map((episode) => {
                    const links = getPodcastExternalLinks(episode);
                    const image = imageProxy(episode.image_url || episode.feed_image_url || null);
                    const duration = formatPodcastDuration(episode.duration_seconds);
                    const linkedCountries = Array.from(
                      podcastCountryLinks.entries(),
                    )
                      .filter(([, linkage]) =>
                        linkage.episodeIds.has(episode.id),
                      )
                      .map(([iso]) => iso)
                      .sort();
                    return (
                      <article key={episode.id} className={`${cardBase} overflow-hidden`}>
                        <div className="grid gap-4 p-4 md:grid-cols-[8rem_minmax(0,1fr)]">
                          <div className="aspect-square w-full max-w-32 overflow-hidden rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg-elevated)]">
                            {image ? (
                              <img
                                src={image}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="grid h-full place-items-center">
                                <Podcast className="h-8 w-8 text-[color:var(--shell-muted)]" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                              <span className="font-semibold text-[color:var(--shell-ink)]">
                                {episode.feed_title}
                              </span>
                              {episode.feed_author && <span>{episode.feed_author}</span>}
                              {episode.event_time && (
                                <span>{new Date(episode.event_time).toLocaleString()}</span>
                              )}
                              {duration && <span>{duration}</span>}
                              <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-0.5">
                                Transcript {episode.transcript_status}
                              </span>
                              {linkedCountries.map((iso) => (
                                <button
                                  key={`podcast-${episode.id}-${iso}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCountry(iso);
                                    setMapMode("signals");
                                    setActiveView("dashboard");
                                  }}
                                  className="rounded-full border border-[color:var(--signal-amber)] bg-[color:var(--signal-amber-soft)] px-2 py-0.5 font-semibold text-[color:var(--shell-ink)]"
                                  title="Open this podcast-to-country linkage on the signal map"
                                >
                                  Linked {iso}
                                </button>
                              ))}
                            </div>
                            <h2 className="mt-2 text-lg font-semibold leading-6 text-[color:var(--shell-ink)]">
                              {episode.title}
                            </h2>
                            {episode.summary && (
                              <p className="mt-2 line-clamp-3 text-sm leading-6 text-[color:var(--shell-muted)]">
                                {episode.summary}
                              </p>
                            )}
                            {links.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {links.map((link) => (
                                  <a
                                    key={`${link.platform}-${link.url}`}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2.5 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                                  >
                                    {link.label}
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {(episode.signals.length > 0 || episode.evidence.length > 0) && (
                          <div className="grid border-t border-[color:var(--shell-border)] lg:grid-cols-2">
                            <div className="min-w-0 p-4 lg:border-r lg:border-[color:var(--shell-border)]">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
                                Extracted signals
                              </div>
                              <div className="mt-3 space-y-3">
                                {episode.signals.map((signal) => (
                                  <div key={signal.id} className="border-l-2 border-[color:var(--signal-sky)] pl-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs font-semibold uppercase text-[color:var(--shell-muted)]">
                                        {signal.type}
                                      </span>
                                      {signal.risk_level && (
                                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                                          {signal.risk_level}
                                        </span>
                                      )}
                                      {signal.confidence != null && (
                                        <span className="text-[10px] text-[color:var(--shell-muted)]">
                                          {Math.round(signal.confidence * 100)}% confidence
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                                      {signal.title}
                                    </div>
                                    {signal.summary && (
                                      <p className="mt-1 text-xs leading-5 text-[color:var(--shell-muted)]">
                                        {signal.summary}
                                      </p>
                                    )}
                                  </div>
                                ))}
                                {episode.signals.length === 0 && (
                                  <div className="text-xs text-[color:var(--shell-muted)]">
                                    No extracted signals for this episode.
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="min-w-0 border-t border-[color:var(--shell-border)] p-4 lg:border-t-0">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--shell-muted)]">
                                Timestamped evidence
                              </div>
                              <div className="mt-3 space-y-3">
                                {episode.evidence.map((evidence) => (
                                  <div key={evidence.id}>
                                    <div className="flex items-center gap-2 text-xs text-[color:var(--shell-muted)]">
                                      <span className="font-mono">
                                        {formatEvidenceTimestamp(evidence.start_ms)}
                                      </span>
                                      {evidence.speaker && (
                                        <span className="font-semibold text-[color:var(--shell-ink)]">
                                          {evidence.speaker}
                                        </span>
                                      )}
                                      {evidence.source_url && (
                                        <a
                                          href={evidence.source_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--shell-border)]"
                                          aria-label={`Open evidence source at ${formatEvidenceTimestamp(evidence.start_ms)}`}
                                          title="Open transcript source"
                                        >
                                          <ArrowUpRight className="h-3.5 w-3.5" />
                                        </a>
                                      )}
                                    </div>
                                    <p className="mt-1 line-clamp-4 text-xs leading-5 text-[color:var(--shell-muted)]">
                                      {evidence.text}
                                    </p>
                                  </div>
                                ))}
                                {episode.evidence.length === 0 && (
                                  <div className="text-xs text-[color:var(--shell-muted)]">
                                    No timestamped evidence is available for this episode.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>
              </div>
            )}
            {activeView === "weather" && (
              <div className="workspace-page weather-workspace space-y-4">
                <IntelligenceEventStrip country={selectedCountry} onOpen={handleOpenIntelligence} />
                <section className="operational-control-bar flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Weather workspace
                    </div>
                    <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                      {weatherPageRows.length} observations in scope
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                    <a
                      href="https://openweathermap.org/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-2 py-1 text-white"
                      title="OpenWeather source and licence information"
                    >
                      <img
                        src="https://openweathermap.org/themes/openweathermap/assets/img/logo_white_cropped.png"
                        alt="OpenWeather"
                        className="h-5 w-auto max-w-24 object-contain"
                      />
                      <span>Weather data provided by OpenWeather</span>
                    </a>
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

                <section className="kpi-strip grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Official alerts
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {weatherSummary.officialAlerts}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Active provider alerts
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Avg temp
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {formatMetricNumber(weatherSummary.avgTemp)}°C
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Across active filter set
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Coverage
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {weatherSummary.observations}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Country centroid observations
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Hottest
                    </div>
                    <div className="mt-2 text-base font-semibold text-[color:var(--shell-ink)]">
                      {weatherSummary.hottestCountry}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      {formatMetricNumber(weatherSummary.hottestTemp)}°C · {weatherSummary.dominantCondition}
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Elevated air</div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">{weatherSummary.poorAir}</div>
                    <div className="text-xs text-[color:var(--shell-muted)]">Poor / very poor provider category</div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Rain risk</div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">{weatherSummary.highRainRisk}</div>
                    <div className="text-xs text-[color:var(--shell-muted)]">Countries ≥70% next-day probability</div>
                  </div>
                </section>

                <section className={`threshold-summary ${weatherAlerts.length > 0 ? "has-alerts" : ""}`}>
                  <div>
                    <span className="status-label">Weather exceptions</span>
                    <strong>
                      {weatherAlerts.length > 0
                        ? `${weatherAlerts.length} locations require review`
                        : "No official alerts or material forecast thresholds"}
                    </strong>
                  </div>
                  <div className="threshold-rules">
                    <span>Heat ≥ 35°C</span>
                    <span>Freeze ≤ 0°C</span>
                    <span>Humidity ≥ 85%</span>
                    <span>Wind ≥ 15 m/s</span>
                    <span>Rain probability ≥ 70%</span>
                  </div>
                  {weatherAlerts.slice(0, 4).map((alert) => (
                    <button
                      key={`weather-alert-${alert.country}-${alert.observed_at}`}
                      type="button"
                      onClick={() => setSelectedCountry(alert.country.toUpperCase())}
                    >
                      <b>{alert.country.toUpperCase()}</b>
                      <span>{weatherOperationalRows.find((row) => row.country === alert.country)?.reasons.join(" · ") || `${alert.temp_c ?? "—"}°C · ${alert.wind_gust ?? alert.wind_speed ?? "—"} m/s`}</span>
                    </button>
                  ))}
                  {weatherPageRows.flatMap((row) => (row.alerts ?? []).map((alert) => ({ ...alert, country: alert.country || row.country }))).slice(0, 8).map((alert, index) => (
                    <button
                      key={`official-warning-${alert.country}-${alert.starts_at}-${index}`}
                      type="button"
                      className="!block !h-auto !border-rose-400/60 !bg-rose-500/15 !p-3 !text-left"
                      onClick={() => setSelectedCountry(alert.country.toUpperCase())}
                    >
                      <span className="mb-1 flex items-center gap-2 font-bold text-rose-200">
                        <b className="rounded bg-rose-500 px-2 py-0.5 text-white">{alert.country.toUpperCase()}</b>
                        {alert.severity ?? "Official warning"} · {alert.event}
                      </span>
                      <span className="block text-[color:var(--shell-ink)]">{alert.headline ?? alert.description ?? alert.area ?? "Open the country context for details."}</span>
                      <span className="mt-1 block text-[color:var(--shell-muted)]">{alert.area ? `${alert.area} · ` : ""}{alert.sender_name}</span>
                    </button>
                  ))}
                </section>

                <section className="weather-primary-grid grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className={`${cardBase} geo-panel weather-map-panel overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Weather map
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Temperature overlay by country
                      </div>
                    </div>
                    <div className="h-[min(56vh,520px)] min-h-[20rem] p-3">
                      <div className="app-map-frame">
                        <WorldMapBubbles
                          variant="default"
                          data={mapWeatherData}
                          onSelect={(iso) => setSelectedCountry(iso)}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          featuredCountry={weatherSummary.hottestCountry !== "—" ? weatherSummary.hottestCountry : null}
                          featuredLabel="Highest observed temperature"
                          scale="linear"
                          legendLabel="Air temperature °C"
                          fillMode="temperature"
                          valueDomain={[-30, 45]}
                          valueUnit="°C"
                          showBubbles={false}
                        />
                      </div>
                    </div>
                  </div>

                  <div className={`${cardBase} feed-panel weather-feed-panel overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Weather feed
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Live observations
                      </div>
                    </div>
                    <div className="app-scroll-panel max-h-[56vh] min-h-[20rem] overflow-y-auto p-3 space-y-2">
                      {weatherPageRows.map((entry, index) => {
                        const iso = entry.country?.toUpperCase();
                        const selected = iso && selectedCountry?.toUpperCase() === iso;
                        const weatherLink = weatherDrilldownUrl(iso);
                        const iconUrl = getWeatherIconUrl(entry);
                        const source = prettySourceName(entry.source_name ?? "openweather");
                        return (
                          <article
                            key={`${entry.country}-${entry.observed_at}-${index}`}
                            className={`analytics-row weather-row w-full rounded-lg px-3 py-2 text-left text-xs transition ${
                              selected
                                ? "border-[color:var(--signal-emerald)] bg-[color:var(--signal-emerald-soft)]"
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
                              <span className="rounded-full border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-2 py-0.5 text-[color:var(--shell-ink)]">
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
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[color:var(--shell-muted)]">
                              <span>Feels {entry.apparent_temp_c ?? "—"}°C</span>
                              <span>Precip {entry.precipitation_mm ?? "—"} mm</span>
                              <span>Gust {entry.wind_gust ?? "—"} m/s</span>
                              <span>Pressure {entry.pressure_hpa ?? "—"} hPa</span>
                              <span>Visibility {entry.visibility_m != null ? `${formatMetricNumber(entry.visibility_m / 1000)} km` : "—"}</span>
                              <span>
                                AQI {entry.air_quality?.provider_aqi ?? entry.air_quality?.european_aqi ?? entry.air_quality?.us_aqi ?? "—"}
                                {entry.air_quality?.aqi_scale ? ` (${entry.air_quality.aqi_scale})` : ""} · {entry.air_quality?.label ?? "Unknown"}
                              </span>
                            </div>
                            {(entry.alert_count ?? entry.alerts?.length ?? 0) > 0 && (
                              <div className="mt-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-rose-200">
                                {entry.alert_count ?? entry.alerts?.length} active official alert{(entry.alert_count ?? entry.alerts?.length ?? 0) === 1 ? "" : "s"}: {entry.alerts?.[0]?.event ?? "review details"}
                              </div>
                            )}
                            {entry.forecast && entry.forecast.length > 0 && (
                              <div className="mt-2 grid grid-cols-3 gap-1">
                                {entry.forecast.slice(0, 3).map((day) => (
                                  <div key={day.forecast_time} className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-1">
                                    <div className="font-semibold text-[color:var(--shell-ink)]">
                                      {new Date(day.forecast_time).toLocaleDateString([], { weekday: "short" })}
                                    </div>
                                    <div>{day.temp_min_c ?? "—"}–{day.temp_max_c ?? "—"}° · {day.weather_main ?? "—"}</div>
                                    <div>{day.precipitation_probability ?? "—"}% rain · UV {day.uv_index ?? "—"}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-1 text-[color:var(--shell-muted)]">
                              {new Date(entry.observed_at).toLocaleString()}
                              {entry.location_name ? ` · representative point ${entry.location_name}` : " · representative country-centroid point"}
                              {entry.attribution ? ` · ${entry.attribution}` : ""}
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

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Five-day outlook · {weatherFocusCountry ?? "—"}</div>
                        <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Three-hour temperature, rain probability and wind</div>
                      </div>
                      <div className="text-right text-[10px] text-[color:var(--shell-muted)]">{weatherForecastDetail?.attribution ?? (weatherForecastLoading ? "Loading forecast…" : "Select a covered country")}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={weatherForecastChartData}>
                            <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                            <XAxis dataKey="time" minTickGap={28} />
                            <YAxis unit="°" />
                            <Tooltip />
                            <Legend />
                            <Area type="monotone" dataKey="temperature" name="Temperature °C" stroke="var(--viz-weather)" fill="var(--signal-amber-soft)" />
                            <Line type="monotone" dataKey="feels_like" name="Feels like °C" stroke="var(--signal-sky)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={weatherForecastChartData}>
                            <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                            <XAxis dataKey="time" minTickGap={28} />
                            <YAxis yAxisId="rain" domain={[0, 100]} unit="%" />
                            <YAxis yAxisId="wind" orientation="right" unit="m/s" />
                            <Tooltip />
                            <Legend />
                            <Bar yAxisId="rain" dataKey="rain_probability" name="Rain probability" fill="var(--signal-sky)" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="wind" type="monotone" dataKey="wind_gust" name="Wind gust" stroke="var(--viz-negative)" dot={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    {weatherForecastChartData.length === 0 && !weatherForecastLoading && <div className="product-state mt-3">No stored forecast is available for this country. Run weather ingestion to populate the standard OpenWeather forecast feed.</div>}
                  </div>
                  <div className={`${cardBase} min-w-0 overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Global exception ranking</div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">Where conditions deserve attention</div>
                    </div>
                    <div className="app-scroll-panel max-h-[29rem] overflow-y-auto">
                      {weatherOperationalRows.slice(0, 16).map((row, index) => (
                        <button key={`weather-risk-${row.country}`} type="button" onClick={() => setSelectedCountry(row.country.toUpperCase())} className="flex w-full items-start gap-3 border-b border-[color:var(--shell-border)] px-4 py-3 text-left hover:bg-[color:var(--shell-surface)]">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[color:var(--shell-border)] text-xs font-semibold">{index + 1}</span>
                          <span className="min-w-0 flex-1"><strong className="block text-sm text-[color:var(--shell-ink)]">{row.country} · {row.temp_c ?? "—"}°C</strong><small className="mt-1 block text-[color:var(--shell-muted)]">{row.reasons.join(" · ") || `${row.weather_main ?? "Current conditions"} · no material threshold`}</small></span>
                          <span className={`text-sm font-semibold ${row.score >= 50 ? "text-rose-400" : "text-[color:var(--shell-muted)]"}`}>{row.score}/100</span>
                        </button>
                      ))}
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
                    Temperature departures
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">
                    Largest departures from a 20°C reference · actual versus perceived
                  </div>
                  <div className="mt-3 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weatherTempChartData}>
                        <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                        <XAxis dataKey="country" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="temp_c" name="Actual °C" fill={ANALYTICS_COLORS[0]} radius={[6, 6, 0, 0]} />
                        <Bar dataKey="apparent_temp_c" name="Feels like °C" fill={ANALYTICS_COLORS[1]} radius={[6, 6, 0, 0]} />
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
                        Related market regime
                      </div>
                      {selectedCountryMarket ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveView("markets");
                          }}
                          className="mt-2 w-full rounded-lg border border-[color:var(--shell-border)] px-3 py-2 text-left text-xs text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]"
                        >
                          <div className="flex justify-between gap-3 font-semibold"><span>{selectedCountryMarket.country_name}</span><span>{formatSignedMetric(selectedCountryMarket.composite_change_percent, 2, "%")}</span></div>
                          <div className="mt-1 text-[color:var(--shell-muted)]">Index {selectedCountryMarket.index_symbol ?? "not configured"} · FX {formatSignedMetric(selectedCountryMarket.fx_change_percent, 2, "%")} · {selectedCountryMarket.filing_count_7d} SEC filings / 7d</div>
                        </button>
                      ) : (
                        <p className="mt-2 text-xs text-[color:var(--shell-muted)]">No ECB/SEC market context is mapped for this country.</p>
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
                          {item.translated_title ? "AI translation · " : ""}{newsDisplayTitle(item)}
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
              <div className="workspace-page markets-workspace space-y-4">
                <IntelligenceEventStrip country={selectedCountry} onOpen={handleOpenIntelligence} />
                <section className="operational-control-bar flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Market workspace</div>
                    <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                      {countryMarketCoverage.countries} country economies · OECD benchmarks + ECB FX + World Bank macro + SEC events
                    </div>
                  </div>
                  <div className="ml-auto inline-flex flex-wrap rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-1 text-xs">
                    {(["composite", "index", "fx", "growth", "filings"] as const).map((layer) => (
                      <button
                        key={`market-layer-${layer}`}
                        type="button"
                        onClick={() => setMarketMapLayer(layer)}
                        className={`rounded-full px-3 py-1 capitalize ${marketMapLayer === layer ? "bg-[color:var(--shell-strong)] text-[color:var(--shell-bg)]" : "text-[color:var(--shell-muted)]"}`}
                      >
                        {layer}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
                  <div className={`${cardBase} overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Country market regime map</div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        {marketMapDescription}
                      </div>
                    </div>
                    <div className="h-[min(58vh,540px)] min-h-[22rem] p-3">
                      <div className="app-map-frame">
                        <WorldMapBubbles
                          data={marketIndexMapData}
                          onSelect={(iso) => setSelectedCountry(iso)}
                          dark={dark}
                          primaryCountry={selectedCountry}
                          secondaryCountry={comparisonCountry}
                          pinnedCountry={pinnedCountry}
                          featuredCountry={featuredMarketCountry?.country}
                          featuredLabel={marketMapLayer === "filings" ? "Highest filing activity" : marketMapLayer === "growth" ? "Largest GDP growth move" : "Strongest market move"}
                          fillMode={marketMapLayer === "filings" ? "sequential" : "diverging"}
                          valueDomain={marketMapDomain}
                          valueUnit={marketMapLayer === "filings" ? "" : "%"}
                          showBubbles={false}
                          legendLabel={marketMapLayer === "filings" ? "7-day filing count" : marketMapLayer === "index" ? "Latest monthly change" : marketMapLayer === "fx" ? "Latest daily FX change" : marketMapLayer === "growth" ? "Annual real GDP growth" : "Mixed-frequency regime change"}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className={`${cardBase} p-4`}>
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Selected country drill-down</div>
                      <div className="mt-1 text-base font-semibold text-[color:var(--shell-ink)]">
                        {selectedCountryMarket ? `${selectedCountryMarket.country_name} · ${selectedCountryMarket.country}` : "Select a mapped country"}
                      </div>
                      {selectedCountryMarket ? (
                        <>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><dt className="text-[color:var(--shell-muted)]">Composite</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{formatSignedMetric(selectedCountryMarket.composite_change_percent, 2, "%")}</dd></div>
                            <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><dt className="text-[color:var(--shell-muted)]">Index</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{selectedCountryMarket.index_symbol ?? "No provider"} · {formatSignedMetric(selectedCountryMarket.index_change_percent, 2, "%")}</dd></div>
                            <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><dt className="text-[color:var(--shell-muted)]">Currency vs EUR</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{selectedCountryMarket.fx_symbol ?? "—"} · {formatSignedMetric(selectedCountryMarket.fx_change_percent, 2, "%")}</dd></div>
                            <div className="rounded-lg border border-[color:var(--shell-border)] p-2"><dt className="text-[color:var(--shell-muted)]">SEC activity</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{selectedCountryMarket.filing_count_7d} filings / 7d</dd></div>
                          </dl>
                          <div className="mt-3 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3">
                            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                              <span>World Bank macro context</span>
                              <span>{selectedCountryMarket.macro_latest_year ?? "Year unavailable"}</span>
                            </div>
                            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                              <div><dt className="text-[color:var(--shell-muted)]">GDP growth · {selectedCountryMarket.gdp_year ?? "—"}</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{formatSignedMetric(selectedCountryMarket.gdp_growth, 1, "%")}</dd></div>
                              <div><dt className="text-[color:var(--shell-muted)]">Inflation · {selectedCountryMarket.inflation_year ?? "—"}</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{selectedCountryMarket.inflation == null ? "—" : `${formatMetricNumber(selectedCountryMarket.inflation, { maximumFractionDigits: 1 })}%`}</dd></div>
                              <div><dt className="text-[color:var(--shell-muted)]">Unemployment · {selectedCountryMarket.unemployment_year ?? "—"}</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{selectedCountryMarket.unemployment == null ? "—" : `${formatMetricNumber(selectedCountryMarket.unemployment, { maximumFractionDigits: 1 })}%`}</dd></div>
                              <div><dt className="text-[color:var(--shell-muted)]">Current account · {selectedCountryMarket.current_account_year ?? "—"}</dt><dd className="font-semibold text-[color:var(--shell-ink)]">{formatSignedMetric(selectedCountryMarket.current_account, 1, "% GDP")}</dd></div>
                            </dl>
                            {countryMarketDetail?.macro_indicators?.length ? (
                              <div className="mt-2 space-y-1 border-t border-[color:var(--shell-border)] pt-2 text-[10px] text-[color:var(--shell-muted)]">
                                {countryMarketDetail.macro_indicators.slice(0, 8).map((indicator) => (
                                  <div key={`country-macro-${indicator.symbol}`} className="flex items-center justify-between gap-3">
                                    <span className="truncate">{indicator.company_name ?? indicator.canonical_symbol ?? indicator.symbol}</span>
                                    <span className="shrink-0 font-semibold text-[color:var(--shell-ink)]">{formatMetricNumber(indicator.price, { maximumFractionDigits: 2 })} {indicator.unit ?? ""} · {prettySourceName(indicator.source_name ?? "")}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {countryMarketDetail && (countryMarketDetail.index_history.length > 1 || countryMarketDetail.fx_history.length > 1) && (
                            <div className="mt-3 grid grid-cols-1 gap-3">
                              {countryMarketDetail.index_history.length > 1 && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Benchmark level · {selectedCountryMarket.index_frequency ?? "source frequency"}</div>
                                  <div className="h-36" aria-label={`${selectedCountryMarket.index_name ?? "National benchmark"} history`}>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <AreaChart data={countryMarketDetail.index_history}>
                                        <XAxis dataKey="period_end" minTickGap={24} tickFormatter={(value) => String(value).slice(0, 7)} />
                                        <YAxis domain={["auto", "auto"]} width={42} />
                                        <Tooltip labelFormatter={(label) => new Date(String(label)).toLocaleDateString()} />
                                        <Area type="monotone" dataKey="value" name="Index level" stroke="var(--viz-market)" fill="var(--signal-amber-soft)" strokeWidth={2} />
                                      </AreaChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              )}
                              {countryMarketDetail.fx_history.length > 1 && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">ECB units per EUR · 90 observations</div>
                                  <div className="h-36" aria-label={`${selectedCountryMarket.fx_symbol ?? "Currency"} ECB history`}>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <AreaChart data={countryMarketDetail.fx_history}>
                                        <XAxis dataKey="period_end" minTickGap={28} tickFormatter={(value) => String(value).slice(5)} />
                                        <YAxis domain={["auto", "auto"]} width={42} />
                                        <Tooltip labelFormatter={(label) => new Date(String(label)).toLocaleDateString()} />
                                        <Area type="monotone" dataKey="value" name="Units per EUR" stroke="var(--signal-sky)" fill="var(--signal-sky-soft)" strokeWidth={2} />
                                      </AreaChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {countryMarketDetail && countryMarketDetail.filings.length > 0 && (
                            <div className="mt-2 text-[11px] text-[color:var(--shell-muted)]">
                              Latest filing: <span className="font-semibold text-[color:var(--shell-ink)]">{countryMarketDetail.filings[0].symbol ?? "SEC"} · {countryMarketDetail.filings[0].event_type}</span> · {new Date(countryMarketDetail.filings[0].event_time).toLocaleDateString()}
                            </div>
                          )}
                        </>
                      ) : <p className="mt-3 text-xs text-[color:var(--shell-muted)]">The map preserves missing components instead of fabricating a country score.</p>}
                    </div>
                    <div className={`${cardBase} p-4 text-xs`}>
                      <div className="font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Connected context</div>
                      <div className="mt-2 text-[color:var(--shell-ink)]">Weather: {relatedWeather ? `${relatedWeather.temp_c ?? "—"}°C · ${relatedWeather.weather_main ?? "—"} · AQI ${relatedWeather.air_quality?.provider_aqi ?? relatedWeather.air_quality?.european_aqi ?? relatedWeather.air_quality?.us_aqi ?? "—"}${relatedWeather.air_quality?.aqi_scale ? ` (${relatedWeather.air_quality.aqi_scale})` : ""}` : "select a covered country"}</div>
                      <div className="mt-1 text-[color:var(--shell-ink)]">News: {relatedNews.length} recent mapped stories</div>
                      <div className="mt-1 text-[color:var(--shell-muted)]">Composite = 75% latest national benchmark direction + 25% ECB daily local-currency direction versus EUR when both exist; otherwise the available component is shown. Missing values are not imputed.</div>
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">ECB macro pulse</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Euro FX reference rates and policy benchmarks</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {fxRates.slice(0, 8).map((rate) => (
                        <div key={rate.series_key} className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-2 text-xs">
                          <div className="font-semibold text-[color:var(--shell-ink)]">{rate.symbol}</div>
                          <div className="mt-1 text-base font-semibold text-[color:var(--shell-ink)]">{formatMetricNumber(rate.value, { maximumFractionDigits: 4 })}</div>
                          <div className={(rate.percent_change ?? 0) >= 0 ? "text-[color:var(--viz-positive)]" : "text-rose-600"}>{formatSignedMetric(rate.percent_change, 2, "%")}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {policyRates.map((rate) => (
                        <span key={rate.series_key} className="rounded-full border border-[color:var(--signal-amber)] bg-[color:var(--signal-amber-soft)] px-3 py-1 text-[color:var(--shell-ink)]">
                          {rate.name}: <strong>{formatMetricNumber(rate.value, { maximumFractionDigits: 3 })}{rate.unit === "PCPA" || rate.unit === "%" ? "%" : ` ${rate.unit ?? ""}`}</strong>
                        </span>
                      ))}
                    </div>
                    {fxRates.length === 0 && policyRates.length === 0 && <div className="mt-3 text-xs text-[color:var(--shell-muted)]">ECB series will appear after the first market ingestion run.</div>}
                  </div>
                  <div className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">SEC primary-source monitor</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">{selectedSymbol ? `Recent filings for ${selectedSymbol}` : "Latest 8-K, 10-Q and 10-K filings"}</div>
                    {selectedSymbol && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {marketIndicators.filter((indicator) => indicator.symbol?.toUpperCase() === selectedSymbol.toUpperCase()).slice(0, 4).map((indicator) => (
                          <span key={indicator.id} className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-1 text-[color:var(--shell-muted)]" title={`${indicator.period_end} · ${indicator.source_name}`}>
                            {indicator.name}: <strong className="text-[color:var(--shell-ink)]">{formatCompactNumber(indicator.value)} {indicator.unit ?? ""}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="app-scroll-panel mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                      {marketFilings.filter((filing) => !selectedSymbol || filing.symbol?.toUpperCase() === selectedSymbol.toUpperCase()).slice(0, 12).map((filing) => (
                        <a key={filing.id} href={filing.url ?? "#"} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-xs hover:border-[color:var(--shell-ink)]">
                          <div className="flex justify-between gap-3 font-semibold text-[color:var(--shell-ink)]"><span>{filing.symbol ?? "—"} · {filing.title}</span><span>{new Date(filing.event_time).toLocaleDateString()}</span></div>
                          {filing.summary && <div className="mt-1 text-[color:var(--shell-muted)]">{filing.summary}</div>}
                        </a>
                      ))}
                      {marketFilings.filter((filing) => !selectedSymbol || filing.symbol?.toUpperCase() === selectedSymbol.toUpperCase()).length === 0 && <div className="text-xs text-[color:var(--shell-muted)]">No matching SEC filing events are loaded yet.</div>}
                    </div>
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Global macro panorama</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Largest latest annual real-GDP growth rates</div>
                    <div className="mt-3 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={marketMacroGrowthData} layout="vertical" margin={{ left: 8, right: 18 }}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis type="number" unit="%" />
                          <YAxis type="category" dataKey="country" width={36} />
                          <Tooltip formatter={(value, key) => [`${Number(value).toFixed(1)}%`, key === "growth" ? "Real GDP growth" : String(key)]} />
                          <Bar dataKey="growth" radius={[0, 5, 5, 0]}>
                            {marketMacroGrowthData.map((entry) => <Cell key={`macro-growth-${entry.country}`} fill={entry.growth >= 0 ? "var(--viz-positive)" : "var(--viz-negative)"} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {marketMacroGrowthData.length === 0 && <div className="product-state">World Development Indicators will appear after the next market ingestion run.</div>}
                  </div>
                  <div className={`${cardBase} min-w-0 overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Macro comparison</div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">Growth, inflation, labour and external balance</div>
                    </div>
                    <div className="app-scroll-panel max-h-[22rem] overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead className="sticky top-0 bg-[color:var(--shell-surface)] text-left text-[color:var(--shell-muted)]">
                          <tr><th className="px-3 py-2">Country</th><th className="px-3 py-2">GDP</th><th className="px-3 py-2">Inflation</th><th className="px-3 py-2">Unemployment</th><th className="px-3 py-2">Current account</th></tr>
                        </thead>
                        <tbody>
                          {marketCountryRows.filter((row) => row.gdp_growth != null || row.inflation != null).map((row) => (
                            <tr key={`macro-ledger-${row.country}`} onClick={() => setSelectedCountry(row.country)} className="cursor-pointer border-t border-[color:var(--shell-border)] text-[color:var(--shell-ink)] hover:bg-[color:var(--shell-surface)]">
                              <td className="px-3 py-2"><strong>{row.country}</strong><small className="block text-[color:var(--shell-muted)]">{row.macro_latest_year ?? "—"}</small></td>
                              <td className="px-3 py-2">{formatSignedMetric(row.gdp_growth, 1, "%")}<small className="block text-[color:var(--shell-muted)]">{row.gdp_year ?? "—"}</small></td>
                              <td className="px-3 py-2">{row.inflation == null ? "—" : `${formatMetricNumber(row.inflation, { maximumFractionDigits: 1 })}%`}<small className="block text-[color:var(--shell-muted)]">{row.inflation_year ?? "—"}</small></td>
                              <td className="px-3 py-2">{row.unemployment == null ? "—" : `${formatMetricNumber(row.unemployment, { maximumFractionDigits: 1 })}%`}<small className="block text-[color:var(--shell-muted)]">{row.unemployment_year ?? "—"}</small></td>
                              <td className="px-3 py-2">{formatSignedMetric(row.current_account, 1, "%")}<small className="block text-[color:var(--shell-muted)]">{row.current_account_year ?? "—"}</small></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="border-t border-[color:var(--shell-border)] px-4 py-3 text-[11px] text-[color:var(--shell-muted)]">World Bank WDI · annual values · each indicator shows its own observation year. Select a country for complete provenance and history.</p>
                  </div>
                </section>

                <section className="kpi-strip grid grid-cols-2 gap-3 xl:grid-cols-5">
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Country coverage
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {countryMarketCoverage.countries}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Mapped market regimes
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      FX coverage
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {countryMarketCoverage.fx}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      ECB-linked currencies
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      Country indices
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {countryMarketCoverage.indices}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      latest configured benchmark series
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                      SEC activity
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
                      {countryMarketCoverage.filings}
                    </div>
                    <div className="text-xs text-[color:var(--shell-muted)]">
                      Filings in trailing 7 days
                    </div>
                  </div>
                  <div className="app-stat-card rounded-2xl p-4">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Macro coverage</div>
                    <div className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">{countryMarketCoverage.macro}</div>
                    <div className="text-xs text-[color:var(--shell-muted)]">World Bank country profiles</div>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <section className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Methodology</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">How the country regime is calculated</div>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div><dt className="font-semibold text-[color:var(--shell-ink)]">Index</dt><dd className="text-[color:var(--shell-muted)]">{countryMarketMethodology?.index ?? "No licensed country-index provider configured."}</dd></div>
                      <div><dt className="font-semibold text-[color:var(--shell-ink)]">Currency</dt><dd className="text-[color:var(--shell-muted)]">{countryMarketMethodology?.fx ?? "ECB reference rates are not loaded."}</dd></div>
                      <div><dt className="font-semibold text-[color:var(--shell-ink)]">Macro</dt><dd className="text-[color:var(--shell-muted)]">{countryMarketMethodology?.macro ?? "World Bank indicators are not loaded."}</dd></div>
                    </dl>
                  </section>

                  <section className={`${cardBase} p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Interpretation guardrails</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Comparable signals, explicit gaps</div>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div><dt className="font-semibold text-[color:var(--shell-ink)]">Composite</dt><dd className="text-[color:var(--shell-muted)]">{countryMarketMethodology?.composite ?? "Unavailable."}</dd></div>
                      <div><dt className="font-semibold text-[color:var(--shell-ink)]">Filings</dt><dd className="text-[color:var(--shell-muted)]">{countryMarketMethodology?.filings ?? "Unavailable."}</dd></div>
                    </dl>
                  </section>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">National benchmark direction</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Largest latest moves · frequency and source vary by country</div>
                    <div className="mt-3 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={marketIndexMoversData} layout="vertical" margin={{ left: 8, right: 18 }}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis type="number" unit="%" />
                          <YAxis type="category" dataKey="country" width={36} />
                          <Tooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, "Monthly change"]} />
                          <Bar dataKey="change" radius={[0, 5, 5, 0]}>
                            {marketIndexMoversData.map((entry) => <Cell key={`oecd-mover-${entry.country}`} fill={entry.change >= 0 ? "var(--viz-positive)" : "var(--viz-negative)"} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {marketIndexMoversData.length === 0 && <div className="product-state">No configured national benchmark observations are loaded. The market ingestion must complete before this chart can render.</div>}
                  </div>
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">ECB currency direction</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Largest daily local-currency moves versus EUR</div>
                    <div className="mt-3 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={marketFxMoversData} layout="vertical" margin={{ left: 8, right: 18 }}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis type="number" unit="%" />
                          <YAxis type="category" dataKey="currency" width={38} />
                          <Tooltip formatter={(value) => [`${Number(value).toFixed(3)}%`, "Daily change"]} />
                          <Bar dataKey="change" radius={[0, 5, 5, 0]}>
                            {marketFxMoversData.map((entry) => <Cell key={`fx-mover-${entry.country}`} fill={entry.change >= 0 ? "var(--viz-positive)" : "var(--viz-negative)"} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {marketFxMoversData.length === 0 && <div className="product-state">No ECB reference-rate changes are loaded.</div>}
                  </div>
                </section>

                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                  <div className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Cross-market relationship</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Monthly equity direction versus daily FX direction</div>
                    <div className="mt-3 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis type="number" dataKey="index" name="National benchmark" unit="%" />
                          <YAxis type="number" dataKey="fx" name="FX daily" unit="%" />
                          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                          <Scatter name="Countries" data={marketRelationshipData} fill="var(--viz-market)" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-[11px] text-[color:var(--shell-muted)]">Quadrants show whether national share prices and the local currency point in the same or opposing directions. Frequencies differ, so this is context—not correlation or causation.</p>
                  </div>
                  <div className={`${cardBase} min-w-0 overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Country regime ledger</div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">Every mapped benchmark, ECB and SEC component</div>
                    </div>
                    <div className="app-scroll-panel max-h-[31rem] overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead className="sticky top-0 bg-[color:var(--shell-surface)] text-left text-[color:var(--shell-muted)]">
                          <tr><th className="px-3 py-2">Country</th><th className="px-3 py-2">Benchmark</th><th className="px-3 py-2">ECB FX</th><th className="px-3 py-2">GDP / inflation</th><th className="px-3 py-2">Composite</th><th className="px-3 py-2">SEC 7d</th><th className="px-3 py-2">Freshness</th></tr>
                        </thead>
                        <tbody>
                          {marketCountryRows.map((row) => (
                            <tr key={`country-regime-${row.country}`} onClick={() => setSelectedCountry(row.country)} className="cursor-pointer border-t border-[color:var(--shell-border)] text-[color:var(--shell-ink)] hover:bg-[color:var(--shell-surface)]">
                              <td className="px-3 py-2"><strong>{row.country}</strong><span className="ml-2 text-[color:var(--shell-muted)]">{row.country_name}</span></td>
                              <td className="px-3 py-2"><strong>{formatSignedMetric(row.index_change_percent, 2, "%")}</strong><small className="block text-[color:var(--shell-muted)]">{row.index_value == null ? "No benchmark series" : `${row.index_source ?? "source unavailable"} · ${row.index_frequency ?? "—"} · ${row.index_period_end ?? "—"}`}</small></td>
                              <td className="px-3 py-2"><strong>{row.currency ?? "—"} {formatSignedMetric(row.fx_change_percent, 3, "%")}</strong><small className="block text-[color:var(--shell-muted)]">{row.fx_rate == null ? "No ECB rate" : `${formatMetricNumber(row.fx_rate, { maximumFractionDigits: 4 })} per EUR · ${row.fx_period_end ?? "—"}`}</small></td>
                              <td className="px-3 py-2"><strong>{formatSignedMetric(row.gdp_growth, 1, "%")}</strong><small className="block text-[color:var(--shell-muted)]">Inflation {row.inflation == null ? "—" : `${formatMetricNumber(row.inflation, { maximumFractionDigits: 1 })}%`} · {row.macro_latest_year ?? "—"}</small></td>
                              <td className={`px-3 py-2 font-semibold ${(row.composite_change_percent ?? 0) >= 0 ? "text-[color:var(--viz-positive)]" : "text-[color:var(--viz-negative)]"}`}>{formatSignedMetric(row.composite_change_percent, 2, "%")}</td>
                              <td className="px-3 py-2">{row.filing_count_7d}</td>
                              <td className="px-3 py-2 capitalize text-[color:var(--shell-muted)]">{row.freshness}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {marketCountryRows.length === 0 && <div className="product-state m-3">No country market regimes match the active scope.</div>}
                    </div>
                  </div>
                </section>

                {marketCommodityMoversData.length > 0 && (
                  <section className={`${cardBase} min-w-0 p-4`}>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">Global commodity monitor</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--shell-ink)]">Latest public-institution energy spot prices and history</div>
                    <div className="mt-3 h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={marketCommodityMoversData} layout="vertical" margin={{ left: 16, right: 22 }}>
                          <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                          <XAxis type="number" unit="%" />
                          <YAxis type="category" dataKey="name" width={112} />
                          <Tooltip formatter={(value, key, item) => key === "percent_change"
                            ? [`${Number(value).toFixed(2)}%`, "Latest change"]
                            : [String(value), String(item.name)]} />
                          <Bar dataKey="percent_change" radius={[0, 5, 5, 0]}>
                            {marketCommodityMoversData.map((entry) => (
                              <Cell key={`commodity-${entry.symbol}`} fill={entry.percent_change >= 0 ? "var(--viz-positive)" : "var(--viz-negative)"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 space-y-1 text-[11px] text-[color:var(--shell-muted)]">
                      <p>These are global energy context series; their U.S. source jurisdiction is not treated as U.S. economic performance.</p>
                      <p>This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.</p>
                      <a
                        href="https://fred.stlouisfed.org/docs/api/terms_of_use.html"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[color:var(--signal-cyan)] hover:underline"
                      >
                        FRED API Terms of Use <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  </section>
                )}

                {marketPageRows.length > 0 && <>
                <section className="market-primary-grid grid grid-cols-1 gap-4 xl:grid-cols-[0.82fr_1.18fr]">
                  <div className={`${cardBase} watchlist-panel overflow-hidden`}>
                    <div className="border-b border-[color:var(--shell-border)] px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.3em] text-[color:var(--shell-muted)]">
                        Watchlist
                      </div>
                      <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                        Select a symbol to relate with weather and news
                      </div>
                    </div>
                    <div className="app-scroll-panel max-h-[56vh] min-h-[20rem] overflow-y-auto p-3 space-y-2">
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
                              if (quote.country && quote.scope === "country") setSelectedCountry(quote.country.toUpperCase());
                            }}
                            className={`analytics-row market-row w-full rounded-lg px-3 py-2 text-left transition ${
                              selected
                                ? "border-[color:var(--signal-emerald)] bg-[color:var(--signal-emerald-soft)]"
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
                                    <span className="inline-flex rounded-full border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-2 py-0.5 text-[10px] text-[color:var(--shell-ink)]">
                                      {source}
                                    </span>
                                    {market.name && (
                                      <span className="inline-flex rounded-full border border-[color:var(--signal-amber)] bg-[color:var(--signal-amber-soft)] px-2 py-0.5 text-[10px] text-[color:var(--shell-ink)]">
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
                                <div className={`text-xs ${isPositive ? "text-[color:var(--viz-positive)]" : isNegative ? "text-rose-600" : "text-[color:var(--shell-muted)]"}`}>
                                  {quote.percent_change != null
                                    ? `${quote.percent_change >= 0 ? "+" : ""}${quote.percent_change.toFixed(2)}%`
                                    : "—"}
                                </div>
                                <a
                                  href={marketQuoteUrl(quote) ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="mt-1 inline-block rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-0.5 text-[10px] text-[color:var(--shell-muted)] hover:border-[color:var(--shell-ink)] hover:text-[color:var(--shell-ink)]"
                                >
                                  Open source
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

                  <div className={`${cardBase} symbol-workspace p-4`}>
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
                        <div className="symbol-performance">
                          <div>
                            <span>Last price</span>
                            <strong>
                              {selectedSymbolQuote.price ?? "—"} {selectedSymbolQuote.currency ?? ""}
                            </strong>
                          </div>
                          <div>
                            <span>Session move</span>
                            <strong
                              className={
                                (selectedSymbolQuote.percent_change ?? 0) >= 0
                                  ? "positive"
                                  : "negative"
                              }
                            >
                              {selectedSymbolQuote.percent_change != null
                                ? `${selectedSymbolQuote.percent_change >= 0 ? "+" : ""}${selectedSymbolQuote.percent_change.toFixed(2)}%`
                                : "—"}
                            </strong>
                          </div>
                          <div>
                            <span>Session range</span>
                            <strong>
                              {selectedSymbolQuote.low_price ?? "—"}–{selectedSymbolQuote.high_price ?? "—"}
                            </strong>
                          </div>
                          <div className="session-range" aria-label="Price position within the session range">
                            <span
                              style={{
                                width: `${Math.max(
                                  4,
                                  Math.min(
                                    100,
                                    (((selectedSymbolQuote.price ?? selectedSymbolQuote.low_price ?? 0) -
                                      (selectedSymbolQuote.low_price ?? 0)) /
                                      Math.max(
                                        0.0001,
                                        (selectedSymbolQuote.high_price ?? 0) -
                                          (selectedSymbolQuote.low_price ?? 0),
                                      )) *
                                      100,
                                  ),
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                        {selectedSymbolHistoryData.length > 1 && (
                          <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs">
                            <div className="font-semibold text-[color:var(--shell-ink)]">Observation history</div>
                            <div className="mt-1 text-[color:var(--shell-muted)]">
                              {selectedSymbolQuote.frequency ?? "Unknown frequency"} · {selectedSymbolQuote.source_name ?? "source unavailable"} · {selectedSymbolHistoryData.length} observations
                            </div>
                            <div className="mt-2 h-40">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={selectedSymbolHistoryData}>
                                  <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                                  <XAxis dataKey="period" minTickGap={28} />
                                  <YAxis domain={["auto", "auto"]} width={52} />
                                  <Tooltip formatter={(value) => [formatMetricNumber(Number(value), { maximumFractionDigits: 4 }), selectedSymbolQuote.unit ?? "Level"]} />
                                  <Area type="monotone" dataKey="value" stroke="var(--viz-market)" fill="var(--viz-market-soft)" fillOpacity={0.38} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
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
                              {item.translated_title ? "AI translation · " : ""}{newsDisplayTitle(item)}
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
                                fill={entry.percent_change >= 0 ? ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] : "var(--viz-negative)"}
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
                                fill={entry.avg_change >= 0 ? "var(--viz-positive)" : "var(--viz-negative)"}
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
                                  ? "text-[color:var(--viz-positive)]"
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
                </>}
              </div>
            )}
            {activeView === "transport" && (
              <div className="space-y-4">
                <IntelligenceEventStrip
                  country={selectedCountry}
                  onOpen={handleOpenIntelligence}
                />
                <TransportWorkspace initialCountry={transportFocusCountry} />
              </div>
            )}
            {activeView === "intelligence" && (
              <div className="space-y-3">
                <IntelligenceWorkspace
                  initialCountry={selectedCountry}
                  initialEventId={selectedIntelligenceEventId}
                  onSelectEvent={handleOpenIntelligence}
                  onOpenImagery={handleOpenImagery}
                />
              </div>
            )}
            {activeView === "earth-observation" && (
              <div className="space-y-4">
                {!selectedIntelligenceEventId && (
                  <IntelligenceEventStrip
                    country={selectedCountry}
                    onOpen={handleOpenIntelligence}
                  />
                )}
                <EarthObservationWorkspace
                  eventId={selectedIntelligenceEventId}
                  onOpenEvent={handleOpenIntelligence}
                />
              </div>
            )}
            {activeView === "admin" && isAdmin && (
              <AdminWorkspace dark={dark} />
            )}
            {activeView === "profile" && (
              <div className="settings-page space-y-6">
                <div className="settings-intro flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[color:var(--shell-muted)]">
                      Signed-in account
                    </div>
                    <h1
                      className="mt-2 text-3xl font-semibold text-[color:var(--shell-ink)]"
                    >
                      {userLabel}
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm text-[color:var(--shell-muted)]">
                      {authUser?.email ?? "Email not provided"} ·{" "}
                      {authUser?.roles?.length
                        ? authUser.roles.join(", ")
                        : "Standard access"}
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
                              <span className="font-semibold text-[color:var(--viz-positive)]">
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
                                      ? "bg-[color:var(--signal-emerald-soft)] text-[color:var(--shell-ink)]"
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
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="font-semibold text-[color:var(--shell-ink)]">
                                  Daily briefing
                                </div>
                                <div className="text-xs text-[color:var(--shell-muted)]">
                                  Scheduled at {dailyBriefingScheduleDraft.scheduled_time}{" "}
                                  {dailyBriefingScheduleDraft.timezone}
                                </div>
                              </div>
                              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--shell-ink)]">
                                <input
                                  type="checkbox"
                                  checked={dailyBriefingScheduleDraft.enabled}
                                  onChange={(event) => {
                                    const enabled = event.currentTarget.checked;
                                    setDailyBriefingScheduleDraft((current) => ({
                                      ...current,
                                      enabled,
                                    }));
                                  }}
                                  className="h-4 w-4 rounded border-[color:var(--shell-border)]"
                                />
                                Enabled
                              </label>
                            </div>
                            <div className="mt-4 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-soft)] px-3 py-3">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <label className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--shell-ink)]">
                                  <input
                                    type="checkbox"
                                    checked={dailyBriefingScheduleDraft.email_enabled}
                                    onChange={(event) => {
                                      const emailEnabled = event.currentTarget.checked;
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        email_enabled: emailEnabled,
                                      }));
                                    }}
                                    className="h-4 w-4 rounded border-[color:var(--shell-border)]"
                                  />
                                  Email this briefing to me
                                </label>
                                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-[color:var(--shell-muted)]">
                                  <span className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 font-semibold text-[color:var(--shell-ink)]">
                                    {dailyBriefingEmailSubscriptionLabel}
                                  </span>
                                  <span>
                                    {dailyBriefingEmailStatus?.recipient || "No account email"} ·{" "}
                                    {dailyBriefingEmailStatus?.recipient_verified
                                      ? "verified"
                                      : "not verified"}
                                    {" · "}
                                    {dailyBriefingEmailStatus?.configured
                                      ? "SMTP ready"
                                      : "SMTP setup required"}
                                  </span>
                                </div>
                              </div>
                              {!dailyBriefingEmailStatus?.recipient_verified && dailyBriefingEmailStatus?.configured && (
                                <button type="button" onClick={() => void handleRequestEmailVerification()} className="mt-2 text-xs font-semibold text-[color:var(--shell-accent)] underline">
                                  Send verification email
                                </button>
                              )}
                              <div className="mt-3 flex flex-col gap-2 border-t border-[color:var(--shell-border)] pt-3 sm:flex-row sm:items-end sm:justify-between">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                                  Email &amp; map appearance
                                  <select
                                    value={dailyBriefingScheduleDraft.email_theme}
                                    onChange={(event) => {
                                      const emailTheme =
                                        event.currentTarget.value === "light" ? "light" : "dark";
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        email_theme: emailTheme,
                                      }));
                                    }}
                                    className="mt-1 block min-w-40 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--shell-ink)]"
                                  >
                                    <option value="dark">Dark</option>
                                    <option value="light">Light</option>
                                  </select>
                                </label>
                                <div className="flex flex-col items-start gap-1 sm:items-end">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        email_theme: dark ? "dark" : "light",
                                      }))
                                    }
                                    className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--shell-ink)]"
                                  >
                                    Match current website ({dark ? "Dark" : "Light"})
                                  </button>
                                  <span className="text-xs text-[color:var(--shell-muted)]">
                                    Applied to the newsletter and its geospatial map.
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="mt-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                                Personalise the briefing
                              </div>
                              <p className="mt-1 text-xs text-[color:var(--shell-muted)]">
                                Followed companies always qualify. Industry and geography selections
                                narrow the remaining signals. Leave every field empty for a general
                                briefing. Use Ctrl/Cmd to select more than one item.
                              </p>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="text-xs font-semibold text-[color:var(--shell-ink)]">
                                  Industries
                                  <select
                                    multiple
                                    size={5}
                                    value={dailyBriefingScheduleDraft.industries}
                                    disabled={!dailyBriefingPreferenceOptions}
                                    onChange={(event) => {
                                      const industries = Array.from(
                                        event.currentTarget.selectedOptions,
                                        (option) => option.value,
                                      );
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        industries,
                                      }));
                                    }}
                                    className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-sm font-normal text-[color:var(--shell-ink)]"
                                  >
                                    {(dailyBriefingPreferenceOptions?.industries || []).map(
                                      (industry) => (
                                        <option key={industry} value={industry}>
                                          {industry}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                </label>
                                <label className="text-xs font-semibold text-[color:var(--shell-ink)]">
                                  Companies
                                  <select
                                    multiple
                                    size={5}
                                    value={dailyBriefingScheduleDraft.company_symbols}
                                    disabled={!dailyBriefingPreferenceOptions}
                                    onChange={(event) => {
                                      const companySymbols = Array.from(
                                        event.currentTarget.selectedOptions,
                                        (option) => option.value,
                                      );
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        company_symbols: companySymbols,
                                      }));
                                    }}
                                    className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-sm font-normal text-[color:var(--shell-ink)]"
                                  >
                                    {(dailyBriefingPreferenceOptions?.companies || []).map(
                                      (company) => (
                                        <option key={company.symbol} value={company.symbol}>
                                          {company.symbol}
                                          {company.company_name ? ` — ${company.company_name}` : ""}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                </label>
                                <label className="text-xs font-semibold text-[color:var(--shell-ink)]">
                                  Countries
                                  <select
                                    multiple
                                    size={5}
                                    value={dailyBriefingScheduleDraft.country_iso2s}
                                    disabled={!dailyBriefingPreferenceOptions}
                                    onChange={(event) => {
                                      const countryIso2s = Array.from(
                                        event.currentTarget.selectedOptions,
                                        (option) => option.value,
                                      );
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        country_iso2s: countryIso2s,
                                      }));
                                    }}
                                    className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-sm font-normal text-[color:var(--shell-ink)]"
                                  >
                                    {(dailyBriefingPreferenceOptions?.countries || []).map(
                                      (country) => (
                                        <option key={country.iso2} value={country.iso2}>
                                          {country.name} ({country.iso2})
                                        </option>
                                      ),
                                    )}
                                  </select>
                                </label>
                                <label className="text-xs font-semibold text-[color:var(--shell-ink)]">
                                  Regions
                                  <select
                                    multiple
                                    size={5}
                                    value={dailyBriefingScheduleDraft.regions}
                                    disabled={!dailyBriefingPreferenceOptions}
                                    onChange={(event) => {
                                      const regions = Array.from(
                                        event.currentTarget.selectedOptions,
                                        (option) => option.value,
                                      );
                                      setDailyBriefingScheduleDraft((current) => ({
                                        ...current,
                                        regions,
                                      }));
                                    }}
                                    className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-2 text-sm font-normal text-[color:var(--shell-ink)]"
                                  >
                                    {(dailyBriefingPreferenceOptions?.regions || []).map((region) => (
                                      <option key={region} value={region}>
                                        {region}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_130px_auto] md:items-end">
                              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                                Time
                                <select
                                  value={dailyBriefingScheduleDraft.scheduled_time}
                                  onChange={(event) => {
                                    const scheduledTime = event.currentTarget.value;
                                    setDailyBriefingScheduleDraft((current) => ({
                                      ...current,
                                      scheduled_time: scheduledTime,
                                    }));
                                  }}
                                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--shell-ink)]"
                                >
                                  {dailyBriefingTimeOptions.map((time) => (
                                    <option key={time} value={time}>
                                      {time}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                                Timezone
                                <select
                                  value={dailyBriefingScheduleDraft.timezone}
                                  onChange={(event) => {
                                    const timezone = event.currentTarget.value;
                                    setDailyBriefingScheduleDraft((current) => ({
                                      ...current,
                                      timezone,
                                    }));
                                  }}
                                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--shell-ink)]"
                                >
                                  {dailyBriefingTimezoneOptions.map((timezone) => (
                                    <option key={timezone} value={timezone}>
                                      {timezone}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                                Max signals
                                <select
                                  value={dailyBriefingScheduleDraft.max_items}
                                  onChange={(event) => {
                                    const maxItems = Number(event.currentTarget.value);
                                    setDailyBriefingScheduleDraft((current) => ({
                                      ...current,
                                      max_items: maxItems,
                                    }));
                                  }}
                                  className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--shell-ink)]"
                                >
                                  {[3, 5, 10, 15, 20, 25].map((count) => (
                                    <option key={count} value={count}>
                                      {count}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveDailyBriefingSchedule()}
                                  disabled={isSavingDailyBriefingSchedule || isLoadingDailyBriefingSchedule}
                                  className="inline-flex items-center justify-center rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--shell-on-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isSavingDailyBriefingSchedule ? "Saving…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSendDailyBriefingPreview()}
                                  disabled={isSendingDailyBriefingPreview || isSavingDailyBriefingSchedule}
                                  className="inline-flex items-center justify-center rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--shell-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isSendingDailyBriefingPreview ? "Sending…" : "Send preview"}
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--shell-muted)]">
                              <span>
                                Last run:{" "}
                                {dailyBriefingSchedule?.last_triggered_at
                                  ? new Date(dailyBriefingSchedule.last_triggered_at).toLocaleString()
                                  : "Not yet"}
                              </span>
                              {dailyBriefingSchedule?.last_scheduled_for && (
                                <span>Schedule date: {dailyBriefingSchedule.last_scheduled_for}</span>
                              )}
                            </div>
                            {dailyBriefingScheduleNotice && (
                              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                {dailyBriefingScheduleNotice}
                              </div>
                            )}
                            {dailyBriefingScheduleError && (
                              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                {dailyBriefingScheduleError}
                              </div>
                            )}
                          </div>
                          <div className="rounded-xl border border-[color:var(--shell-border)] px-4 py-3">
                            <div className="font-semibold text-[color:var(--shell-ink)]">
                              Default map view
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => setMapMode("signals")}
                                className={`rounded-full border px-3 py-1 ${
                                  mapMode === "signals"
                                    ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                    : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
                                }`}
                              >
                                Signals
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMapMode("news");
                                  setListMode("news");
                                }}
                                className={`rounded-full border px-3 py-1 ${
                                  mapMode === "news"
                                    ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                    : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
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
                                    ? "border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] text-[color:var(--shell-on-strong)]"
                                    : "border-[color:var(--shell-border)] text-[color:var(--shell-muted)]"
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
              <div className="document-page space-y-6">
                <div className="document-intro">
                  <div className="text-xs font-semibold text-[color:var(--shell-muted)]">
                    Claritas product governance
                  </div>
                  <h1
                    className="mt-2 text-3xl font-semibold text-[color:var(--shell-ink)]"
                  >
                    Policies and usage guidelines
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-[color:var(--shell-muted)]">
                    Review the policy summaries below. Each section describes
                    how Claritas protects data, governs platform use, and
                    supports compliance.
                  </p>
                </div>

                <div className="document-layout">
                  <aside className="document-toc" aria-label="Policy sections">
                    <span>On this page</span>
                    {legalPolicies.map((policy, index) => (
                      <a key={`toc-${policy.id}`} href={`#${policy.id}`}>
                        <small>{String(index + 1).padStart(2, "0")}</small>
                        {policy.title}
                      </a>
                    ))}
                  </aside>
                  <div className="document-content">
                    {legalPolicies.map((policy, index) => (
                      <article
                        key={policy.id}
                        id={policy.id}
                        className="policy-section scroll-mt-24"
                      >
                        <div className="policy-number">{String(index + 1).padStart(2, "0")}</div>
                        <h2>{policy.title}</h2>
                        <p className="policy-lead">{policy.intro}</p>
                        <ul>
                          {policy.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        <p className="policy-note">{policy.note}</p>
                      </article>
                    ))}
                  </div>
                </div>

                <details className="document-reference rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4">
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
      <nav className="mobile-ops-nav app-safe-bottom" aria-label="Primary mobile navigation">
        {navItems
          .filter((item) => ["dashboard", "admin", "profile", "legal"].includes(item.id))
          .map((item) => {
            const Icon = item.icon;
            const active = activeView === item.view || (
              item.view === "dashboard" &&
              OVERVIEW_DRILLDOWN_VIEWS.has(activeView)
            );
            return (
              <button
                key={`mobile-ops-${item.id}`}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveView(item.view)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
      </nav>
    </div>
  );
}
