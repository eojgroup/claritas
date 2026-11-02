import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../db";

test("feed projection tracks canonical event changes and deletion in the same transaction", async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const id = randomUUID();
    await client.query(`INSERT INTO intelligence_event
      (id,dedupe_key,event_type,title,summary,start_time,last_activity_time,metadata)
      VALUES($1::uuid,$1::text,'security_incident','Projection fixture','Large canonical text stays outside ranking',now(),now(),
        '{"origin_domain":"news","canonical_evidence_key":"news:item:123","private_large_context":"excluded"}')`, [id]);
    const initial = (await client.query("SELECT * FROM intelligence_event_feed WHERE id=$1", [id])).rows[0];
    assert.equal(initial.id, id);
    assert.equal(initial.event_type, "security_incident");
    assert.deepEqual(initial.metadata, { origin_domain: "news", canonical_evidence_key: "news:item:123" });
    assert.equal(initial.title, undefined);
    await client.query(`UPDATE intelligence_event SET status='resolved',severity='high',relevance_score=0.9,
      end_time=now(),metadata='{"origin_domain":"weather","canonical_evidence_key":"weather:1"}' WHERE id=$1`, [id]);
    const updated = (await client.query("SELECT * FROM intelligence_event_feed WHERE id=$1", [id])).rows[0];
    assert.equal(updated.status, "resolved");
    assert.equal(updated.severity, "high");
    assert.equal(updated.relevance_score, 0.9);
    assert.ok(updated.end_time);
    assert.deepEqual(updated.metadata, { origin_domain: "weather", canonical_evidence_key: "weather:1" });
    await client.query("DELETE FROM intelligence_event WHERE id=$1", [id]);
    assert.equal((await client.query("SELECT id FROM intelligence_event_feed WHERE id=$1", [id])).rowCount, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test.after(async () => { await pool.end(); });
