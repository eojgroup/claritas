import { query } from "../db";

export type MarketInstrumentHistoryPoint = {
  period_end: string;
  value: number;
};

export type MarketInstrumentSnapshot = {
  instrument_id: number | null;
  source_name: string;
  source_url: string | null;
  symbol: string;
  canonical_symbol: string;
  company_name: string;
  instrument_type: string;
  asset_class: string;
  scope: string;
  exchange: string | null;
  country: string | null;
  related_countries: Array<{ country: string; relationship: string; is_primary: boolean }>;
  currency: string | null;
  market_code: string | null;
  market_name: string | null;
  market_kind: string;
  unit: string | null;
  frequency: string | null;
  value_semantics: string | null;
  attribution: string | null;
  license: string | null;
  original_publisher: string | null;
  price: number;
  change: number | null;
  percent_change: number | null;
  high_price: number | null;
  low_price: number | null;
  open_price: number | null;
  previous_close: number | null;
  volume: number | null;
  period_end: string;
  observed_at: string;
  history: MarketInstrumentHistoryPoint[];
  payload: Record<string, unknown>;
};

type SnapshotQueryRow = Omit<MarketInstrumentSnapshot, "related_countries" | "history" | "payload"> & {
  related_countries: unknown;
  history: unknown;
  payload: unknown;
};

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

export async function getMarketInstrumentSnapshots(params: {
  symbols?: string[];
  country?: string;
  instrumentType?: string;
  limit?: number;
} = {}): Promise<MarketInstrumentSnapshot[]> {
  const symbols = (params.symbols ?? []).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  const country = params.country?.trim().toUpperCase() ?? "";
  const instrumentType = params.instrumentType?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Number(params.limit) || 250, 1), 500);
  const { rows } = await query<SnapshotQueryRow>(
    `WITH ranked AS (
       SELECT mi.id,mi.source_id,mi.instrument_id,mi.category,mi.series_key,mi.symbol,mi.country_iso2,
         mi.name,mi.unit,mi.frequency,mi.period_end,mi.value,mi.observed_at,mi.payload,
         s.name AS source_name,s.metadata AS source_metadata,
         instrument.canonical_symbol,instrument.instrument_type,instrument.asset_class,instrument.scope,
         instrument.exchange_code,instrument.exchange_name,instrument.currency,instrument.primary_country_iso2,
         instrument.metadata AS instrument_metadata,
         lead(mi.value) OVER (
           PARTITION BY mi.source_id,COALESCE(mi.instrument_id::text,mi.series_key)
           ORDER BY mi.period_end DESC,mi.observed_at DESC
         ) AS previous_value,
         row_number() OVER (
           PARTITION BY mi.source_id,COALESCE(mi.instrument_id::text,mi.series_key)
           ORDER BY mi.period_end DESC,mi.observed_at DESC
         ) AS observation_rank
       FROM market_indicator mi
       JOIN source s ON s.id=mi.source_id
       LEFT JOIN market_instrument instrument ON instrument.id=mi.instrument_id
       WHERE mi.category IN ('country_equity_index','commodity','macro_indicator')
         AND COALESCE(s.metadata->>'retired','false') <> 'true'
     ), latest AS (
       SELECT * FROM ranked WHERE observation_rank=1
     )
     SELECT
       latest.instrument_id,latest.source_name,
       COALESCE(latest.instrument_metadata->>'data_url',latest.instrument_metadata->>'quote_url',latest.source_metadata->>'attribution_url') AS source_url,
       COALESCE(latest.symbol,latest.series_key) AS symbol,
       COALESCE(latest.canonical_symbol,latest.series_key) AS canonical_symbol,
       latest.name AS company_name,
       COALESCE(latest.instrument_type,CASE latest.category WHEN 'commodity' THEN 'commodity' WHEN 'macro_indicator' THEN 'macro' ELSE 'equity_index' END) AS instrument_type,
       COALESCE(latest.asset_class,CASE latest.category WHEN 'commodity' THEN 'commodities' WHEN 'macro_indicator' THEN 'macro' ELSE 'equities' END) AS asset_class,
       COALESCE(latest.scope,CASE WHEN latest.country_iso2 IS NULL THEN 'global' ELSE 'country' END) AS scope,
       latest.exchange_name AS exchange,
       upper(COALESCE(latest.primary_country_iso2,latest.country_iso2)::text) AS country,
       COALESCE(rel.countries,'[]'::jsonb) AS related_countries,
       latest.currency,
       latest.exchange_code AS market_code,
       latest.exchange_name AS market_name,
       COALESCE(latest.instrument_type,'equity_index') AS market_kind,
       latest.unit,latest.frequency,
       COALESCE(latest.instrument_metadata->>'value_semantics',latest.payload->>'value_semantics') AS value_semantics,
       COALESCE(latest.instrument_metadata->>'attribution',latest.payload->>'attribution',latest.source_metadata->>'attribution') AS attribution,
       COALESCE(latest.instrument_metadata->>'license',latest.payload->>'license',latest.source_metadata->>'license') AS license,
       COALESCE(latest.instrument_metadata->>'original_publisher',latest.payload->>'original_publisher') AS original_publisher,
       latest.value AS price,
       CASE WHEN latest.previous_value IS NULL THEN NULL ELSE latest.value-latest.previous_value END AS change,
       CASE WHEN latest.previous_value IS NULL OR latest.previous_value=0 THEN NULL
            ELSE ((latest.value/latest.previous_value)-1)*100 END AS percent_change,
       NULLIF(latest.payload->'ohlcv'->>'high','')::double precision AS high_price,
       NULLIF(latest.payload->'ohlcv'->>'low','')::double precision AS low_price,
       NULLIF(latest.payload->'ohlcv'->>'open','')::double precision AS open_price,
       latest.previous_value AS previous_close,
       NULLIF(latest.payload->'ohlcv'->>'volume','')::double precision AS volume,
       latest.period_end,latest.observed_at,
       COALESCE(history.points,'[]'::jsonb) AS history,
       jsonb_build_object(
         'provider',latest.payload->>'provider','instrument',COALESCE(latest.instrument_metadata,latest.payload->'instrument','{}'::jsonb),
         'market',jsonb_build_object('code',latest.exchange_code,'name',latest.exchange_name,'kind',latest.instrument_type),
         'scope',COALESCE(latest.scope,'country'),'provider_payload',latest.payload
       ) AS payload
     FROM latest
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'country',upper(mic.country_iso2::text),'relationship',mic.relationship,'is_primary',mic.is_primary
       ) ORDER BY mic.is_primary DESC,mic.country_iso2) AS countries
       FROM market_instrument_country mic WHERE mic.instrument_id=latest.instrument_id
     ) rel ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('period_end',point.period_end,'value',point.value) ORDER BY point.period_end) AS points
       FROM (
         SELECT observation.period_end,observation.value
         FROM market_indicator observation
         WHERE observation.source_id=latest.source_id
           AND COALESCE(observation.instrument_id::text,observation.series_key)=COALESCE(latest.instrument_id::text,latest.series_key)
         ORDER BY observation.period_end DESC LIMIT 90
       ) point
     ) history ON true
     WHERE (cardinality($1::text[])=0 OR upper(COALESCE(latest.symbol,latest.series_key))=ANY($1::text[])
            OR upper(COALESCE(latest.canonical_symbol,''))=ANY($1::text[]))
       AND ($2::text='' OR upper(COALESCE(latest.primary_country_iso2,latest.country_iso2)::text)=$2
            OR EXISTS (SELECT 1 FROM market_instrument_country country_link
                       WHERE country_link.instrument_id=latest.instrument_id AND upper(country_link.country_iso2::text)=$2))
       AND ($3::text='' OR lower(COALESCE(latest.instrument_type,''))=$3)
     ORDER BY CASE COALESCE(latest.instrument_type,'equity_index') WHEN 'equity_index' THEN 0 WHEN 'commodity' THEN 1 ELSE 2 END,
       abs(COALESCE(CASE WHEN latest.previous_value=0 THEN NULL ELSE ((latest.value/latest.previous_value)-1)*100 END,0)) DESC,
       latest.name
     LIMIT $4`,
    [symbols, country, instrumentType, limit],
  );
  return rows.map((row) => ({
    ...row,
    related_countries: asArray(row.related_countries),
    history: asArray(row.history),
    payload: asObject(row.payload),
  }));
}

export async function getMarketInstrumentCoverage(): Promise<{
  generated_at: string;
  count: number;
  indices: number;
  commodities: number;
  macro_indicators: number;
  countries: number;
  sources: string[];
}> {
  const { rows } = await query<{
    count: number;
    indices: number;
    commodities: number;
    macro_indicators: number;
    countries: number;
    sources: string[] | null;
  }>(
    `SELECT
       count(DISTINCT instrument.id)::int AS count,
       (count(DISTINCT instrument.id) FILTER (WHERE instrument.instrument_type='equity_index'))::int AS indices,
       (count(DISTINCT instrument.id) FILTER (WHERE instrument.instrument_type='commodity'))::int AS commodities,
       (count(DISTINCT instrument.id) FILTER (WHERE instrument.instrument_type='macro'))::int AS macro_indicators,
       (count(DISTINCT mic.country_iso2) FILTER (
         WHERE mic.relationship IN ('primary_market','index_constituency','economic_indicator')
       ))::int AS countries,
       array_agg(DISTINCT s.name ORDER BY s.name) AS sources
     FROM market_instrument instrument
     JOIN source s ON s.id=instrument.source_id
     LEFT JOIN market_instrument_country mic ON mic.instrument_id=instrument.id
     WHERE instrument.active=true
       AND COALESCE(s.metadata->>'retired','false') <> 'true'
       AND EXISTS (SELECT 1 FROM market_indicator observation WHERE observation.instrument_id=instrument.id)`,
  );
  const coverage = rows[0];
  return {
    generated_at: new Date().toISOString(),
    count: Number(coverage?.count ?? 0),
    indices: Number(coverage?.indices ?? 0),
    commodities: Number(coverage?.commodities ?? 0),
    macro_indicators: Number(coverage?.macro_indicators ?? 0),
    countries: Number(coverage?.countries ?? 0),
    sources: coverage?.sources ?? [],
  };
}
