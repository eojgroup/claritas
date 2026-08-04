import worldCountries from "world-countries";
import { query } from "../db";
import { WORLD_BANK_INDICATORS, parseWorldBankResponse, type WorldBankIndicatorDefinition } from "./world-bank-market-data";

const API_BASE = "https://api.worldbank.org/v2";
const DATASET = "World Development Indicators";
const TERMS_URL = "https://data.worldbank.org/summary-terms-of-use";

type WorldCountry = {
  cca2?: string;
  cca3?: string;
  name?: { common?: string };
  region?: string;
};

const byIso3 = new Map(
  (worldCountries as WorldCountry[]).flatMap((country) => country.cca2 && country.cca3
    ? [[country.cca3.toUpperCase(), country] as const] : []),
);

async function fetchJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Claritas market intelligence/1.0 (https://claritas.info)" },
    });
    if (!response.ok) throw new Error(`World Bank Indicators API HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name,api_base_url,auth_type,metadata)
     VALUES ('world_bank_wdi',$1,'none',$2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url=EXCLUDED.api_base_url,
       auth_type=EXCLUDED.auth_type,metadata=EXCLUDED.metadata
     RETURNING id`,
    [API_BASE, JSON.stringify({
      provider: "world-bank", dataset: DATASET, source_kind: "official_economic_statistics",
      attribution: "The World Bank: World Development Indicators",
      attribution_url: "https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators",
      terms_url: TERMS_URL, license: "CC BY 4.0",
      frequency: "annual",
    })],
  );
  return rows[0].id;
}

async function ensureCountry(iso2: string, iso3: string, name: string, region: string | null): Promise<void> {
  await query(
    `INSERT INTO country (iso2,iso3,name,region) VALUES ($1,$2,$3,$4)
     ON CONFLICT (iso2) DO UPDATE SET iso3=COALESCE(country.iso3,EXCLUDED.iso3),
       name=CASE WHEN country.name=country.iso2::text THEN EXCLUDED.name ELSE country.name END,
       region=COALESCE(country.region,EXCLUDED.region)`,
    [iso2, iso3, name, region],
  );
}

async function ensureInstrument(
  sourceId: number,
  definition: WorldBankIndicatorDefinition,
  iso2: string,
  countryName: string,
  indicatorName: string,
): Promise<number> {
  const providerSymbol = `${definition.code}:${iso2}`;
  const { rows } = await query<{ id: number }>(
    `INSERT INTO market_instrument (
       source_id,provider_symbol,canonical_symbol,name,instrument_type,asset_class,unit,frequency,
       scope,primary_country_iso2,display_priority,metadata
     ) VALUES ($1,$2,$3,$4,'macro','macro',$5,'annual','country',$6,$7,$8::jsonb)
     ON CONFLICT (source_id,provider_symbol) DO UPDATE SET
       name=EXCLUDED.name,unit=EXCLUDED.unit,primary_country_iso2=EXCLUDED.primary_country_iso2,
       display_priority=EXCLUDED.display_priority,active=true,metadata=EXCLUDED.metadata,updated_at=now()
     RETURNING id`,
    [sourceId, providerSymbol, `WB:${providerSymbol}`, `${countryName} · ${definition.shortName}`,
     definition.unit, iso2, definition.priority, JSON.stringify({
       provider: "world-bank", dataset: DATASET, indicator_code: definition.code,
       indicator_name: indicatorName, short_name: definition.shortName,
       value_semantics: definition.valueSemantics,
       data_url: `https://data.worldbank.org/indicator/${definition.code}?locations=${iso2}`,
       license: "CC BY 4.0", attribution: `The World Bank: ${DATASET}`,
     })],
  );
  const instrumentId = rows[0].id;
  await query(
    `INSERT INTO market_instrument_country (instrument_id,country_iso2,relationship,is_primary)
     VALUES ($1,$2,'economic_indicator',true)
     ON CONFLICT (instrument_id,country_iso2,relationship) DO UPDATE SET is_primary=true`,
    [instrumentId, iso2],
  );
  return instrumentId;
}

export async function ingestWorldBankIndicators(): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];
  const ensuredCountries = new Set<string>();

  for (const definition of WORLD_BANK_INDICATORS) {
    try {
      const url = new URL(`${API_BASE}/country/all/indicator/${definition.code}`);
      url.searchParams.set("source", "2");
      url.searchParams.set("format", "json");
      url.searchParams.set("mrv", "10");
      url.searchParams.set("per_page", "4000");
      const parsed = parseWorldBankResponse(await fetchJson(url));
      const cursor = await query<{ last_updated: string | null }>(
        `SELECT cursor->>'last_updated' AS last_updated
         FROM source_feed WHERE source_id=$1 AND feed_key=$2`,
        [sourceId, `indicator:${definition.code}`],
      );
      if (parsed.lastUpdated && cursor.rows[0]?.last_updated === parsed.lastUpdated) {
        results.push({ indicator: definition.code, unchanged: true, source_last_updated: parsed.lastUpdated });
        continue;
      }
      let seriesInserted = 0;
      let seriesUpdated = 0;
      let seriesSkipped = 0;
      const instrumentIds = new Map<string, number>();
      for (const observation of parsed.observations) {
        const country = byIso3.get(observation.countryIso3);
        const iso2 = country?.cca2?.toUpperCase();
        if (!iso2) { skipped += 1; seriesSkipped += 1; continue; }
        const countryName = country?.name?.common ?? observation.countryName;
        if (!ensuredCountries.has(iso2)) {
          await ensureCountry(iso2, observation.countryIso3, countryName, country?.region ?? null);
          ensuredCountries.add(iso2);
        }
        let instrumentId = instrumentIds.get(iso2);
        if (!instrumentId) {
          instrumentId = await ensureInstrument(sourceId, definition, iso2, countryName, observation.indicatorName);
          instrumentIds.set(iso2, instrumentId);
        }
        const periodEnd = `${observation.year}-12-31`;
        const providerSymbol = `${definition.code}:${iso2}`;
        const result = await query<{ inserted: boolean }>(
          `INSERT INTO market_indicator (
             source_id,instrument_id,external_id,category,series_key,symbol,country_iso2,name,unit,
             frequency,period_start,period_end,value,observed_at,payload
           ) VALUES ($1,$2,$3,'macro_indicator',$4,$4,$5,$6,$7,'annual',$8,$9,$10,$11,$12::jsonb)
           ON CONFLICT (source_id,external_id) DO UPDATE SET
             instrument_id=EXCLUDED.instrument_id,country_iso2=EXCLUDED.country_iso2,name=EXCLUDED.name,
             unit=EXCLUDED.unit,value=EXCLUDED.value,observed_at=EXCLUDED.observed_at,
             payload=EXCLUDED.payload,updated_at=now()
           RETURNING (xmax=0) AS inserted`,
          [sourceId, instrumentId, `${providerSymbol}:${observation.year}`, providerSymbol, iso2,
           `${countryName} · ${definition.shortName}`, definition.unit, `${observation.year}-01-01`, periodEnd,
           observation.value, parsed.lastUpdated ? `${parsed.lastUpdated}T12:00:00.000Z` : `${periodEnd}T12:00:00.000Z`,
           JSON.stringify({
             provider: "world-bank", dataset: DATASET, indicator_code: definition.code,
             indicator_name: observation.indicatorName, short_name: definition.shortName,
             country_iso3: observation.countryIso3, observation_status: observation.observationStatus,
             source_last_updated: parsed.lastUpdated, value_semantics: definition.valueSemantics,
             license: "CC BY 4.0", attribution: `The World Bank: ${DATASET}`,
           })],
        );
        if (result.rows[0]?.inserted) { inserted += 1; seriesInserted += 1; }
        else { updated += 1; seriesUpdated += 1; }
      }
      await query(
        `INSERT INTO source_feed (source_id,feed_key,params,cursor)
         VALUES ($1,$2,$3::jsonb,$4::jsonb)
         ON CONFLICT (source_id,feed_key) DO UPDATE SET
           params=EXCLUDED.params,cursor=EXCLUDED.cursor,updated_at=now()`,
        [sourceId, `indicator:${definition.code}`, JSON.stringify({ source: 2, mrv: 10 }),
         JSON.stringify({ last_updated: parsed.lastUpdated, checked_at: new Date().toISOString() })],
      );
      results.push({ indicator: definition.code, inserted: seriesInserted, updated: seriesUpdated, skipped: seriesSkipped });
    } catch (error) {
      failed += 1;
      results.push({ indicator: definition.code, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed === WORLD_BANK_INDICATORS.length) {
    throw new Error(`All World Bank indicator requests failed: ${String(results[0]?.error ?? "unknown error")}`);
  }
  return { provider: "world-bank", dataset: DATASET, indicators: WORLD_BANK_INDICATORS.length, inserted, updated, skipped, failed, results };
}
