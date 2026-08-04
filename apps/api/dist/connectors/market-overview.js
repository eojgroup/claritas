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
const market_instruments_1 = require("./market-instruments");
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
function freshnessOf(indexDate, indexFrequency, dailyDates) {
    const daily = dailyDates.filter((value) => Boolean(value)).map(Date.parse).filter(Number.isFinite);
    if (daily.some((value) => Date.now() - value <= 7 * 86400000))
        return "current";
    const index = indexDate ? Date.parse(indexDate) : Number.NaN;
    const indexWindowDays = indexFrequency === "daily" ? 7 : 70;
    if (Number.isFinite(index) && Date.now() - index <= indexWindowDays * 86400000)
        return "current";
    return daily.length || Number.isFinite(index) ? "stale" : "unavailable";
}
function fxForCurrency(currency, rates) {
    if (!currency)
        return null;
    return rates.find((rate) => rate.quote_currency.toUpperCase() === currency) ?? null;
}
async function getCountryMarketOverview() {
    const [countriesResult, indexResult, filingResult, macroResult, fxRates, instrumentCoverageResult] = await Promise.all([
        (0, db_1.query)(`SELECT upper(iso2::text) AS iso2, name, region
       FROM country
       ORDER BY name`),
        (0, db_1.query)(`WITH values AS (
         SELECT upper(mi.country_iso2::text) AS country, mi.series_key AS symbol,
           mi.name AS company_name, mi.value, mi.period_end, mi.observed_at, s.name AS source_name,
           mi.frequency,instrument.scope,instrument.display_priority,
           lead(mi.value) OVER (PARTITION BY mi.country_iso2,mi.series_key ORDER BY mi.period_end DESC) AS previous_value
         FROM market_indicator mi JOIN source s ON s.id=mi.source_id
         LEFT JOIN market_instrument instrument ON instrument.id=mi.instrument_id
         WHERE mi.category='country_equity_index' AND mi.country_iso2 IS NOT NULL
           AND COALESCE(s.metadata->>'retired','false') <> 'true'
       ), ranked AS (
         SELECT values.*,
           row_number() OVER (PARTITION BY country ORDER BY period_end DESC,
             CASE frequency WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END,
             COALESCE(display_priority,100),symbol) AS rank
         FROM values
       )
       SELECT country,symbol,company_name,value,previous_value,period_end,
         CASE WHEN previous_value IS NULL OR previous_value=0 THEN NULL
              ELSE ((value/previous_value)-1)*100 END AS percent_change,
         observed_at,source_name,frequency,scope FROM ranked WHERE rank=1`),
        (0, db_1.query)(`SELECT
         upper(country_iso2::text) AS country,
         COUNT(*)::int AS filing_count_7d,
         MAX(event_time) AS latest_filing_at
       FROM market_event
       WHERE event_time >= now() - interval '7 days'
         AND country_iso2 IS NOT NULL
       GROUP BY upper(country_iso2::text)`),
        (0, db_1.query)(`WITH latest AS (
         SELECT upper(mi.country_iso2::text) AS country,
           mi.payload->>'indicator_code' AS indicator_code,mi.value,mi.period_end,s.name AS source_name,
           row_number() OVER (
             PARTITION BY mi.country_iso2,mi.payload->>'indicator_code'
             ORDER BY mi.period_end DESC,mi.id DESC
           ) AS rank
         FROM market_indicator mi JOIN source s ON s.id=mi.source_id
         WHERE mi.category='macro_indicator' AND mi.country_iso2 IS NOT NULL
           AND s.name='world_bank_wdi'
       )
       SELECT country,
         max(value) FILTER (WHERE indicator_code='NY.GDP.MKTP.KD.ZG') AS gdp_growth,
         (max(extract(year FROM period_end)) FILTER (WHERE indicator_code='NY.GDP.MKTP.KD.ZG'))::int AS gdp_year,
         max(value) FILTER (WHERE indicator_code='FP.CPI.TOTL.ZG') AS inflation,
         (max(extract(year FROM period_end)) FILTER (WHERE indicator_code='FP.CPI.TOTL.ZG'))::int AS inflation_year,
         max(value) FILTER (WHERE indicator_code='SL.UEM.TOTL.ZS') AS unemployment,
         (max(extract(year FROM period_end)) FILTER (WHERE indicator_code='SL.UEM.TOTL.ZS'))::int AS unemployment_year,
         max(value) FILTER (WHERE indicator_code='BN.CAB.XOKA.GD.ZS') AS current_account,
         (max(extract(year FROM period_end)) FILTER (WHERE indicator_code='BN.CAB.XOKA.GD.ZS'))::int AS current_account_year,
         max(extract(year FROM period_end))::int AS latest_year,
         max(source_name) AS source_name
       FROM latest WHERE rank=1 GROUP BY country`),
        (0, ecb_1.getLatestFxRates)(),
        (0, db_1.query)(`SELECT count(DISTINCT mic.country_iso2)::int AS countries
       FROM market_instrument_country mic JOIN market_instrument instrument ON instrument.id=mic.instrument_id
       WHERE instrument.active=true
         AND mic.relationship IN ('primary_market','index_constituency','economic_indicator')`),
    ]);
    const indexByCountry = new Map(indexResult.rows.map((row) => [row.country, row]));
    const filingsByCountry = new Map(filingResult.rows.map((row) => [row.country, row]));
    const macroByCountry = new Map(macroResult.rows.map((row) => [row.country, row]));
    const hasFxDataset = fxRates.length > 0;
    const countries = countriesResult.rows.flatMap((country) => {
        const currency = countryCurrency.get(country.iso2) ?? null;
        const fx = fxForCurrency(currency, fxRates);
        const index = indexByCountry.get(country.iso2);
        const filings = filingsByCountry.get(country.iso2);
        const macro = macroByCountry.get(country.iso2);
        const indexChange = numberOrNull(index?.percent_change);
        // ECB quotes are units of local currency per EUR. Invert the sign so the
        // displayed value is the local currency's daily performance against EUR.
        const fxChange = currency === "EUR" && hasFxDataset ? 0 : fx?.percent_change == null ? null : -fx.percent_change;
        if (!index && !fx && !(currency === "EUR" && hasFxDataset) && !filings && !macro)
            return [];
        const basis = [];
        const components = [];
        if (indexChange != null) {
            basis.push("country_index");
            components.push({ value: indexChange, weight: 0.75 });
        }
        if (fxChange != null) {
            basis.push("currency_vs_eur");
            components.push({ value: fxChange, weight: 0.25 });
        }
        const weight = components.reduce((sum, component) => sum + component.weight, 0);
        const composite = weight ? components.reduce((sum, component) => sum + component.value * component.weight, 0) / weight : null;
        const indexObservedAt = iso(index?.observed_at ?? null);
        const fxPeriodEnd = dateOnly(currency === "EUR" && hasFxDataset ? fxRates[0]?.period_end : fx?.period_end);
        return [{
                country: country.iso2,
                country_name: country.name,
                region: country.region,
                currency,
                index_symbol: index?.symbol ?? null,
                index_name: index?.company_name ?? null,
                index_value: numberOrNull(index?.value),
                index_previous_value: numberOrNull(index?.previous_value),
                index_change_percent: indexChange,
                index_period_end: dateOnly(index?.period_end),
                index_observed_at: indexObservedAt,
                index_source: index?.source_name ?? null,
                index_frequency: index?.frequency ?? null,
                index_scope: index?.scope ?? null,
                fx_symbol: currency === "EUR" && hasFxDataset ? "EUR/EUR" : fx?.symbol ?? null,
                fx_rate: currency === "EUR" && hasFxDataset ? 1 : numberOrNull(fx?.value),
                fx_previous_rate: currency === "EUR" && hasFxDataset ? 1 : numberOrNull(fx?.previous_value),
                fx_change_percent: fxChange,
                fx_period_end: fxPeriodEnd,
                filing_count_7d: Number(filings?.filing_count_7d ?? 0),
                latest_filing_at: iso(filings?.latest_filing_at ?? null),
                gdp_growth: numberOrNull(macro?.gdp_growth),
                gdp_year: numberOrNull(macro?.gdp_year),
                inflation: numberOrNull(macro?.inflation),
                inflation_year: numberOrNull(macro?.inflation_year),
                unemployment: numberOrNull(macro?.unemployment),
                unemployment_year: numberOrNull(macro?.unemployment_year),
                current_account: numberOrNull(macro?.current_account),
                current_account_year: numberOrNull(macro?.current_account_year),
                macro_latest_year: numberOrNull(macro?.latest_year),
                macro_source: macro?.source_name ?? null,
                composite_change_percent: composite == null ? null : Math.round(composite * 10_000) / 10_000,
                composite_basis: basis,
                freshness: freshnessOf(indexObservedAt, index?.frequency ?? null, [fxPeriodEnd ? `${fxPeriodEnd}T16:00:00Z` : null]),
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
            with_macro: countries.filter((row) => row.gdp_growth != null || row.inflation != null || row.unemployment != null || row.current_account != null).length,
            current: countries.filter((row) => row.freshness === "current").length,
            stale: countries.filter((row) => row.freshness === "stale").length,
            instrument_countries: Number(instrumentCoverageResult.rows[0]?.countries ?? 0),
        },
        methodology: {
            index: "Latest OECD national share-price index observation. It is a monthly direction benchmark rather than a live tradable quote.",
            fx: "Daily local-currency performance against EUR, sign-inverted from ECB units-per-EUR reference-rate changes.",
            composite: "Mixed-frequency regime score: 75% latest national equity-benchmark direction and 25% ECB currency-vs-EUR; weights are renormalized when a component is unavailable.",
            filings: "Count of SEC filing events mapped to the country during the trailing seven days; activity is contextual and not directional.",
            macro: "Latest annual World Development Indicators for GDP growth, inflation, unemployment, and current-account balance. Years can differ by indicator and values are not blended into the higher-frequency market regime.",
        },
        sources: [...new Set([
                ...indexResult.rows.map((row) => row.source_name),
                ...macroResult.rows.map((row) => row.source_name),
                ...(fxRates.length ? ["ecb"] : []),
                ...(filingResult.rows.length ? ["sec_edgar"] : []),
            ])],
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
    const [fxHistory, indexHistory, filings, relatedIndices, macroIndicators] = await Promise.all([
        summary.fx_symbol && summary.fx_symbol !== "EUR/EUR"
            ? (0, db_1.query)(`SELECT period_end,value,
             CASE WHEN previous_value IS NULL OR previous_value=0 THEN NULL
                  ELSE ((value/previous_value)-1)*100 END AS percent_change
           FROM (
             SELECT period_end,value,lag(value) OVER (ORDER BY period_end) AS previous_value
             FROM market_indicator
             WHERE category = 'fx_reference' AND symbol = $1
             ORDER BY period_end DESC LIMIT 90
           ) history ORDER BY period_end`, [summary.fx_symbol])
            : Promise.resolve({ rows: [] }),
        summary.index_symbol
            ? (0, db_1.query)(`SELECT period_end,value,
             CASE WHEN previous_value IS NULL OR previous_value=0 THEN NULL
                  ELSE ((value/previous_value)-1)*100 END AS percent_change
           FROM (
             SELECT mi.period_end,mi.value,lag(mi.value) OVER (ORDER BY mi.period_end) AS previous_value
             FROM market_indicator mi JOIN source s ON s.id=mi.source_id
             WHERE mi.category='country_equity_index' AND mi.series_key=$1 AND s.name=$2
             ORDER BY mi.period_end DESC LIMIT 180
           ) history ORDER BY period_end`, [summary.index_symbol, summary.index_source])
            : Promise.resolve({ rows: [] }),
        (0, db_1.query)(`SELECT me.id, me.event_type, me.symbol, me.company_name, me.title,
              me.summary, me.url, me.event_time, s.name AS source_name
       FROM market_event me
       JOIN source s ON s.id = me.source_id
       WHERE upper(me.country_iso2::text) = $1
       ORDER BY me.event_time DESC
       LIMIT 50`, [country]),
        (0, market_instruments_1.getMarketInstrumentSnapshots)({ country, instrumentType: "equity_index", limit: 50 }),
        (0, market_instruments_1.getMarketInstrumentSnapshots)({ country, instrumentType: "macro", limit: 50 }),
    ]);
    return {
        summary,
        fx_history: fxHistory.rows,
        index_history: indexHistory.rows,
        filings: filings.rows.map((row) => ({ ...row, event_time: iso(row.event_time) })),
        related_instruments: relatedIndices,
        macro_indicators: macroIndicators,
        methodology: overview.methodology,
    };
}
