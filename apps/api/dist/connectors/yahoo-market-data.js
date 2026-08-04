"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKET_INSTRUMENTS = void 0;
exports.parseYahooChart = parseYahooChart;
exports.MARKET_INSTRUMENTS = [
    { symbol: "^GSPC", name: "S&P 500", country: "US", category: "country_equity_index" }, { symbol: "^DJI", name: "Dow Jones Industrial Average", country: "US", category: "country_equity_index" },
    { symbol: "^IXIC", name: "NASDAQ Composite", country: "US", category: "country_equity_index" }, { symbol: "^FTSE", name: "FTSE 100", country: "GB", category: "country_equity_index" },
    { symbol: "^GDAXI", name: "DAX", country: "DE", category: "country_equity_index" }, { symbol: "^FCHI", name: "CAC 40", country: "FR", category: "country_equity_index" },
    { symbol: "^N225", name: "Nikkei 225", country: "JP", category: "country_equity_index" }, { symbol: "^HSI", name: "Hang Seng Index", country: "HK", category: "country_equity_index" },
    { symbol: "^OMX", name: "OMX Stockholm 30", country: "SE", category: "country_equity_index" }, { symbol: "^OMXC25", name: "OMX Copenhagen 25", country: "DK", category: "country_equity_index" },
    { symbol: "^STOXX50E", name: "EURO STOXX 50", country: null, category: "country_equity_index" }, { symbol: "000001.SS", name: "SSE Composite", country: "CN", category: "country_equity_index" },
    { symbol: "^AXJO", name: "S&P/ASX 200", country: "AU", category: "country_equity_index" }, { symbol: "^GSPTSE", name: "S&P/TSX Composite", country: "CA", category: "country_equity_index" },
    ...[["GC=F", "Gold"], ["SI=F", "Silver"], ["CL=F", "WTI Crude Oil"], ["BZ=F", "Brent Crude Oil"], ["NG=F", "Natural Gas"], ["HG=F", "Copper"], ["ZC=F", "Corn"], ["ZW=F", "Wheat"]].map(([symbol, name]) => ({ symbol, name, country: null, category: "commodity" })),
];
function parseYahooChart(payload) {
    const result = payload?.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
    return timestamps.flatMap((timestamp, index) => {
        const seconds = Number(timestamp), value = Number(closes[index]);
        if (!Number.isFinite(seconds) || closes[index] == null || !Number.isFinite(value))
            return [];
        const observedAt = new Date(seconds * 1000).toISOString();
        return [{ date: observedAt.slice(0, 10), observedAt, value }];
    });
}
