import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db";
import { buildTransportRetentionBatchQuery } from "../connectors/transport-retention-query";

test("retention bounds a shared-timestamp backlog and preserves retained records", async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    // A session-local table exercises physical tuple deletion without touching
    // any source fixture or live transport record in the shared test database.
    await client.query("CREATE TEMP TABLE transport_track_point(observed_at timestamptz NOT NULL,marker text) ON COMMIT DROP");
    await client.query(`INSERT INTO transport_track_point SELECT now()-interval '10 days','expired' FROM generate_series(1,10000)`);
    await client.query("INSERT INTO transport_track_point VALUES(now(),'retained')");
    await client.query("CREATE INDEX ON transport_track_point(observed_at)");
    const sql = buildTransportRetentionBatchQuery("transport_track_point", "observed_at");
    const first = (await client.query(sql, [3, 500])).rows[0];
    assert.equal(Number(first.deleted), 500);
    assert.ok(first.oldest_expired_at);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM transport_track_point WHERE marker='retained'")).rows[0].count, 1);
    const remaining = (await client.query(sql, [3, 10000])).rows[0];
    assert.equal(Number(remaining.deleted), 9500);
    assert.equal(remaining.oldest_expired_at, null);
    const empty = (await client.query(sql, [3, 500])).rows[0];
    assert.equal(Number(empty.deleted), 0);
    assert.throws(() => buildTransportRetentionBatchQuery("transport_track_point; DROP TABLE item", "observed_at"), /Invalid/);
    assert.throws(() => buildTransportRetentionBatchQuery("transport_track_point", "bucket"), /Invalid/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
test.after(() => pool.end());
