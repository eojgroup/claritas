import { query } from "../db";
import { FRED_SERIES, parseFredObservations, type FredSeriesDefinition } from "./fred-market-data";

const FRED_API = "https://api.stlouisfed.org/fred/series/observations";
const FRED_TERMS = "https://fred.stlouisfed.org/docs/api/terms_of_use.html";
const FRED_NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";

function requireApiKey(): string {
  const key = process.env.FRED_API_KEY?.trim();
  if (!key) throw new Error("FRED selected but FRED_API_KEY is not configured.");
  return key;
}

async function fetchJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Claritas market intelligence/1.0 (https://claritas.info)" },
    });
    if (!response.ok) throw new Error(`FRED API HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name,api_base_url,auth_type,metadata)
     VALUES ('fred',$1,'api_key',$2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url=EXCLUDED.api_base_url,
       auth_type=EXCLUDED.auth_type,metadata=EXCLUDED.metadata
     RETURNING id`,
    [FRED_API, JSON.stringify({
      provider: "fred", source_kind: "official_economic_statistics",
      attribution: "Federal Reserve Bank of St. Louis, FRED; original publisher retained per series",
      attribution_url: "https://fred.stlouisfed.org/", terms_url: FRED_TERMS,
      required_notice: FRED_NOTICE,
      rights_policy: "Claritas allowlists only series originating with named U.S. public institutions.",
    })],
  );
  return rows[0].id;
}

async function ensureUsCountry(): Promise<void> {
  await query(
    `INSERT INTO country (iso2,iso3,name,region) VALUES ('US','USA','United States','Americas')
     ON CONFLICT (iso2) DO UPDATE SET iso3=COALESCE(country.iso3,EXCLUDED.iso3),
       region=COALESCE(country.region,EXCLUDED.region)`,
  );
}

async function ensureInstrument(sourceId: number, definition: FredSeriesDefinition): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO market_instrument (
       source_id,provider_symbol,canonical_symbol,name,instrument_type,asset_class,currency,unit,
       frequency,scope,primary_country_iso2,display_priority,metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (source_id,provider_symbol) DO UPDATE SET
       canonical_symbol=EXCLUDED.canonical_symbol,name=EXCLUDED.name,instrument_type=EXCLUDED.instrument_type,
       asset_class=EXCLUDED.asset_class,currency=EXCLUDED.currency,unit=EXCLUDED.unit,
       frequency=EXCLUDED.frequency,scope=EXCLUDED.scope,primary_country_iso2=EXCLUDED.primary_country_iso2,
       display_priority=EXCLUDED.display_priority,active=true,metadata=EXCLUDED.metadata,updated_at=now()
     RETURNING id`,
    [sourceId, definition.seriesId, definition.canonicalSymbol, definition.name,
     definition.instrumentType, definition.assetClass, definition.instrumentType === "commodity" ? "USD" : null,
     definition.unit, definition.frequency, definition.scope, definition.country,
     definition.priority, JSON.stringify({
       provider: "fred", series_id: definition.seriesId,
       data_url: `https://fred.stlouisfed.org/series/${definition.seriesId}`,
       original_publisher: definition.originalPublisher, value_semantics: definition.valueSemantics,
       required_notice: FRED_NOTICE,
     })],
  );
  const instrumentId = rows[0].id;
  const linkCountry = definition.country ?? "US";
  await query(
    `INSERT INTO market_instrument_country (instrument_id,country_iso2,relationship,is_primary,metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (instrument_id,country_iso2,relationship) DO UPDATE SET
       is_primary=EXCLUDED.is_primary,metadata=EXCLUDED.metadata`,
    [instrumentId, linkCountry, definition.relationship, definition.country != null,
     JSON.stringify({ original_publisher: definition.originalPublisher })],
  );
  return instrumentId;
}

function defaultStart(definition: FredSeriesDefinition): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - (definition.frequency === "daily" ? 3 : 12));
  return date.toISOString().slice(0, 10);
}

export async function ingestFredMarketData(): Promise<Record<string, unknown>> {
  const apiKey = requireApiKey();
  await ensureUsCountry();
  const sourceId = await ensureSource();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const definition of FRED_SERIES) {
    try {
      const instrumentId = await ensureInstrument(sourceId, definition);
      const latest = await query<{ period_end: string | Date | null }>(
        `SELECT max(period_end) AS period_end FROM market_indicator WHERE instrument_id=$1`,
        [instrumentId],
      );
      const latestDate = latest.rows[0]?.period_end ? new Date(latest.rows[0].period_end) : null;
      const start = latestDate && Number.isFinite(latestDate.getTime())
        ? new Date(latestDate.getTime() - (definition.frequency === "daily" ? 14 : 62) * 86400000).toISOString().slice(0, 10)
        : defaultStart(definition);
      const url = new URL(FRED_API);
      url.searchParams.set("series_id", definition.seriesId);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("observation_start", start);
      url.searchParams.set("sort_order", "asc");
      const observations = parseFredObservations(await fetchJson(url));
      let seriesInserted = 0;
      let seriesUpdated = 0;
      for (const observation of observations) {
        const result = await query<{ inserted: boolean }>(
          `INSERT INTO market_indicator (
             source_id,instrument_id,external_id,category,series_key,symbol,country_iso2,name,unit,
             frequency,period_start,period_end,value,observed_at,payload
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14::jsonb)
           ON CONFLICT (source_id,external_id) DO UPDATE SET
             instrument_id=EXCLUDED.instrument_id,country_iso2=EXCLUDED.country_iso2,name=EXCLUDED.name,
             unit=EXCLUDED.unit,frequency=EXCLUDED.frequency,value=EXCLUDED.value,
             observed_at=EXCLUDED.observed_at,payload=EXCLUDED.payload,updated_at=now()
           RETURNING (xmax=0) AS inserted`,
          [sourceId, instrumentId, `${definition.seriesId}:${observation.date}`, definition.category,
           definition.seriesId, definition.canonicalSymbol, definition.country, definition.name,
           definition.unit, definition.frequency, observation.date, observation.value,
           `${observation.date}T12:00:00.000Z`, JSON.stringify({
             provider: "fred", series_id: definition.seriesId, original_publisher: definition.originalPublisher,
             attribution: `${definition.originalPublisher}; retrieved through FRED, Federal Reserve Bank of St. Louis`,
             value_semantics: definition.valueSemantics, realtime_start: observation.realtimeStart,
             realtime_end: observation.realtimeEnd, required_notice: FRED_NOTICE,
           })],
        );
        if (result.rows[0]?.inserted) { inserted += 1; seriesInserted += 1; }
        else { updated += 1; seriesUpdated += 1; }
      }
      if (!observations.length) skipped += 1;
      results.push({ series_id: definition.seriesId, inserted: seriesInserted, updated: seriesUpdated, received: observations.length });
    } catch (error) {
      failed += 1;
      results.push({ series_id: definition.seriesId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed === FRED_SERIES.length) throw new Error(`All FRED series failed: ${String(results[0]?.error ?? "unknown error")}`);
  return { provider: "fred", series: FRED_SERIES.length, inserted, updated, skipped, failed, results };
}
