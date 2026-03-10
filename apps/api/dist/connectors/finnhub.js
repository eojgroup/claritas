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
exports.DEFAULT_MARKET_SYMBOLS = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "JPM",
];
const DEFAULT_SYMBOL_METADATA = {
    AAPL: { company_name: "Apple", exchange: "NASDAQ", country: "US", currency: "USD" },
    MSFT: { company_name: "Microsoft", exchange: "NASDAQ", country: "US", currency: "USD" },
    NVDA: { company_name: "NVIDIA", exchange: "NASDAQ", country: "US", currency: "USD" },
    AMZN: { company_name: "Amazon", exchange: "NASDAQ", country: "US", currency: "USD" },
    GOOGL: { company_name: "Alphabet", exchange: "NASDAQ", country: "US", currency: "USD" },
    META: { company_name: "Meta", exchange: "NASDAQ", country: "US", currency: "USD" },
    TSLA: { company_name: "Tesla", exchange: "NASDAQ", country: "US", currency: "USD" },
    JPM: { company_name: "JPMorgan Chase", exchange: "NYSE", country: "US", currency: "USD" },
};
let activeRealtimeRefresh = null;
let lastRealtimeRefreshAt = 0;
let lastRealtimeSymbolsKey = "";
function toTimestampString(value) {
    if (value instanceof Date)
        return value.toISOString();
    return value;
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
            const metadata = DEFAULT_SYMBOL_METADATA[symbol] ?? {};
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
    return rows.map((row) => ({
        symbol: row.symbol,
        company_name: row.company_name,
        exchange: row.exchange,
        country: row.country,
        currency: row.currency,
        price: row.price,
        change: row.change,
        percent_change: row.percent_change,
        high_price: row.high_price,
        low_price: row.low_price,
        open_price: row.open_price,
        previous_close: row.previous_close,
        observed_at: toTimestampString(row.observed_at),
        payload: row.payload,
    }));
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
