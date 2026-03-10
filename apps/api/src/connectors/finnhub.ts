import crypto from "node:crypto";
import { query } from "../db";
import { inferNewsCountry } from "./country-inference";

type FinnhubQuoteResponse = {
  c?: number; // current price
  d?: number; // change
  dp?: number; // percent change
  h?: number; // high
  l?: number; // low
  o?: number; // open
  pc?: number; // previous close
  t?: number; // unix timestamp (seconds in docs sample)
  error?: string;
  [key: string]: unknown;
};

type FinnhubCompanyProfile2Response = {
  ticker?: string;
  name?: string;
  exchange?: string;
  country?: string;
  currency?: string;
  logo?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
  shareOutstanding?: number;
  ipo?: string;
  weburl?: string;
  phone?: string;
  [key: string]: unknown;
};

type FinnhubMarketStatusResponse = {
  exchange?: string;
  holiday?: string | null;
  isOpen?: boolean | null;
  session?: string | null;
  timezone?: string | null;
  t?: number | null;
  [key: string]: unknown;
};

type FinnhubEarningsCalendarItem = {
  symbol?: string;
  date?: string;
  hour?: string | null;
  quarter?: number | null;
  year?: number | null;
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  [key: string]: unknown;
};

type FinnhubEarningsCalendarResponse = {
  earningsCalendar?: FinnhubEarningsCalendarItem[];
  [key: string]: unknown;
};

type FinnhubMarketNewsItem = {
  id?: number;
  category?: string;
  datetime?: number;
  headline?: string;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
  [key: string]: unknown;
};

type DbTimestamp = string | Date;

type MarketSnapshotRow = {
  symbol: string;
  company_name: string | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  price: number | null;
  change: number | null;
  percent_change: number | null;
  high_price: number | null;
  low_price: number | null;
  open_price: number | null;
  previous_close: number | null;
  observed_at: DbTimestamp;
  payload: unknown;
};

type SymbolMetadata = {
  company_name: string;
  exchange: string;
  country: string;
  currency: string;
  logo_url?: string;
  market_code?: string;
  market_name?: string;
  market_kind?: string;
  industry?: string;
  market_cap?: number;
  share_outstanding?: number;
  ipo?: string;
  web_url?: string;
  phone?: string;
};

const FINNHUB_BASE_URL = "https://api.finnhub.io/api/v1";
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,23}$/;
const MAX_SYMBOLS_PER_REQUEST = 25;

type DefaultMarketBenchmark = {
  symbol: string;
  company_name: string;
  exchange: string;
  country: string;
  currency: string;
  market_code: string;
  market_name: string;
  market_kind: "index_proxy";
};

const DEFAULT_MARKET_BENCHMARKS: DefaultMarketBenchmark[] = [
  {
    symbol: "SPY",
    company_name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSEARCA",
    country: "US",
    currency: "USD",
    market_code: "SPX",
    market_name: "S&P 500",
    market_kind: "index_proxy",
  },
  {
    symbol: "QQQ",
    company_name: "Invesco QQQ Trust",
    exchange: "NASDAQ",
    country: "US",
    currency: "USD",
    market_code: "NASDAQ100",
    market_name: "NASDAQ 100",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWQ",
    company_name: "iShares MSCI France ETF",
    exchange: "NYSEARCA",
    country: "FR",
    currency: "USD",
    market_code: "CAC40",
    market_name: "CAC 40",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWG",
    company_name: "iShares MSCI Germany ETF",
    exchange: "NYSEARCA",
    country: "DE",
    currency: "USD",
    market_code: "DAX30",
    market_name: "DAX 30",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWU",
    company_name: "iShares MSCI United Kingdom ETF",
    exchange: "NYSEARCA",
    country: "GB",
    currency: "USD",
    market_code: "FTSE100",
    market_name: "FTSE 100",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWJ",
    company_name: "iShares MSCI Japan ETF",
    exchange: "NYSEARCA",
    country: "JP",
    currency: "USD",
    market_code: "NIKKEI225",
    market_name: "Nikkei 225",
    market_kind: "index_proxy",
  },
  {
    symbol: "MCHI",
    company_name: "iShares MSCI China ETF",
    exchange: "NASDAQ",
    country: "CN",
    currency: "USD",
    market_code: "CSI300",
    market_name: "CSI 300",
    market_kind: "index_proxy",
  },
  {
    symbol: "INDA",
    company_name: "iShares MSCI India ETF",
    exchange: "BATS",
    country: "IN",
    currency: "USD",
    market_code: "NIFTY50",
    market_name: "NIFTY 50",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWA",
    company_name: "iShares MSCI Australia ETF",
    exchange: "NYSEARCA",
    country: "AU",
    currency: "USD",
    market_code: "ASX200",
    market_name: "ASX 200",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWC",
    company_name: "iShares MSCI Canada ETF",
    exchange: "NYSEARCA",
    country: "CA",
    currency: "USD",
    market_code: "TSX",
    market_name: "S&P/TSX Composite",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWZ",
    company_name: "iShares MSCI Brazil ETF",
    exchange: "NYSEARCA",
    country: "BR",
    currency: "USD",
    market_code: "IBOVESPA",
    market_name: "Ibovespa",
    market_kind: "index_proxy",
  },
  {
    symbol: "EZA",
    company_name: "iShares MSCI South Africa ETF",
    exchange: "NYSEARCA",
    country: "ZA",
    currency: "USD",
    market_code: "JSE40",
    market_name: "FTSE/JSE Top 40",
    market_kind: "index_proxy",
  },
  {
    symbol: "EWW",
    company_name: "iShares MSCI Mexico ETF",
    exchange: "NYSEARCA",
    country: "MX",
    currency: "USD",
    market_code: "IPC",
    market_name: "S&P/BMV IPC",
    market_kind: "index_proxy",
  },
];

export const DEFAULT_MARKET_SYMBOLS = DEFAULT_MARKET_BENCHMARKS.map((entry) => entry.symbol);

const DEFAULT_SYMBOL_METADATA: Record<string, SymbolMetadata> = DEFAULT_MARKET_BENCHMARKS.reduce(
  (acc, entry) => {
    acc[entry.symbol] = {
      company_name: entry.company_name,
      exchange: entry.exchange,
      country: entry.country,
      currency: entry.currency,
      market_code: entry.market_code,
      market_name: entry.market_name,
      market_kind: entry.market_kind,
    };
    return acc;
  },
  {} as Record<string, SymbolMetadata>
);

const COUNTRY_PRIMARY_MARKETS: Record<string, { code: string; name: string }> = {
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

const DEFAULT_MARKET_STATUS_EXCHANGES = [
  "US",
  "GB",
  "DE",
  "FR",
  "JP",
  "CN",
  "IN",
  "AU",
  "CA",
  "BR",
  "ZA",
  "MX",
] as const;

const MARKET_NEWS_CATEGORIES = new Set(["general", "forex", "crypto", "merger"]);
const DEFAULT_MARKET_NEWS_CATEGORY = "general";
const MAX_MARKET_NEWS_ITEMS = 100;
const MARKET_STATUS_CACHE_TTL_MS = 60_000;

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

let activeRealtimeRefresh: Promise<void> | null = null;
let lastRealtimeRefreshAt = 0;
let lastRealtimeSymbolsKey = "";
const profileMetadataCache = new Map<string, Partial<SymbolMetadata>>();
let marketStatusCache:
  | {
      key: string;
      fetchedAt: number;
      rows: MarketStatus[];
    }
  | null = null;

function toTimestampString(value: DbTimestamp): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function toIsoFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRelatedSymbols(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((part) => part.trim().toUpperCase())
        .filter((part) => SYMBOL_PATTERN.test(part))
    )
  );
}

function withMarketIdentity(metadata: Partial<SymbolMetadata>, symbol: string): Partial<SymbolMetadata> {
  const normalizedCountry =
    typeof metadata.country === "string" && metadata.country.trim()
      ? metadata.country.trim().toUpperCase()
      : undefined;
  const enriched: Partial<SymbolMetadata> = {
    ...metadata,
    country: normalizedCountry,
  };

  if ((!enriched.market_code || !enriched.market_name) && normalizedCountry) {
    const mapped = COUNTRY_PRIMARY_MARKETS[normalizedCountry];
    if (mapped) {
      enriched.market_code = enriched.market_code ?? mapped.code;
      enriched.market_name = enriched.market_name ?? mapped.name;
    }
  }

  if (!enriched.market_code && enriched.exchange) {
    enriched.market_code = enriched.exchange.replace(/\s+/g, "").toUpperCase();
  }
  if (!enriched.market_name && enriched.exchange) {
    enriched.market_name = enriched.exchange;
  }
  if (!enriched.market_kind) {
    if (DEFAULT_SYMBOL_METADATA[symbol]?.market_kind) {
      enriched.market_kind = DEFAULT_SYMBOL_METADATA[symbol].market_kind;
    } else if (enriched.market_code || enriched.market_name) {
      enriched.market_kind = "country_primary";
    } else if (enriched.exchange) {
      enriched.market_kind = "exchange";
    }
  }

  return enriched;
}

function normalizeSymbol(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "";
  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new Error(`Invalid market symbol: "${value}"`);
  }
  return normalized;
}

export function parseMarketSymbolsInput(raw: unknown): string[] {
  if (raw == null) return [];

  let values: string[] = [];
  if (typeof raw === "string") {
    values = raw
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  } else if (Array.isArray(raw)) {
    values = raw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
  } else {
    throw new Error("symbols must be a comma-separated string or an array of strings.");
  }

  const deduped = Array.from(new Set(values.map(normalizeSymbol).filter(Boolean)));
  if (deduped.length > MAX_SYMBOLS_PER_REQUEST) {
    throw new Error(`Too many symbols. Max allowed is ${MAX_SYMBOLS_PER_REQUEST}.`);
  }
  return deduped;
}

export function resolveMarketSymbols(raw: unknown): string[] {
  const parsed = parseMarketSymbolsInput(raw);
  return parsed.length > 0 ? parsed : [...DEFAULT_MARKET_SYMBOLS];
}

async function ensureSource() {
  const { rows } = await query<{ id: number; name: string }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider','finnhub'))
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url
     RETURNING id, name`,
    ["finnhub", FINNHUB_BASE_URL]
  );
  return rows[0];
}

async function fetchFinnhubQuote(symbol: string): Promise<FinnhubQuoteResponse> {
  const token = process.env.FINNHUB_API_KEY || "";
  if (!token) throw new Error("FINNHUB_API_KEY not set");

  const url = new URL(`${FINNHUB_BASE_URL}/quote`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`Finnhub quote HTTP ${response.status}: ${body}`);
  }
  const data = (await response.json()) as FinnhubQuoteResponse;
  if (typeof data.error === "string" && data.error.trim()) {
    throw new Error(`Finnhub quote error: ${data.error.trim()}`);
  }
  return data;
}

async function fetchFinnhubCompanyProfile2(symbol: string): Promise<Partial<SymbolMetadata>> {
  const cached = profileMetadataCache.get(symbol);
  if (cached) return cached;

  const token = process.env.FINNHUB_API_KEY || "";
  if (!token) throw new Error("FINNHUB_API_KEY not set");

  const url = new URL(`${FINNHUB_BASE_URL}/stock/profile2`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`Finnhub profile2 HTTP ${response.status}: ${body}`);
  }

  const data = (await response.json()) as FinnhubCompanyProfile2Response;
  const metadata: Partial<SymbolMetadata> = {
    company_name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined,
    exchange: typeof data.exchange === "string" && data.exchange.trim() ? data.exchange.trim() : undefined,
    country: typeof data.country === "string" && data.country.trim() ? data.country.trim().toUpperCase() : undefined,
    currency: typeof data.currency === "string" && data.currency.trim() ? data.currency.trim().toUpperCase() : undefined,
    logo_url: typeof data.logo === "string" && data.logo.trim() ? data.logo.trim() : undefined,
    industry:
      typeof data.finnhubIndustry === "string" && data.finnhubIndustry.trim()
        ? data.finnhubIndustry.trim()
        : undefined,
    market_cap: asFiniteNumber(data.marketCapitalization) ?? undefined,
    share_outstanding: asFiniteNumber(data.shareOutstanding) ?? undefined,
    ipo: typeof data.ipo === "string" && data.ipo.trim() ? data.ipo.trim() : undefined,
    web_url: typeof data.weburl === "string" && data.weburl.trim() ? data.weburl.trim() : undefined,
    phone: typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : undefined,
  };
  const enriched = withMarketIdentity(metadata, symbol);
  profileMetadataCache.set(symbol, enriched);
  return enriched;
}

async function fetchFinnhubMarketStatusRaw(exchange: string): Promise<FinnhubMarketStatusResponse> {
  const token = process.env.FINNHUB_API_KEY || "";
  if (!token) throw new Error("FINNHUB_API_KEY not set");

  const url = new URL(`${FINNHUB_BASE_URL}/stock/market-status`);
  url.searchParams.set("exchange", exchange);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`Finnhub market-status HTTP ${response.status}: ${body}`);
  }
  return (await response.json()) as FinnhubMarketStatusResponse;
}

async function fetchFinnhubEarningsCalendarRaw(params: {
  from: string;
  to: string;
  symbol?: string;
}): Promise<FinnhubEarningsCalendarResponse> {
  const token = process.env.FINNHUB_API_KEY || "";
  if (!token) throw new Error("FINNHUB_API_KEY not set");

  const url = new URL(`${FINNHUB_BASE_URL}/calendar/earnings`);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);
  if (params.symbol) {
    url.searchParams.set("symbol", params.symbol);
  }
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`Finnhub earnings-calendar HTTP ${response.status}: ${body}`);
  }
  return (await response.json()) as FinnhubEarningsCalendarResponse;
}

async function fetchFinnhubMarketNewsRaw(params: {
  category: string;
  minId?: number;
}): Promise<FinnhubMarketNewsItem[]> {
  const token = process.env.FINNHUB_API_KEY || "";
  if (!token) throw new Error("FINNHUB_API_KEY not set");

  const url = new URL(`${FINNHUB_BASE_URL}/news`);
  url.searchParams.set("category", params.category);
  if (typeof params.minId === "number" && Number.isFinite(params.minId) && params.minId > 0) {
    url.searchParams.set("minId", String(Math.trunc(params.minId)));
  }
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`Finnhub market-news HTTP ${response.status}: ${body}`);
  }
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as FinnhubMarketNewsItem[]) : [];
}

function normalizeExchangeCode(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return "";
  return trimmed.replace(/[^A-Z0-9_]/g, "");
}

function normalizeMarketNewsCategory(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_MARKET_NEWS_CATEGORY;
  const normalized = value.trim().toLowerCase();
  return MARKET_NEWS_CATEGORIES.has(normalized) ? normalized : DEFAULT_MARKET_NEWS_CATEGORY;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

async function resolveSymbolCountryMap(symbols: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const symbol of symbols) {
    const fallbackCountry = DEFAULT_SYMBOL_METADATA[symbol]?.country;
    if (fallbackCountry) {
      map.set(symbol, fallbackCountry);
    }
  }

  if (symbols.length === 0) return map;
  const { rows } = await query<{ symbol: string; country: string | null }>(
    `SELECT symbol, country
     FROM market_snapshot
     WHERE symbol = ANY($1::text[])
       AND country IS NOT NULL`,
    [symbols]
  );
  rows.forEach((row) => {
    if (!row.symbol || !row.country) return;
    map.set(row.symbol.toUpperCase(), row.country.toUpperCase());
  });
  return map;
}

function dominantCountry(countries: string[]): string | null {
  if (countries.length === 0) return null;
  const counts = new Map<string, number>();
  countries.forEach((country) => {
    const iso2 = country.toUpperCase();
    counts.set(iso2, (counts.get(iso2) ?? 0) + 1);
  });
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

async function upsertFinnhubNewsItem(params: {
  sourceId: number;
  externalId: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  countryIso2: string | null;
  eventTime: string | null;
  payload: Record<string, unknown>;
  dedupeHash: string;
}): Promise<"inserted" | "updated"> {
  const { rows } = await query<{ inserted: boolean }>(
    `INSERT INTO item (source_id, external_id, kind, title, summary, url, country_iso2, event_time, payload, dedupe_hash)
     VALUES ($1,$2,'news_article',$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (source_id, external_id)
     DO UPDATE SET
       title = COALESCE(EXCLUDED.title, item.title),
       summary = COALESCE(EXCLUDED.summary, item.summary),
       url = COALESCE(EXCLUDED.url, item.url),
       country_iso2 = COALESCE(EXCLUDED.country_iso2, item.country_iso2),
       event_time = COALESCE(EXCLUDED.event_time, item.event_time),
       payload = EXCLUDED.payload,
       dedupe_hash = EXCLUDED.dedupe_hash,
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [
      params.sourceId,
      params.externalId,
      params.title,
      params.summary,
      params.url,
      params.countryIso2,
      params.eventTime,
      JSON.stringify(params.payload),
      params.dedupeHash,
    ]
  );
  return rows[0]?.inserted ? "inserted" : "updated";
}

function toObservedAtISO(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Finnhub sample payload shows seconds, but accept ms defensively.
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

async function upsertMarketSnapshot(params: {
  sourceId: number;
  symbol: string;
  metadata: Partial<SymbolMetadata>;
  quote: FinnhubQuoteResponse;
  observedAtISO: string;
}): Promise<"inserted" | "updated"> {
  const dedupeBase = `${params.symbol}|${params.observedAtISO}|${params.quote.c ?? ""}|${params.quote.d ?? ""}`;
  const dedupeHash = crypto.createHash("sha256").update(dedupeBase).digest("hex");

  const payload = {
    provider: "finnhub",
    symbol: params.symbol,
    quote: params.quote,
    profile: {
      company_name: params.metadata.company_name ?? null,
      exchange: params.metadata.exchange ?? null,
      country: params.metadata.country ?? null,
      currency: params.metadata.currency ?? null,
      logo: params.metadata.logo_url ?? null,
      industry: params.metadata.industry ?? null,
      market_cap: params.metadata.market_cap ?? null,
      share_outstanding: params.metadata.share_outstanding ?? null,
      ipo: params.metadata.ipo ?? null,
      web_url: params.metadata.web_url ?? null,
      phone: params.metadata.phone ?? null,
    },
    market: {
      code: params.metadata.market_code ?? null,
      name: params.metadata.market_name ?? null,
      kind: params.metadata.market_kind ?? null,
      country: params.metadata.country ?? null,
    },
  };

  const { rows } = await query<{ inserted: boolean }>(
    `INSERT INTO market_snapshot (
       source_id, symbol, company_name, exchange, country, currency,
       price, change, percent_change, high_price, low_price, open_price, previous_close,
       observed_at, payload, dedupe_hash
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16
     )
     ON CONFLICT (source_id, symbol)
     DO UPDATE SET
       company_name = COALESCE(EXCLUDED.company_name, market_snapshot.company_name),
       exchange = COALESCE(EXCLUDED.exchange, market_snapshot.exchange),
       country = COALESCE(EXCLUDED.country, market_snapshot.country),
       currency = COALESCE(EXCLUDED.currency, market_snapshot.currency),
       price = EXCLUDED.price,
       change = EXCLUDED.change,
       percent_change = EXCLUDED.percent_change,
       high_price = EXCLUDED.high_price,
       low_price = EXCLUDED.low_price,
       open_price = EXCLUDED.open_price,
       previous_close = EXCLUDED.previous_close,
       observed_at = EXCLUDED.observed_at,
       payload = EXCLUDED.payload,
       dedupe_hash = EXCLUDED.dedupe_hash,
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [
      params.sourceId,
      params.symbol,
      params.metadata.company_name ?? null,
      params.metadata.exchange ?? null,
      params.metadata.country ?? null,
      params.metadata.currency ?? null,
      params.quote.c ?? null,
      params.quote.d ?? null,
      params.quote.dp ?? null,
      params.quote.h ?? null,
      params.quote.l ?? null,
      params.quote.o ?? null,
      params.quote.pc ?? null,
      params.observedAtISO,
      JSON.stringify(payload),
      dedupeHash,
    ]
  );
  return rows[0]?.inserted ? "inserted" : "updated";
}

export async function ingestFinnhubQuotes(symbolsInput?: string[] | null): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  http_failures: number;
  db_errors: number;
  last_http_status: number | null;
  last_http_error: string | null;
  last_db_error: string | null;
  symbols: string[];
}> {
  const symbols = symbolsInput && symbolsInput.length > 0 ? symbolsInput : [...DEFAULT_MARKET_SYMBOLS];
  const normalizedSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
  const source = await ensureSource();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let http_failures = 0;
  let db_errors = 0;
  let last_http_status: number | null = null;
  let last_http_error: string | null = null;
  let last_db_error: string | null = null;

  for (const symbol of normalizedSymbols) {
    try {
      const quote = await fetchFinnhubQuote(symbol);
      const observedAtISO = toObservedAtISO(quote.t);
      let metadata: Partial<SymbolMetadata> = withMarketIdentity(
        { ...(DEFAULT_SYMBOL_METADATA[symbol] ?? {}) },
        symbol
      );
      if (!metadata.country || !metadata.exchange || !metadata.company_name || !metadata.currency) {
        try {
          const remoteMetadata = await fetchFinnhubCompanyProfile2(symbol);
          metadata = {
            company_name: metadata.company_name ?? remoteMetadata.company_name,
            exchange: metadata.exchange ?? remoteMetadata.exchange,
            country: metadata.country ?? remoteMetadata.country,
            currency: metadata.currency ?? remoteMetadata.currency,
            logo_url: metadata.logo_url ?? remoteMetadata.logo_url,
            market_code: metadata.market_code ?? remoteMetadata.market_code,
            market_name: metadata.market_name ?? remoteMetadata.market_name,
            market_kind: metadata.market_kind ?? remoteMetadata.market_kind,
            industry: metadata.industry ?? remoteMetadata.industry,
            market_cap: metadata.market_cap ?? remoteMetadata.market_cap,
            share_outstanding: metadata.share_outstanding ?? remoteMetadata.share_outstanding,
            ipo: metadata.ipo ?? remoteMetadata.ipo,
            web_url: metadata.web_url ?? remoteMetadata.web_url,
            phone: metadata.phone ?? remoteMetadata.phone,
          };
        } catch {
          // Metadata enrich failures are non-fatal for quote ingestion.
        }
      }
      metadata = withMarketIdentity(metadata, symbol);
      try {
        const result = await upsertMarketSnapshot({
          sourceId: source.id,
          symbol,
          metadata,
          quote,
          observedAtISO,
        });
        if (result === "inserted") inserted += 1;
        else updated += 1;
      } catch (error) {
        skipped += 1;
        db_errors += 1;
        const message = error instanceof Error ? error.message : String(error);
        last_db_error = message.slice(0, 300);
        // eslint-disable-next-line no-console
        console.error("finnhub upsert error:", message);
      }
    } catch (error) {
      skipped += 1;
      http_failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      const statusMatch = message.match(/HTTP\s+(\d{3})/);
      if (statusMatch) {
        const parsed = Number.parseInt(statusMatch[1], 10);
        if (Number.isFinite(parsed)) last_http_status = parsed;
      }
      last_http_error = message.slice(0, 300);
    }
  }

  return {
    inserted,
    updated,
    skipped,
    http_failures,
    db_errors,
    last_http_status,
    last_http_error,
    last_db_error,
    symbols: normalizedSymbols,
  };
}

export async function getMarketQuotesLatest(symbolsInput?: string[] | null): Promise<MarketQuote[]> {
  const symbols = symbolsInput && symbolsInput.length > 0 ? Array.from(new Set(symbolsInput.map(normalizeSymbol).filter(Boolean))) : [];

  const hasFilter = symbols.length > 0;
  const { rows } = await query<MarketSnapshotRow>(
    `SELECT
       symbol,
       company_name,
       exchange,
       country,
       currency,
       price,
       change,
       percent_change,
       high_price,
       low_price,
       open_price,
       previous_close,
       observed_at,
       payload
     FROM market_snapshot
     ${hasFilter ? "WHERE symbol = ANY($1::text[])" : ""}
     ORDER BY symbol ASC`,
    hasFilter ? [symbols] : []
  );

  return rows.map((row) => {
    const payload = asRecord(row.payload);
    const market = asRecord(payload?.market);
    return {
      symbol: row.symbol,
      company_name: row.company_name,
      exchange: row.exchange,
      country: row.country,
      currency: row.currency,
      market_code: asNonEmptyString(market?.code),
      market_name: asNonEmptyString(market?.name),
      market_kind: asNonEmptyString(market?.kind),
      price: row.price,
      change: row.change,
      percent_change: row.percent_change,
      high_price: row.high_price,
      low_price: row.low_price,
      open_price: row.open_price,
      previous_close: row.previous_close,
      observed_at: toTimestampString(row.observed_at),
      payload: row.payload,
    };
  });
}

function normalizeExchangeList(values?: string[] | null): string[] {
  if (!values || values.length === 0) {
    return [...DEFAULT_MARKET_STATUS_EXCHANGES];
  }
  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeExchangeCode(value))
        .filter(Boolean)
    )
  );
  return normalized.length > 0 ? normalized : [...DEFAULT_MARKET_STATUS_EXCHANGES];
}

function normalizeDateInput(value: unknown, fallback: Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
  }
  return fallback.toISOString().slice(0, 10);
}

export async function getFinnhubMarketStatus(
  exchangesInput?: string[] | null,
  refresh = false
): Promise<MarketStatus[]> {
  const exchanges = normalizeExchangeList(exchangesInput);
  const cacheKey = exchanges.join(",");
  const now = Date.now();
  if (
    !refresh &&
    marketStatusCache &&
    marketStatusCache.key === cacheKey &&
    now - marketStatusCache.fetchedAt < MARKET_STATUS_CACHE_TTL_MS
  ) {
    return marketStatusCache.rows;
  }

  const rows: MarketStatus[] = [];
  for (const exchange of exchanges) {
    try {
      const data = await fetchFinnhubMarketStatusRaw(exchange);
      rows.push({
        exchange: asNonEmptyString(data.exchange) ?? exchange,
        is_open: typeof data.isOpen === "boolean" ? data.isOpen : null,
        session: asNonEmptyString(data.session),
        holiday: asNonEmptyString(data.holiday),
        timezone: asNonEmptyString(data.timezone),
        observed_at: toIsoFromUnixSeconds(data.t),
        payload: data as unknown,
      });
    } catch (error) {
      rows.push({
        exchange,
        is_open: null,
        session: null,
        holiday: null,
        timezone: null,
        observed_at: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  marketStatusCache = {
    key: cacheKey,
    fetchedAt: now,
    rows,
  };
  return rows;
}

export async function getFinnhubEarningsCalendar(params?: {
  from?: string;
  to?: string;
  symbol?: string;
  limit?: number;
}): Promise<EarningsEvent[]> {
  const today = new Date();
  const defaultTo = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const from = normalizeDateInput(params?.from, today);
  const to = normalizeDateInput(params?.to, defaultTo);
  const symbol = params?.symbol ? normalizeSymbol(params.symbol) : undefined;
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);

  const payload = await fetchFinnhubEarningsCalendarRaw({
    from,
    to,
    symbol,
  });
  const entries = Array.isArray(payload.earningsCalendar) ? payload.earningsCalendar : [];

  return entries.slice(0, limit).map((entry) => {
    const normalizedSymbol = asNonEmptyString(entry.symbol)?.toUpperCase() ?? "";
    const metadata = normalizedSymbol ? DEFAULT_SYMBOL_METADATA[normalizedSymbol] : undefined;
    return {
      symbol: normalizedSymbol || "UNKNOWN",
      date: asNonEmptyString(entry.date),
      hour: asNonEmptyString(entry.hour),
      quarter: asFiniteNumber(entry.quarter),
      year: asFiniteNumber(entry.year),
      eps_actual: asFiniteNumber(entry.epsActual),
      eps_estimate: asFiniteNumber(entry.epsEstimate),
      revenue_actual: asFiniteNumber(entry.revenueActual),
      revenue_estimate: asFiniteNumber(entry.revenueEstimate),
      country: metadata?.country ?? null,
      market_code: metadata?.market_code ?? null,
      market_name: metadata?.market_name ?? null,
      payload: entry as unknown,
    };
  });
}

export async function ingestFinnhubMarketNews(params?: {
  category?: string;
  minId?: number;
  maxItems?: number;
}): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  category: string;
  fetched: number;
  min_id: number | null;
  max_id: number | null;
}> {
  const source = await ensureSource();
  const category = normalizeMarketNewsCategory(params?.category);
  const minId = parsePositiveInt(params?.minId) ?? undefined;
  const maxItems = Math.min(Math.max(params?.maxItems ?? 40, 1), MAX_MARKET_NEWS_ITEMS);

  const articles = await fetchFinnhubMarketNewsRaw({
    category,
    minId,
  });
  const selected = articles.slice(0, maxItems);

  const relatedSymbols = Array.from(
    new Set(
      selected.flatMap((article) => parseRelatedSymbols(article.related))
    )
  );
  const symbolCountryMap = await resolveSymbolCountryMap(relatedSymbols);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let minSeenId: number | null = null;
  let maxSeenId: number | null = null;

  for (const article of selected) {
    try {
      const articleId = parsePositiveInt(article.id);
      if (articleId != null) {
        minSeenId = minSeenId == null ? articleId : Math.min(minSeenId, articleId);
        maxSeenId = maxSeenId == null ? articleId : Math.max(maxSeenId, articleId);
      }

      const title = asNonEmptyString(article.headline);
      const summary = asNonEmptyString(article.summary);
      const url = asNonEmptyString(article.url);
      const related = parseRelatedSymbols(article.related);
      const relatedCountries = related
        .map((symbol) => symbolCountryMap.get(symbol))
        .filter((value): value is string => typeof value === "string");
      const relatedCountryHint = dominantCountry(relatedCountries);
      const inference = inferNewsCountry({
        title,
        summary,
        url,
      });

      const countryIso2 =
        inference.iso2 ??
        (relatedCountryHint && /^[A-Z]{2}$/.test(relatedCountryHint) ? relatedCountryHint : null);
      const eventTime = toIsoFromUnixSeconds(article.datetime);
      const fallbackExternal = url ?? `${title ?? "unknown"}|${eventTime ?? "unknown"}|${category}`;
      const externalId = articleId != null ? `market-news:${articleId}` : `market-news:${fallbackExternal}`;
      const dedupeBase = `${externalId}|${eventTime ?? ""}|${title ?? ""}|finnhub-market-news`;
      const dedupeHash = crypto.createHash("sha256").update(dedupeBase).digest("hex");

      const result = await upsertFinnhubNewsItem({
        sourceId: source.id,
        externalId,
        title,
        summary,
        url,
        countryIso2,
        eventTime,
        payload: {
          provider: "finnhub",
          category,
          source: asNonEmptyString(article.source),
          image: asNonEmptyString(article.image),
          related,
          id: articleId,
          country_inference: {
            ...inference,
            related_country_hint: relatedCountryHint,
          },
          raw: article,
        },
        dedupeHash,
      });
      if (result === "inserted") inserted += 1;
      else updated += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    inserted,
    updated,
    skipped,
    category,
    fetched: selected.length,
    min_id: minSeenId,
    max_id: maxSeenId,
  };
}

export async function refreshMarketQuotesRealtime(
  symbolsInput?: string[] | null,
  minRefreshMs = 15_000
): Promise<void> {
  const symbols = symbolsInput && symbolsInput.length > 0 ? symbolsInput : [...DEFAULT_MARKET_SYMBOLS];
  const normalizedSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
  const symbolsKey = normalizedSymbols.join(",");
  const now = Date.now();

  if (activeRealtimeRefresh) {
    await activeRealtimeRefresh;
  }

  if (symbolsKey === lastRealtimeSymbolsKey && now - lastRealtimeRefreshAt < minRefreshMs) {
    return;
  }

  activeRealtimeRefresh = (async () => {
    await ingestFinnhubQuotes(normalizedSymbols);
    lastRealtimeRefreshAt = Date.now();
    lastRealtimeSymbolsKey = symbolsKey;
  })();

  try {
    await activeRealtimeRefresh;
  } finally {
    activeRealtimeRefresh = null;
  }
}
