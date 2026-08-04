import worldCountries from "world-countries";
import { query } from "../db";
import { getLatestFxRates, type FxRate } from "./ecb";
import { getMarketInstrumentSnapshots, type MarketInstrumentSnapshot } from "./market-instruments";

type WorldCountry = {
  cca2?: string;
  currencies?: Record<string, { name?: string; symbol?: string }>;
};

type CountryRow = {
  iso2: string;
  name: string;
  region: string | null;
};

type IndexRow = {
  country: string;
  symbol: string;
  company_name: string | null;
  value: number;
  previous_value: number | null;
  period_end: string | Date;
  percent_change: number | null;
  observed_at: string | Date;
  source_name: string;
  frequency: string | null;
  scope: string | null;
};

type FilingAggregateRow = {
  country: string;
  filing_count_7d: number;
  latest_filing_at: string | Date | null;
};

type MacroAggregateRow = {
  country: string;
  gdp_growth: number | null;
  gdp_year: number | null;
  inflation: number | null;
  inflation_year: number | null;
  unemployment: number | null;
  unemployment_year: number | null;
  current_account: number | null;
  current_account_year: number | null;
  latest_year: number | null;
  source_name: string;
};

export type CountryMarketOverview = {
  country: string;
  country_name: string;
  region: string | null;
  currency: string | null;
  index_symbol: string | null;
  index_name: string | null;
  index_value: number | null;
  index_previous_value: number | null;
  index_change_percent: number | null;
  index_period_end: string | null;
  index_observed_at: string | null;
  index_source: string | null;
  index_frequency: string | null;
  index_scope: string | null;
  fx_symbol: string | null;
  fx_rate: number | null;
  fx_previous_rate: number | null;
  fx_change_percent: number | null;
  fx_period_end: string | null;
  filing_count_7d: number;
  latest_filing_at: string | null;
  gdp_growth: number | null;
  gdp_year: number | null;
  inflation: number | null;
  inflation_year: number | null;
  unemployment: number | null;
  unemployment_year: number | null;
  current_account: number | null;
  current_account_year: number | null;
  macro_latest_year: number | null;
  macro_source: string | null;
  composite_change_percent: number | null;
  composite_basis: Array<"country_index" | "currency_vs_eur">;
  freshness: "current" | "stale" | "unavailable";
};

export type MarketOverviewResponse = {
  generated_at: string;
  countries: CountryMarketOverview[];
  coverage: {
    countries: number;
    with_index: number;
    with_fx: number;
    with_filings: number;
    with_macro: number;
    current: number;
    stale: number;
    instrument_countries: number;
  };
  methodology: {
    index: string;
    fx: string;
    composite: string;
    filings: string;
    macro: string;
  };
  sources: string[];
};

const countryCurrency = new Map<string, string>();
for (const entry of worldCountries as WorldCountry[]) {
  const iso2 = entry.cca2?.toUpperCase();
  const currencies = Object.keys(entry.currencies ?? {});
  if (iso2 && currencies[0]) countryCurrency.set(iso2, currencies[0].toUpperCase());
}

function iso(value: string | Date | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function freshnessOf(indexDate: string | null, indexFrequency: string | null, dailyDates: Array<string | null>): CountryMarketOverview["freshness"] {
  const daily = dailyDates.filter((value): value is string => Boolean(value)).map(Date.parse).filter(Number.isFinite);
  if (daily.some((value) => Date.now() - value <= 7 * 86400000)) return "current";
  const index = indexDate ? Date.parse(indexDate) : Number.NaN;
  const indexWindowDays = indexFrequency === "daily" ? 7 : 70;
  if (Number.isFinite(index) && Date.now() - index <= indexWindowDays * 86400000) return "current";
  return daily.length || Number.isFinite(index) ? "stale" : "unavailable";
}

function fxForCurrency(currency: string | null, rates: FxRate[]): FxRate | null {
  if (!currency) return null;
  return rates.find((rate) => rate.quote_currency.toUpperCase() === currency) ?? null;
}

export async function getCountryMarketOverview(): Promise<MarketOverviewResponse> {
  const [countriesResult, indexResult, filingResult, macroResult, fxRates, instrumentCoverageResult] = await Promise.all([
    query<CountryRow>(
      `SELECT upper(iso2::text) AS iso2, name, region
       FROM country
       ORDER BY name`
    ),
    query<IndexRow>(
      `WITH values AS (
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
         observed_at,source_name,frequency,scope FROM ranked WHERE rank=1`,
    ),
    query<FilingAggregateRow>(
      `SELECT
         upper(country_iso2::text) AS country,
         COUNT(*)::int AS filing_count_7d,
         MAX(event_time) AS latest_filing_at
       FROM market_event
       WHERE event_time >= now() - interval '7 days'
         AND country_iso2 IS NOT NULL
       GROUP BY upper(country_iso2::text)`
    ),
    query<MacroAggregateRow>(
      `WITH latest AS (
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
       FROM latest WHERE rank=1 GROUP BY country`,
    ),
    getLatestFxRates(),
    query<{ countries: number }>(
      `SELECT count(DISTINCT mic.country_iso2)::int AS countries
       FROM market_instrument_country mic JOIN market_instrument instrument ON instrument.id=mic.instrument_id
       WHERE instrument.active=true
         AND mic.relationship IN ('primary_market','index_constituency','economic_indicator')`,
    ),
  ]);

  const indexByCountry = new Map(indexResult.rows.map((row) => [row.country, row] as const));
  const filingsByCountry = new Map(filingResult.rows.map((row) => [row.country, row] as const));
  const macroByCountry = new Map(macroResult.rows.map((row) => [row.country, row] as const));
  const hasFxDataset = fxRates.length > 0;
  const countries = countriesResult.rows.flatMap((country): CountryMarketOverview[] => {
    const currency = countryCurrency.get(country.iso2) ?? null;
    const fx = fxForCurrency(currency, fxRates);
    const index = indexByCountry.get(country.iso2);
    const filings = filingsByCountry.get(country.iso2);
    const macro = macroByCountry.get(country.iso2);
    const indexChange = numberOrNull(index?.percent_change);
    // ECB quotes are units of local currency per EUR. Invert the sign so the
    // displayed value is the local currency's daily performance against EUR.
    const fxChange = currency === "EUR" && hasFxDataset ? 0 : fx?.percent_change == null ? null : -fx.percent_change;
    if (!index && !fx && !(currency === "EUR" && hasFxDataset) && !filings && !macro) return [];

    const basis: CountryMarketOverview["composite_basis"] = [];
    const components: Array<{ value: number; weight: number }> = [];
    if (indexChange != null) { basis.push("country_index"); components.push({ value: indexChange, weight: 0.75 }); }
    if (fxChange != null) { basis.push("currency_vs_eur"); components.push({ value: fxChange, weight: 0.25 }); }
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

export async function getCountryMarketDetail(countryIso2: string) {
  const country = countryIso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("country must be an ISO2 code.");
  const overview = await getCountryMarketOverview();
  const summary = overview.countries.find((row) => row.country === country) ?? null;
  if (!summary) return null;
  const [fxHistory, indexHistory, filings, relatedIndices, macroIndicators] = await Promise.all([
    summary.fx_symbol && summary.fx_symbol !== "EUR/EUR"
      ? query<{ period_end: string; value: number; percent_change: number | null }>(
          `SELECT period_end,value,
             CASE WHEN previous_value IS NULL OR previous_value=0 THEN NULL
                  ELSE ((value/previous_value)-1)*100 END AS percent_change
           FROM (
             SELECT period_end,value,lag(value) OVER (ORDER BY period_end) AS previous_value
             FROM market_indicator
             WHERE category = 'fx_reference' AND symbol = $1
             ORDER BY period_end DESC LIMIT 90
           ) history ORDER BY period_end`,
          [summary.fx_symbol]
        )
      : Promise.resolve({ rows: [] as Array<{ period_end: string; value: number }> }),
    summary.index_symbol
      ? query<{ period_end: string; value: number; percent_change: number | null }>(
          `SELECT period_end,value,
             CASE WHEN previous_value IS NULL OR previous_value=0 THEN NULL
                  ELSE ((value/previous_value)-1)*100 END AS percent_change
           FROM (
             SELECT mi.period_end,mi.value,lag(mi.value) OVER (ORDER BY mi.period_end) AS previous_value
             FROM market_indicator mi JOIN source s ON s.id=mi.source_id
             WHERE mi.category='country_equity_index' AND mi.series_key=$1 AND s.name=$2
             ORDER BY mi.period_end DESC LIMIT 180
           ) history ORDER BY period_end`, [summary.index_symbol, summary.index_source]
        )
      : Promise.resolve({ rows: [] as Array<{ period_end: string; value: number }> }),
    query<{
      id: number;
      event_type: string;
      symbol: string | null;
      company_name: string | null;
      title: string;
      summary: string | null;
      url: string | null;
      event_time: string | Date;
      source_name: string;
    }>(
      `SELECT me.id, me.event_type, me.symbol, me.company_name, me.title,
              me.summary, me.url, me.event_time, s.name AS source_name
       FROM market_event me
       JOIN source s ON s.id = me.source_id
       WHERE upper(me.country_iso2::text) = $1
       ORDER BY me.event_time DESC
       LIMIT 50`,
      [country]
    ),
    getMarketInstrumentSnapshots({ country, instrumentType: "equity_index", limit: 50 }),
    getMarketInstrumentSnapshots({ country, instrumentType: "macro", limit: 50 }),
  ]);
  return {
    summary,
    fx_history: fxHistory.rows,
    index_history: indexHistory.rows,
    filings: filings.rows.map((row) => ({ ...row, event_time: iso(row.event_time) })),
    related_instruments: relatedIndices as MarketInstrumentSnapshot[],
    macro_indicators: macroIndicators as MarketInstrumentSnapshot[],
    methodology: overview.methodology,
  };
}
