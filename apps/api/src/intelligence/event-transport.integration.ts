import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { getEventTransport } from "./event-transport";
after(() => pool.end());
test("transport drill-down keeps the anomaly's port, completed hours and historical movements", async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const port = `Port-${randomUUID()}`;
    const { rows: [anchor] } = await client.query(`INSERT INTO transport_movement_event(entity_id,event_type,country_iso2,location_name,observed_at,source_name)
      VALUES('anchor','arrival','ZZ',$1,'2026-11-22T14:35:00Z','fixture') RETURNING id::text`, [port]);
    await client.query(`INSERT INTO transport_movement_event(entity_id,event_type,country_iso2,location_name,observed_at,source_name) VALUES
      ('historical','departure','ZZ',$1,'2026-11-22T13:30:00Z','fixture'),
      ('other-port','departure','ZZ',$2,'2026-11-22T13:30:00Z','fixture'),
      ('unfinished-hour','arrival','ZZ',$1,'2026-11-22T14:10:00Z','fixture')`, [port, `${port}-other`]);
    await client.query(`INSERT INTO transport_movement_hour(bucket,country_iso2,location_name,arrivals,departures) VALUES
      ('2026-11-22T13:00:00Z','ZZ',$1,2,1),('2026-11-22T14:00:00Z','ZZ',$1,99,99)`, [port]);
    const result = await getEventTransport({ location_name: "Current display name" }, [{ domain: "transport", evidence_type: "rolling_baseline_anomaly",
      source_record_type: "transport_movement_event", source_record_id: anchor.id, observed_at: "2026-11-22T14:35:00Z", metadata: { current: 3, baseline: 12 } }], (sql, params) => client.query(sql, params));
    assert.equal(result?.location_name, port);
    assert.equal(result?.window_end, "2026-11-22T14:00:00.000Z");
    assert.equal(result?.hours.length, 1);
    assert.equal(result?.hours[0].arrivals, 2);
    assert.deepEqual(result?.movements.map((row) => row.entity_id), ["historical"]);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
