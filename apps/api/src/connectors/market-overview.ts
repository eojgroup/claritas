import worldCountries from "world-countries";
import { query } from "../db";
import { getLatestFxRates, type FxRate } from "./ecb";

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
  percent_change: number | null;
  observed_at: string | Date;
  source_name: string;
};

type FilingAggregateRow = {
  country: string;
  filing_count_7d: number;
  latest_filing_at: string | Date | null;
};

export type CountryMarketOverview = {
  country: string;
  country_name: string;
  region: string | null;
  currency: string | null;
  index_symbol: string | null;
  index_name: string | null;
  index_change_percent: number | null;
  index_observed_at: string | null;
  index_source: string | null;
  fx_symbol: string | null;
  fx_rate: number | null;
  fx_change_percent: number | null;
  fx_period_end: string | null;
  filing_count_7d: number;
  latest_filing_at: string | null;
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
  };
  methodology: {
    index: string;
    fx: string;
    composite: string;
    filings: string;
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

function freshnessOf(indexDate: string | null, dailyDates: Array<string | null>): CountryMarketOverview["freshness"] {
  const daily = dailyDates.filter((value): value is string => Boolean(value)).map(Date.parse).filter(Number.isFinite);
  if (daily.some((value) => Date.now() - value <= 7 * 86400000)) return "current";
  const index = indexDate ? Date.parse(indexDate) : Number.NaN;
  if (Number.isFinite(index) && Date.now() - index <= 70 * 86400000) return "current";
  return daily.length || Number.isFinite(index) ? "stale" : "unavailable";
}

function fxForCurrency(currency: string | null, rates: FxRate[]): FxRate | null {
  if (!currency) return null;
  return rates.find((rate) => rate.quote_currency.toUpperCase() === currency) ?? null;
}

export async function getCountryMarketOverview(): Promise<MarketOverviewResponse> {
  const [countriesResult, indexResult, filingResult, fxRates] = await Promise.all([
    query<CountryRow>(
      `SELECT upper(iso2::text) AS iso2, name, region
       FROM country
       ORDER BY name`
    ),
    query<IndexRow>(
      `WITH values AS (
         SELECT upper(mi.country_iso2::text) AS country, mi.series_key AS symbol,
           mi.name AS company_name, mi.value, mi.period_end, mi.observed_at, s.name AS source_name,
           lead(mi.value) OVER (PARTITION BY mi.country_iso2,mi.series_key ORDER BY mi.period_end DESC) AS previous_value,
           row_number() OVER (PARTITION BY mi.country_iso2 ORDER BY mi.period_end DESC,mi.series_key) AS rank
         FROM market_indicator mi JOIN source s ON s.id=mi.source_id
         WHERE mi.category='country_equity_index' AND mi.country_iso2 IS NOT NULL
           AND COALESCE(s.metadata->>'retired','false') <> 'true'
       )
       SELECT country,symbol,company_name,
         CASE WHEN previous_value IS NULL OR previous_value=0 THEN NULL
              ELSE ((value/previous_value)-1)*100 END AS percent_change,
         observed_at,source_name FROM values WHERE rank=1`
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
    getLatestFxRates(),
  ]);

  const indexByCountry = new Map(indexResult.rows.map((row) => [row.country, row] as const));
  const filingsByCountry = new Map(filingResult.rows.map((row) => [row.country, row] as const));
  const hasFxDataset = fxRates.length > 0;
  const countries = countriesResult.rows.flatMap((country): CountryMarketOverview[] => {
    const currency = countryCurrency.get(country.iso2) ?? null;
    const fx = fxForCurrency(currency, fxRates);
    const index = indexByCountry.get(country.iso2);
    const filings = filingsByCountry.get(country.iso2);
    const indexChange = numberOrNull(index?.percent_change);
    // ECB quotes are units of local currency per EUR. Invert the sign so the
    // displayed value is the local currency's daily performance against EUR.
    const fxChange = currency === "EUR" && hasFxDataset ? 0 : fx?.percent_change == null ? null : -fx.percent_change;
    if (!index && !fx && !(currency === "EUR" && hasFxDataset) && !filings) return [];

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
      freshness: freshnessOf(indexObservedAt, [fxPeriodEnd ? `${fxPeriodEnd}T16:00:00Z` : null]),
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
      index: "Latest monthly OECD national share-price index change. It is a broad market-direction signal, not a live tradable quote.",
      fx: "Daily local-currency performance against EUR, sign-inverted from ECB units-per-EUR reference-rate changes.",
      composite: "Frequency-aware regime score: 75% OECD monthly equity direction and 25% ECB currency-vs-EUR; weights are renormalized when a component is unavailable.",
      filings: "Count of SEC filing events mapped to the country during the trailing seven days; activity is contextual and not directional.",
    },
    sources: ["OECD", "European Central Bank", "U.S. Securities and Exchange Commission"],
  };
}

export async function getCountryMarketDetail(countryIso2: string) {
  const country = countryIso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("country must be an ISO2 code.");
  const overview = await getCountryMarketOverview();
  const summary = overview.countries.find((row) => row.country === country) ?? null;
  if (!summary) return null;
  const [fxHistory, indexHistory, filings] = await Promise.all([
    summary.fx_symbol && summary.fx_symbol !== "EUR/EUR"
      ? query<{ period_end: string; value: number }>(
          `SELECT period_end, value
           FROM market_indicator
           WHERE category = 'fx_reference' AND symbol = $1
           ORDER BY period_end DESC
           LIMIT 90`,
          [summary.fx_symbol]
        )
      : Promise.resolve({ rows: [] as Array<{ period_end: string; value: number }> }),
    summary.index_symbol
      ? query<{ period_end: string; value: number }>(
          `SELECT period_end,value FROM market_indicator
           WHERE category='country_equity_index' AND series_key=$1
           ORDER BY period_end DESC LIMIT 36`, [summary.index_symbol]
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
  ]);
  return {
    summary,
    fx_history: fxHistory.rows.reverse(),
    index_history: indexHistory.rows.reverse(),
    filings: filings.rows.map((row) => ({ ...row, event_time: iso(row.event_time) })),
    methodology: overview.methodology,
  };
}
