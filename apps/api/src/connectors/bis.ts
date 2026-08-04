import worldCountries from "world-countries";
import { query } from "../db";
import { parseCsv } from "./csv";

const BIS_API = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_EER/1.0/D.N.B";
const ATTRIBUTION = "Bank for International Settlements (BIS), effective exchange rate statistics";

type WorldCountry = { cca2?: string; cca3?: string; name?: { common?: string } };

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('bis', $1, 'none', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type, metadata = EXCLUDED.metadata
     RETURNING id`,
    [BIS_API, JSON.stringify({
      provider: "bis", dataset: "Effective exchange rates", source_kind: "official_statistics",
      attribution: ATTRIBUTION, attribution_url: "https://data.bis.org/topics/EER",
      terms_url: "https://www.bis.org/terms_statistics.htm", frequency: "daily",
      measure: "Nominal broad effective exchange-rate index",
      commercial_note: "BIS inclusion must not result in an additional charge to product users.",
    })]
  );
  return rows[0].id;
}

export async function ingestBisEffectiveExchangeRates(): Promise<Record<string, unknown>> {
  const lookbackDays = Math.min(Math.max(Number(process.env.BIS_LOOKBACK_DAYS) || 45, 7), 730);
  const url = new URL(BIS_API);
  url.searchParams.set("startPeriod", isoDateDaysAgo(lookbackDays));
  const response = await fetch(url, {
    headers: { accept: "application/vnd.sdmx.data+csv;version=2.0.0" },
  });
  if (!response.ok) throw new Error(`BIS effective-exchange-rate API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const rows = parseCsv(await response.text());
  const sourceId = await ensureSource();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const iso2 = (row.REF_AREA || "").trim().toUpperCase();
    const period = (row.TIME_PERIOD || "").slice(0, 10);
    const value = Number(row.OBS_VALUE);
    const country = (worldCountries as WorldCountry[]).find((entry) => entry.cca2 === iso2);
    if (!country || !/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(value)) {
      skipped += 1;
      continue;
    }
    await query(
      `INSERT INTO country (iso2, iso3, name) VALUES ($1::char(2), $2::char(3), $3)
       ON CONFLICT (iso2) DO UPDATE SET iso3 = COALESCE(country.iso3, EXCLUDED.iso3)`,
      [iso2, country.cca3 ?? null, country.name?.common ?? iso2]
    );
    const externalId = `EER:N:B:${iso2}:${period}`;
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO market_indicator (
         source_id, external_id, category, series_key, country_iso2, name, unit,
         frequency, period_start, period_end, value, observed_at, payload
       ) VALUES ($1,$2,'effective_exchange_rate',$3,$4,$5,'Index, 2020=100','daily',$6,$6,$7,$8,$9)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         value = EXCLUDED.value, observed_at = EXCLUDED.observed_at,
         payload = EXCLUDED.payload, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, externalId, `BIS:EER:N:B:${iso2}`, iso2,
       `${country.name?.common ?? iso2} nominal broad effective exchange rate`, period, value,
       `${period}T16:00:00.000Z`, JSON.stringify({
         provider: "bis", attribution: ATTRIBUTION, frequency: row.FREQ || "D",
         eer_type: row.EER_TYPE || "N", basket: row.EER_BASKET || "B",
         observation_status: row.OBS_STATUS || null,
       })]
    );
    if (result.rows[0]?.inserted) inserted += 1; else updated += 1;
  }
  return { provider: "bis", dataset: "nominal broad effective exchange rates", inserted, updated, skipped, rows_received: rows.length };
}
