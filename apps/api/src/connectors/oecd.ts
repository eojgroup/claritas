import worldCountries from "world-countries";
import { query } from "../db";
import { parseCsv } from "./csv";
import { buildOecdRequest } from "./oecd-request";

const OECD_API = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/.M.SHARE.IX.....";
const DATASET = "OECD Main Economic Indicators: Share prices";
const ATTRIBUTION = "OECD, Main Economic Indicators, Share prices (accessed via OECD Data Explorer)";

type WorldCountry = { cca2?: string; cca3?: string; name?: { common?: string } };
const iso3ToIso2 = new Map(
  (worldCountries as WorldCountry[]).flatMap((country) =>
    country.cca2 && country.cca3 ? [[country.cca3.toUpperCase(), country.cca2.toUpperCase()] as const] : []
  )
);

function monthEnd(period: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).toISOString().slice(0, 10);
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('oecd', $1, 'none', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type, metadata = EXCLUDED.metadata
     RETURNING id`,
    [OECD_API, JSON.stringify({
      provider: "oecd", dataset: DATASET, source_kind: "official_statistics",
      attribution: ATTRIBUTION, attribution_url: "https://www.oecd.org/en/data/indicators/share-prices.html",
      terms_url: "https://www.oecd.org/en/about/terms-conditions.html",
      frequency: "monthly", methodology_note: "Index level; base period is provided by the upstream observation.",
    })]
  );
  return rows[0].id;
}

async function ensureInstrument(sourceId: number, iso2: string, name: string, unit: string): Promise<number> {
  const providerSymbol = `OECD:SHARE:${iso2}`;
  const { rows } = await query<{ id: number }>(
    `INSERT INTO market_instrument (
       source_id,provider_symbol,canonical_symbol,name,instrument_type,asset_class,unit,frequency,
       scope,primary_country_iso2,display_priority,metadata
     ) VALUES ($1,$2,$3,$4,'equity_index','equities',$5,'monthly','country',$6,80,$7::jsonb)
     ON CONFLICT (source_id,provider_symbol) DO UPDATE SET
       name=EXCLUDED.name,unit=EXCLUDED.unit,primary_country_iso2=EXCLUDED.primary_country_iso2,
       active=true,metadata=EXCLUDED.metadata,updated_at=now()
     RETURNING id`,
    [sourceId, providerSymbol, `OECD-SHARE-${iso2}`, name, unit, iso2, JSON.stringify({
      provider: "oecd", dataset: DATASET,
      data_url: "https://www.oecd.org/en/data/indicators/share-prices.html",
    })],
  );
  const instrumentId = rows[0].id;
  await query(
    `INSERT INTO market_instrument_country (instrument_id,country_iso2,relationship,is_primary)
     VALUES ($1,$2,'primary_market',true) ON CONFLICT DO NOTHING`,
    [instrumentId, iso2],
  );
  return instrumentId;
}

export async function ingestOecdSharePrices(): Promise<Record<string, unknown>> {
  const lookbackMonths = Math.min(Math.max(Number(process.env.OECD_LOOKBACK_MONTHS) || 18, 3), 120);
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - lookbackMonths);
  // OECD's SDMX service currently errors with `languageTag1` while negotiating
  // an unspecified CSV dialect/language. Request the SDMX CSV 2 dialect and an
  // explicit label language; use the documented snake-case query parameter.
  const request = buildOecdRequest(OECD_API, start.toISOString().slice(0, 7));
  const response = await fetch(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OECD share-price API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const rows = parseCsv(await response.text());
  const sourceId = await ensureSource();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const instrumentIds = new Map<string, number>();
  for (const row of rows) {
    const iso2 = iso3ToIso2.get((row.REF_AREA || "").toUpperCase());
    const periodEnd = monthEnd(row.TIME_PERIOD || "");
    const value = Number(row.OBS_VALUE);
    if (!iso2 || !periodEnd || !Number.isFinite(value)) {
      skipped += 1;
      continue;
    }
    const country = (worldCountries as WorldCountry[]).find((entry) => entry.cca2 === iso2);
    await query(
      `INSERT INTO country (iso2, iso3, name)
       VALUES ($1::char(2), $2::char(3), $3)
       ON CONFLICT (iso2) DO UPDATE SET iso3 = COALESCE(country.iso3, EXCLUDED.iso3)`,
      [iso2, row.REF_AREA, country?.name?.common ?? iso2]
    );
    const instrumentName = row["Reference area"] ? `${row["Reference area"]} share-price index` : `${iso2} share-price index`;
    const unit = row["Unit of measure"] || row.UNIT_MEASURE || "Index";
    let instrumentId = instrumentIds.get(iso2);
    if (!instrumentId) {
      instrumentId = await ensureInstrument(sourceId, iso2, instrumentName, unit);
      instrumentIds.set(iso2, instrumentId);
    }
    const externalId = `SHARE:${iso2}:${row.TIME_PERIOD}`;
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO market_indicator (
         source_id, instrument_id, external_id, category, series_key, symbol, country_iso2, name, unit,
         frequency, period_start, period_end, value, observed_at, payload
       ) VALUES ($1,$2,$3,'country_equity_index',$4,$4,$5,$6,$7,'monthly',$8,$8,$9,$10,$11)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         instrument_id = EXCLUDED.instrument_id, symbol = EXCLUDED.symbol,
         value = EXCLUDED.value, observed_at = EXCLUDED.observed_at,
         unit = EXCLUDED.unit, payload = EXCLUDED.payload, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, instrumentId, externalId, `OECD:SHARE:${iso2}`, iso2,
       instrumentName, unit, periodEnd, value,
       `${periodEnd}T12:00:00.000Z`, JSON.stringify({
         provider: "oecd", dataset: DATASET, attribution: ATTRIBUTION,
         reference_area: row["Reference area"] || null, base_period: row.BASE_PER || null,
         observation_status: row.OBS_STATUS || null, time_period: row.TIME_PERIOD,
       })]
    );
    if (result.rows[0]?.inserted) inserted += 1; else updated += 1;
  }
  return { provider: "oecd", dataset: DATASET, inserted, updated, skipped, rows_received: rows.length };
}
