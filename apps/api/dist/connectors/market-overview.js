"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCountryMarketOverview = getCountryMarketOverview;
exports.getCountryMarketDetail = getCountryMarketDetail;
const world_countries_1 = __importDefault(require("world-countries"));
const db_1 = require("../db");
const ecb_1 = require("./ecb");
const countryCurrency = new Map();
for (const entry of world_countries_1.default) {
    const iso2 = entry.cca2?.toUpperCase();
    const currencies = Object.keys(entry.currencies ?? {});
    if (iso2 && currencies[0])
        countryCurrency.set(iso2, currencies[0].toUpperCase());
}
function iso(value) {
    if (value == null)
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function numberOrNull(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function dateOnly(value) {
    if (value instanceof Date)
        return value.toISOString().slice(0, 10);
    if (typeof value !== "string")
        return null;
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? null;
}
function freshnessOf(values) {
    const timestamps = values
        .filter((value) => Boolean(value))
        .map((value) => Date.parse(value))
        .filter(Number.isFinite);
    if (timestamps.length === 0)
        return "unavailable";
    const ageHours = (Date.now() - Math.max(...timestamps)) / 3_600_000;
    return ageHours <= 72 ? "current" : "stale";
}
function fxForCurrency(currency, rates) {
    if (!currency)
        return null;
    return rates.find((rate) => rate.quote_currency.toUpperCase() === currency) ?? null;
}
async function getCountryMarketOverview() {
    const [countriesResult, indexResult, filingResult, fxRates] = await Promise.all([
        (0, db_1.query)(`SELECT upper(iso2::text) AS iso2, name, region
       FROM country
       ORDER BY name`),
        (0, db_1.query)(`WITH ranked AS (
         SELECT
           upper(ms.country) AS country,
           ms.symbol,
           ms.company_name,
           ms.percent_change,
           ms.observed_at,
           s.name AS source_name,
           row_number() OVER (
             PARTITION BY upper(ms.country)
             ORDER BY
               CASE WHEN ms.payload->'market'->>'kind' = 'country_primary' THEN 0 ELSE 1 END,
               ms.observed_at DESC,
               abs(COALESCE(ms.percent_change, 0)) DESC
           ) AS rank
         FROM market_snapshot ms
         JOIN source s ON s.id = ms.source_id
         WHERE COALESCE(s.metadata->>'retired', 'false') <> 'true'
           AND ms.country ~* '^[a-z]{2}$'
       )
       SELECT country, symbol, company_name, percent_change, observed_at, source_name
       FROM ranked
       WHERE rank = 1`),
        (0, db_1.query)(`SELECT
         upper(country_iso2::text) AS country,
         COUNT(*)::int AS filing_count_7d,
         MAX(event_time) AS latest_filing_at
       FROM market_event
       WHERE event_time >= now() - interval '7 days'
         AND country_iso2 IS NOT NULL
       GROUP BY upper(country_iso2::text)`),
        (0, ecb_1.getLatestFxRates)(),
    ]);
    const indexByCountry = new Map(indexResult.rows.map((row) => [row.country, row]));
    const filingsByCountry = new Map(filingResult.rows.map((row) => [row.country, row]));
    const hasFxDataset = fxRates.length > 0;
    const countries = countriesResult.rows.flatMap((country) => {
        const currency = countryCurrency.get(country.iso2) ?? null;
        const fx = fxForCurrency(currency, fxRates);
        const index = indexByCountry.get(country.iso2);
        const filings = filingsByCountry.get(country.iso2);
        const indexChange = numberOrNull(index?.percent_change);
        // ECB quotes are units of local currency per EUR. Invert the sign so the
        // displayed value is the local currency's daily performance against EUR.
        const fxChange = currency === "EUR" && hasFxDataset ? 0 : fx?.percent_change == null ? null : -fx.percent_change;
        if (!index && !fx && !(currency === "EUR" && hasFxDataset) && !filings)
            return [];
        const basis = [];
        if (indexChange != null)
            basis.push("country_index");
        if (fxChange != null)
            basis.push("currency_vs_eur");
        const composite = indexChange != null && fxChange != null
            ? indexChange * 0.75 + fxChange * 0.25
            : indexChange ?? fxChange;
        const indexObservedAt = iso(index?.observed_at ?? null);
        const fxPeriodEnd = dateOnly(currency === "EUR" && hasFxDataset ? fxRates[0]?.period_end : fx?.period_end);
        return [{
                country: country.iso2,
                country_name: country.name,
                region: country.region,
                currency,
                index_symbol: index?.symbol ?? null,
                index_name: index?.company_name ?? null,
                index_change_percent: indexChange,
                index_observed_at: indexObservedAt,
                index_source: index?.source_name ?? null,
                fx_symbol: currency === "EUR" && hasFxDataset ? "EUR/EUR" : fx?.symbol ?? null,
                fx_rate: currency === "EUR" && hasFxDataset ? 1 : numberOrNull(fx?.value),
                fx_change_percent: fxChange,
                fx_period_end: fxPeriodEnd,
                filing_count_7d: Number(filings?.filing_count_7d ?? 0),
                latest_filing_at: iso(filings?.latest_filing_at ?? null),
                composite_change_percent: composite == null ? null : Math.round(composite * 10_000) / 10_000,
                composite_basis: basis,
                freshness: freshnessOf([indexObservedAt, fxPeriodEnd ? `${fxPeriodEnd}T16:00:00Z` : null]),
            }];
    });
    return {
        generated_at: new Date().toISOString(),
        countries,
        coverage: {
            countries: countries.length,
            with_index: countries.filter((row) => row.index_change_percent != null).length,
            with_fx: countries.filter((row) => row.fx_change_percent != null).length,
            with_filings: countries.filter((row) => row.filing_count_7d > 0).length,
        },
        methodology: {
            index: "Latest non-retired country benchmark change, when a licensed market-price provider is configured.",
            fx: "Daily local-currency performance against EUR, sign-inverted from ECB units-per-EUR reference-rate changes.",
            composite: "75% country-index change plus 25% currency-vs-EUR change; when one component is unavailable, the available component is shown without imputation.",
            filings: "Count of SEC filing events mapped to the country during the trailing seven days; activity is contextual and not directional.",
        },
        sources: ["European Central Bank", "U.S. Securities and Exchange Commission"],
    };
}
async function getCountryMarketDetail(countryIso2) {
    const country = countryIso2.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country))
        throw new Error("country must be an ISO2 code.");
    const overview = await getCountryMarketOverview();
    const summary = overview.countries.find((row) => row.country === country) ?? null;
    if (!summary)
        return null;
    const [fxHistory, filings] = await Promise.all([
        summary.fx_symbol && summary.fx_symbol !== "EUR/EUR"
            ? (0, db_1.query)(`SELECT period_end, value
           FROM market_indicator
           WHERE category = 'fx_reference' AND symbol = $1
           ORDER BY period_end DESC
           LIMIT 90`, [summary.fx_symbol])
            : Promise.resolve({ rows: [] }),
        (0, db_1.query)(`SELECT me.id, me.event_type, me.symbol, me.company_name, me.title,
              me.summary, me.url, me.event_time, s.name AS source_name
       FROM market_event me
       JOIN source s ON s.id = me.source_id
       WHERE upper(me.country_iso2::text) = $1
       ORDER BY me.event_time DESC
       LIMIT 50`, [country]),
    ]);
    return {
        summary,
        fx_history: fxHistory.rows.reverse(),
        filings: filings.rows.map((row) => ({ ...row, event_time: iso(row.event_time) })),
        methodology: overview.methodology,
    };
}
