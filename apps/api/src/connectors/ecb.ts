import { query } from "../db";

const ECB_API_BASE = "https://data-api.ecb.europa.eu/service/data";
const DEFAULT_CURRENCIES = ["USD", "GBP", "JPY", "CHF", "CNY", "CAD", "AUD", "INR", "BRL", "MXN", "ZAR", "SGD"];

type EcbSeriesConfig = {
  flow: string;
  key: string;
  category: "fx_reference" | "interest_rate" | "money_market_rate";
  symbol?: string;
  name: string;
};

export type EcbIngestParams = {
  currencies?: string[];
  lookbackDays?: number;
  includeInterestRates?: boolean;
};

export type FxRate = {
  series_key: string;
  symbol: string;
  name: string;
  base_currency: string;
  quote_currency: string;
  value: number;
  previous_value: number | null;
  change: number | null;
  percent_change: number | null;
  period_end: string;
  source_name: string;
};

export type PolicyRate = {
  series_key: string;
  name: string;
  value: number;
  unit: string | null;
  period_end: string;
  source_name: string;
};

const POLICY_SERIES: EcbSeriesConfig[] = [
  { flow: "FM", key: "D.U2.EUR.4F.KR.DFR.LEV", category: "interest_rate", name: "ECB deposit facility rate" },
  { flow: "FM", key: "D.U2.EUR.4F.KR.MRR_FR.LEV", category: "interest_rate", name: "ECB main refinancing operations rate" },
  { flow: "FM", key: "D.U2.EUR.4F.KR.MLFR.LEV", category: "interest_rate", name: "ECB marginal lending facility rate" },
  { flow: "EST", key: "B.EU000A2X2A25.WT", category: "money_market_rate", name: "Euro short-term rate (€STR)" },
];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), min), max) : fallback;
}

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length > 0) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.filter((values) => values.some(Boolean)).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = values[index] ?? ""; });
    return record;
  });
}

async function fetchSeries(config: EcbSeriesConfig, startPeriod: string): Promise<Array<Record<string, string>>> {
  const base = (process.env.ECB_DATA_API_BASE_URL || ECB_API_BASE).replace(/\/$/, "");
  const url = new URL(`${base}/${config.flow}/${config.key}`);
  url.searchParams.set("startPeriod", startPeriod);
  url.searchParams.set("format", "csvdata");
  const response = await fetch(url, { headers: { accept: "text/csv", "user-agent": "Claritas/1.0 (https://claritas.info)" } });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`ECB Data API HTTP ${response.status}: ${body}`);
  }
  return parseCsv(await response.text());
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('ecb', $1, 'none', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url, metadata = EXCLUDED.metadata
     RETURNING id`,
    [ECB_API_BASE, JSON.stringify({
      provider: "ecb", standard: "SDMX 2.1",
      attribution: "European Central Bank",
      attribution_url: "https://data.ecb.europa.eu/",
      reuse: "Free access and reuse subject to ECB statistical data policy",
    })]
  );
  return rows[0].id;
}

function normalizeCurrencies(values?: string[]): string[] {
  const selected = values && values.length > 0 ? values : DEFAULT_CURRENCIES;
  return Array.from(new Set(selected.map((value) => value.trim().toUpperCase()).filter((value) => /^[A-Z]{3}$/.test(value) && value !== "EUR"))).slice(0, 30);
}

async function upsertRows(sourceId: number, config: EcbSeriesConfig, rows: Array<Record<string, string>>): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const period = row.TIME_PERIOD;
    const value = Number(row.OBS_VALUE);
    const seriesKey = row.KEY || `${config.flow}.${config.key}`;
    if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(value)) { skipped += 1; continue; }
    const currency = row.CURRENCY || undefined;
    const symbol = config.symbol ?? (currency ? `EUR/${currency}` : undefined);
    const name = row.TITLE || config.name;
    const externalId = `${seriesKey}:${period}`;
    const payload = {
      provider: "ecb", flow: config.flow, key: config.key,
      observation_status: row.OBS_STATUS || null,
      confidence_status: row.OBS_CONF || row.CONF_STATUS || null,
      title_complement: row.TITLE_COMPL || null,
      base_currency: currency ? "EUR" : null,
      quote_currency: currency ?? null,
      raw: row,
    };
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO market_indicator (
         source_id, external_id, category, series_key, symbol, country_iso2,
         name, unit, frequency, period_end, value, observed_at, payload
       ) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         name = EXCLUDED.name, unit = EXCLUDED.unit, frequency = EXCLUDED.frequency,
         value = EXCLUDED.value, observed_at = EXCLUDED.observed_at,
         payload = EXCLUDED.payload, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, externalId, config.category, seriesKey, symbol ?? null,
       name, row.UNIT || row.UNIT_MEASURE || null, row.FREQ || null, period, value,
       `${period}T16:00:00.000Z`, JSON.stringify(payload)]
    );
    if (result.rows[0]?.inserted) inserted += 1; else updated += 1;
  }
  return { inserted, updated, skipped };
}

export async function ingestEcbData(params: EcbIngestParams = {}): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  const currencies = normalizeCurrencies(params.currencies);
  const lookbackDays = clampInt(params.lookbackDays, 7, 3650, 45);
  const startPeriod = isoDateDaysAgo(lookbackDays);
  const results: Array<Record<string, unknown>> = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const fxConfig: EcbSeriesConfig = {
    flow: "EXR", key: `D.${currencies.join("+")}.EUR.SP00.A`,
    category: "fx_reference", name: "ECB euro foreign exchange reference rate",
  };
  try {
    const totals = await upsertRows(sourceId, fxConfig, await fetchSeries(fxConfig, startPeriod));
    inserted += totals.inserted; updated += totals.updated; skipped += totals.skipped;
    results.push({ series: "FX reference rates", ...totals });
  } catch (error) {
    skipped += 1;
    results.push({ series: "FX reference rates", error: error instanceof Error ? error.message : String(error) });
  }
  if (params.includeInterestRates !== false) {
    for (const config of POLICY_SERIES) {
      try {
        const totals = await upsertRows(sourceId, config, await fetchSeries(config, startPeriod));
        inserted += totals.inserted; updated += totals.updated; skipped += totals.skipped;
        results.push({ series: config.name, ...totals });
      } catch (error) {
        skipped += 1;
        results.push({ series: config.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { provider: "ecb", inserted, updated, skipped, currencies, start_period: startPeriod, results };
}

export async function getLatestFxRates(): Promise<FxRate[]> {
  const { rows } = await query<FxRate>(
    `WITH ranked AS (
       SELECT mi.*, s.name AS source_name,
              row_number() OVER (PARTITION BY mi.series_key ORDER BY mi.period_end DESC, mi.id DESC) AS rn,
              lag(mi.value) OVER (PARTITION BY mi.series_key ORDER BY mi.period_end ASC, mi.id ASC) AS previous_value
       FROM market_indicator mi JOIN source s ON s.id = mi.source_id
       WHERE mi.category = 'fx_reference'
     )
     SELECT series_key, symbol, name,
            COALESCE(payload->>'base_currency', 'EUR') AS base_currency,
            COALESCE(payload->>'quote_currency', split_part(symbol, '/', 2)) AS quote_currency,
            value, previous_value, value - previous_value AS change,
            CASE WHEN previous_value IS NULL OR previous_value = 0 THEN NULL
                 ELSE ((value - previous_value) / previous_value) * 100 END AS percent_change,
            period_end, source_name
     FROM ranked WHERE rn = 1 ORDER BY symbol`
  );
  return rows;
}

export async function getLatestPolicyRates(): Promise<PolicyRate[]> {
  const { rows } = await query<PolicyRate>(
    `SELECT DISTINCT ON (mi.series_key)
       mi.series_key, mi.name, mi.value, mi.unit, mi.period_end, s.name AS source_name
     FROM market_indicator mi JOIN source s ON s.id = mi.source_id
     WHERE mi.category IN ('interest_rate', 'money_market_rate')
     ORDER BY mi.series_key, mi.period_end DESC, mi.id DESC`
  );
  return rows;
}
