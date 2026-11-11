import assert from "node:assert/strict";
import test, { after } from "node:test";
import { pool } from "../db";
import { gdeltCanonicalPendingQuery, gdeltCanonicalRemainingQuery } from "../connectors/gdelt-canonical-queries";

after(() => pool.end());

test("canonical history uses bounded pending indexes, numeric keysets and lossless IDs even after completion", async () => {
  const client = await pool.connect();
  try {
    // Temporary shadow tables keep this plan regression isolated from other
    // ingestion fixtures and from real application records.
    for (const table of ["item", "news_signal"]) {
      await client.query(`CREATE TEMP TABLE ${table}(id bigint PRIMARY KEY,source_id bigint,kind text,url text,external_id text,payload jsonb)`);
      await client.query(`CREATE INDEX ${table}_pending_test ON ${table}(source_id,id)
        WHERE ${table === "item" ? "kind='news_article' AND" : ""}
          payload->>'canonical_url_algorithm' IS DISTINCT FROM 'whatwg-url-v1'`);
      await client.query(`INSERT INTO ${table} SELECT id,1,'news_article','https://example.org/'||id,id::text,
        '{"canonical_url_algorithm":"whatwg-url-v1"}'::jsonb FROM generate_series(1,20000) id`);
      await client.query(`UPDATE ${table} SET payload='{}' WHERE id IN (9,10,100)`);
      await client.query(`INSERT INTO ${table} VALUES(9007199254740993,1,'news_article','https://example.org/large','large','{}')`);
      await client.query(`VACUUM ANALYZE ${table}`);
      const first = await client.query(gdeltCanonicalPendingQuery(table as "item" | "news_signal"), [1, "whatwg-url-v1", "0", 2]);
      assert.deepEqual(first.rows.map((row) => row.id), ["9", "10"], "LIMIT must apply in numeric ID order before text presentation");
      const rest = await client.query(gdeltCanonicalPendingQuery(table as "item" | "news_signal"), [1, "whatwg-url-v1", "10", 2]);
      assert.deepEqual(rest.rows.map((row) => row.id), ["100", "9007199254740993"]);
      await client.query(`UPDATE ${table} SET payload='{"canonical_url_algorithm":"whatwg-url-v1"}'`);
      await client.query(`VACUUM ANALYZE ${table}`);
      const sql = gdeltCanonicalPendingQuery(table as "item" | "news_signal");
      const completed = await client.query(sql, [1, "whatwg-url-v1", "0", 500]);
      assert.equal(completed.rows.length, 0);
      const plan = JSON.stringify((await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, [1, "whatwg-url-v1", "0", 500])).rows);
      assert.match(plan, new RegExp(`${table}_pending_test`), "completed repair must inspect the pending index rather than rescan history");
      assert.match(plan, /Index Only Scan/);
    }
    assert.deepEqual((await client.query(gdeltCanonicalRemainingQuery, [1, "whatwg-url-v1"])).rows, [{ items: false, signals: false }]);
    const completionPlan = JSON.stringify((await client.query(`EXPLAIN (FORMAT JSON) ${gdeltCanonicalRemainingQuery}`, [1, "whatwg-url-v1"])).rows);
    assert.match(completionPlan, /item_pending_test/);
    assert.match(completionPlan, /news_signal_pending_test/);
    await client.query("UPDATE news_signal SET payload='{}' WHERE id=10");
    assert.deepEqual((await client.query(gdeltCanonicalRemainingQuery, [1, "whatwg-url-v1"])).rows, [{ items: false, signals: true }]);
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.item,pg_temp.news_signal");
    client.release();
  }
});
