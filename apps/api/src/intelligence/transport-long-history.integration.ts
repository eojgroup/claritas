import assert from "node:assert/strict";
import test, { after } from "node:test";
import { pool, query } from "../db";
import { getTransportOverview } from "../connectors/transport";
after(() => pool.end());

test("long country history reads year-old daily samples without polluting the default cached window", async () => {
  const country = "XY";
  const day = new Date(); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() - 365);
  await query(`INSERT INTO transport_country_activity_day(bucket,mode,country_iso2,peak_active_entities,observed_hour_mask,first_observed_at,last_observed_at,source_names)
    VALUES($1::timestamptz::date,'aviation',$2,42,1,$1::timestamptz,$1::timestamptz,ARRAY['long-history-fixture'])`, [day, country]);
  try {
    const short = await getTransportOverview({ country, mode: "aviation", detail: "aggregate" });
    assert.equal(short.history?.requested_days, 90);
    assert.equal(short.history?.series.some((point) => point.aviation_entities === 42), false);
    const long = await getTransportOverview({ country, mode: "aviation", detail: "aggregate", historyDays: 400 });
    assert.equal(long.history?.series.length, 400);
    assert.equal(long.history?.activity_retention_days, 400);
    assert.equal(long.history?.series.find((point) => point.bucket === day.toISOString())?.aviation_entities, 42);
    assert.equal(long.history?.comparisons.find((row) => row.key === "same_window_last_year")?.change_percent, null);
    const cachedShort = await getTransportOverview({ country, mode: "aviation", detail: "aggregate" });
    assert.equal(cachedShort.history?.requested_days, 90);
  } finally {
    await query(`DELETE FROM transport_country_activity_day WHERE country_iso2=$1 AND source_names=ARRAY['long-history-fixture']`, [country]);
  }
});
