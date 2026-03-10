"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MARKET_SYMBOLS = void 0;
exports.parseMarketSymbolsInput = parseMarketSymbolsInput;
exports.resolveMarketSymbols = resolveMarketSymbols;
exports.ingestFinnhubQuotes = ingestFinnhubQuotes;
exports.getMarketQuotesLatest = getMarketQuotesLatest;
exports.refreshMarketQuotesRealtime = refreshMarketQuotesRealtime;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const FINNHUB_BASE_URL = "https://api.finnhub.io/api/v1";
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,23}$/;
const MAX_SYMBOLS_PER_REQUEST = 25;
const DEFAULT_MARKET_BENCHMARKS = [
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
exports.DEFAULT_MARKET_SYMBOLS = DEFAULT_MARKET_BENCHMARKS.map((entry) => entry.symbol);
const DEFAULT_SYMBOL_METADATA = DEFAULT_MARKET_BENCHMARKS.reduce((acc, entry) => {
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
}, {});
const COUNTRY_PRIMARY_MARKETS = {
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
let activeRealtimeRefresh = null;
let lastRealtimeRefreshAt = 0;
let lastRealtimeSymbolsKey = "";
const profileMetadataCache = new Map();
function toTimestampString(value) {
    if (value instanceof Date)
        return value.toISOString();
    return value;
}
function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return null;
}
function asNonEmptyString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function withMarketIdentity(metadata, symbol) {
    const normalizedCountry = typeof metadata.country === "string" && metadata.country.trim()
        ? metadata.country.trim().toUpperCase()
        : undefined;
    const enriched = {
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
        }
        else if (enriched.market_code || enriched.market_name) {
            enriched.market_kind = "country_primary";
        }
        else if (enriched.exchange) {
            enriched.market_kind = "exchange";
        }
    }
    return enriched;
}
function normalizeSymbol(value) {
    const normalized = value.trim().toUpperCase();
    if (!normalized)
        return "";
    if (!SYMBOL_PATTERN.test(normalized)) {
        throw new Error(`Invalid market symbol: "${value}"`);
    }
    return normalized;
}
function parseMarketSymbolsInput(raw) {
    if (raw == null)
        return [];
    let values = [];
    if (typeof raw === "string") {
        values = raw
            .split(/[,\s]+/)
            .map((part) => part.trim())
            .filter(Boolean);
    }
    else if (Array.isArray(raw)) {
        values = raw
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean);
    }
    else {
        throw new Error("symbols must be a comma-separated string or an array of strings.");
    }
    const deduped = Array.from(new Set(values.map(normalizeSymbol).filter(Boolean)));
    if (deduped.length > MAX_SYMBOLS_PER_REQUEST) {
        throw new Error(`Too many symbols. Max allowed is ${MAX_SYMBOLS_PER_REQUEST}.`);
    }
    return deduped;
}
function resolveMarketSymbols(raw) {
    const parsed = parseMarketSymbolsInput(raw);
    return parsed.length > 0 ? parsed : [...exports.DEFAULT_MARKET_SYMBOLS];
}
async function ensureSource() {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider','finnhub'))
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url
     RETURNING id, name`, ["finnhub", FINNHUB_BASE_URL]);
    return rows[0];
}
async function fetchFinnhubQuote(symbol) {
    const token = process.env.FINNHUB_API_KEY || "";
    if (!token)
        throw new Error("FINNHUB_API_KEY not set");
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
    const data = (await response.json());
    if (typeof data.error === "string" && data.error.trim()) {
        throw new Error(`Finnhub quote error: ${data.error.trim()}`);
    }
    return data;
}
async function fetchFinnhubCompanyProfile2(symbol) {
    const cached = profileMetadataCache.get(symbol);
    if (cached)
        return cached;
    const token = process.env.FINNHUB_API_KEY || "";
    if (!token)
        throw new Error("FINNHUB_API_KEY not set");
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
    const data = (await response.json());
    const metadata = {
        company_name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined,
        exchange: typeof data.exchange === "string" && data.exchange.trim() ? data.exchange.trim() : undefined,
        country: typeof data.country === "string" && data.country.trim() ? data.country.trim().toUpperCase() : undefined,
        currency: typeof data.currency === "string" && data.currency.trim() ? data.currency.trim().toUpperCase() : undefined,
        logo_url: typeof data.logo === "string" && data.logo.trim() ? data.logo.trim() : undefined,
    };
    const enriched = withMarketIdentity(metadata, symbol);
    profileMetadataCache.set(symbol, enriched);
    return enriched;
}
function toObservedAtISO(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        // Finnhub sample payload shows seconds, but accept ms defensively.
        const millis = value > 10_000_000_000 ? value : value * 1000;
        const date = new Date(millis);
        if (!Number.isNaN(date.getTime()))
            return date.toISOString();
    }
    return new Date().toISOString();
}
async function upsertMarketSnapshot(params) {
    const dedupeBase = `${params.symbol}|${params.observedAtISO}|${params.quote.c ?? ""}|${params.quote.d ?? ""}`;
    const dedupeHash = node_crypto_1.default.createHash("sha256").update(dedupeBase).digest("hex");
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
        },
        market: {
            code: params.metadata.market_code ?? null,
            name: params.metadata.market_name ?? null,
            kind: params.metadata.market_kind ?? null,
            country: params.metadata.country ?? null,
        },
    };
    const { rows } = await (0, db_1.query)(`INSERT INTO market_snapshot (
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
     RETURNING (xmax = 0) AS inserted`, [
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
    ]);
    return rows[0]?.inserted ? "inserted" : "updated";
}
async function ingestFinnhubQuotes(symbolsInput) {
    const symbols = symbolsInput && symbolsInput.length > 0 ? symbolsInput : [...exports.DEFAULT_MARKET_SYMBOLS];
    const normalizedSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
    const source = await ensureSource();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let http_failures = 0;
    let db_errors = 0;
    let last_http_status = null;
    let last_http_error = null;
    let last_db_error = null;
    for (const symbol of normalizedSymbols) {
        try {
            const quote = await fetchFinnhubQuote(symbol);
            const observedAtISO = toObservedAtISO(quote.t);
            let metadata = withMarketIdentity({ ...(DEFAULT_SYMBOL_METADATA[symbol] ?? {}) }, symbol);
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
                    };
                }
                catch {
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
                if (result === "inserted")
                    inserted += 1;
                else
                    updated += 1;
            }
            catch (error) {
                skipped += 1;
                db_errors += 1;
                const message = error instanceof Error ? error.message : String(error);
                last_db_error = message.slice(0, 300);
                // eslint-disable-next-line no-console
                console.error("finnhub upsert error:", message);
            }
        }
        catch (error) {
            skipped += 1;
            http_failures += 1;
            const message = error instanceof Error ? error.message : String(error);
            const statusMatch = message.match(/HTTP\s+(\d{3})/);
            if (statusMatch) {
                const parsed = Number.parseInt(statusMatch[1], 10);
                if (Number.isFinite(parsed))
                    last_http_status = parsed;
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
async function getMarketQuotesLatest(symbolsInput) {
    const symbols = symbolsInput && symbolsInput.length > 0 ? Array.from(new Set(symbolsInput.map(normalizeSymbol).filter(Boolean))) : [];
    const hasFilter = symbols.length > 0;
    const { rows } = await (0, db_1.query)(`SELECT
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
     ORDER BY symbol ASC`, hasFilter ? [symbols] : []);
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
async function refreshMarketQuotesRealtime(symbolsInput, minRefreshMs = 15_000) {
    const symbols = symbolsInput && symbolsInput.length > 0 ? symbolsInput : [...exports.DEFAULT_MARKET_SYMBOLS];
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
    }
    finally {
        activeRealtimeRefresh = null;
    }
}
