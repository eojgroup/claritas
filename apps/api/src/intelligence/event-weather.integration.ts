import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { getEventWeather } from "./event-weather";
after(() => pool.end());

test("weather visuals use timely retained reference data and explicitly separate forecasts from event history", async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO country(iso2,name) VALUES('ZZ','Weather visual fixture') ON CONFLICT DO NOTHING");
    const source = (await client.query("INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org/weather') RETURNING id", [`weather-visual-${randomUUID()}`])).rows[0].id;
    const activity = new Date().toISOString();
    await client.query(`INSERT INTO weather_snapshot(source_id,country_iso2,observed_at,temp_c,wind_speed,wind_direction,precipitation_mm,source_kind,payload)
      VALUES($1,'ZZ',$2,20,5,90,2,'forecast_model','{"location_name":"Reference station"}')`, [source, activity]);
    await client.query(`INSERT INTO weather_forecast(source_id,country_iso2,granularity,forecast_time,temp_c,payload)
      VALUES($1,'ZZ','hourly',$2::timestamptz,20,'{}'),($1,'ZZ','hourly',$2::timestamptz+interval '3 hours',22,'{}')`, [source, activity]);
    const read = (sql: string, params: any[]) => client.query(sql, params);
    const input = { primary_country_iso2: "ZZ", last_activity_time: activity };
    const weather = await getEventWeather(input, read);
    assert.equal(weather?.temp_c, 20);
    assert.equal(weather?.wind_speed, 5);
    assert.equal(weather?.forecast.length, 2);
    assert.match(weather?.scope_label ?? "", /not the event site/);
    assert.match(weather?.notice ?? "", /forecast, not observed event history/);
    assert.equal(await getEventWeather({ ...input, last_activity_time: new Date(Date.now() - 24 * 3600_000).toISOString() }, read), null);
    await client.query("UPDATE source SET metadata='{\"retired\":true}' WHERE id=$1", [source]);
    assert.equal(await getEventWeather(input, read), null);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
