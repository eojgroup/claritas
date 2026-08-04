import { query } from "../db";
import { MARKET_INSTRUMENTS, parseYahooChart } from "./yahoo-market-data";
export { MARKET_INSTRUMENTS, parseYahooChart } from "./yahoo-market-data";

// One chart request per instrument lets partial upstream outages retain good data.

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('yahoo-finance-chart','https://query1.finance.yahoo.com/v8/finance/chart/','none',$1::jsonb)
     ON CONFLICT (name) DO UPDATE SET metadata=EXCLUDED.metadata RETURNING id`,
    [JSON.stringify({ provider: "yahoo-finance", source_kind: "market_data", frequency: "daily",
      attribution: "Yahoo Finance", attribution_url: "https://finance.yahoo.com/" })],
  );
  return rows[0].id;
}

export async function ingestMajorMarkets(): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - Math.min(Math.max(Number(process.env.MARKET_HISTORY_DAYS) || 730, 30), 3650) * 86400;
  let inserted = 0, updated = 0, skipped = 0, failed = 0;
  for (const instrument of MARKET_INSTRUMENTS) {
    try {
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.symbol)}`);
      url.searchParams.set("period1", String(period1)); url.searchParams.set("period2", String(period2));
      url.searchParams.set("interval", "1d"); url.searchParams.set("events", "history");
      const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "Claritas market intelligence/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const points = parseYahooChart(await response.json());
      if (!points.length) throw new Error("empty chart response");
      for (const point of points) {
        const result = await query<{ inserted: boolean }>(
          `INSERT INTO market_indicator (source_id,external_id,category,series_key,symbol,country_iso2,name,unit,frequency,period_start,period_end,value,observed_at,payload)
           VALUES ($1,$2,$3,$4,$4,$5,$6,'Index points / quoted units','daily',$7,$7,$8,$9,$10)
           ON CONFLICT (source_id,external_id) DO UPDATE SET value=EXCLUDED.value,observed_at=EXCLUDED.observed_at,payload=EXCLUDED.payload,updated_at=now()
           RETURNING (xmax=0) AS inserted`,
          [sourceId, `${instrument.symbol}:${point.date}`, instrument.category, instrument.symbol, instrument.country,
           instrument.name, point.date, point.value, point.observedAt, JSON.stringify({ provider: "yahoo-finance", instrument })],
        );
        if (result.rows[0]?.inserted) inserted++; else updated++;
      }
    } catch { failed++; skipped++; }
  }
  if (failed === MARKET_INSTRUMENTS.length) throw new Error("All individual major-market requests failed.");
  return { provider: "yahoo-finance", instruments: MARKET_INSTRUMENTS.length, inserted, updated, skipped, failed };
}
