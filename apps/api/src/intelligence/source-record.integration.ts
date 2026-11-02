import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { getIntelligenceEvent, listIntelligenceEvents } from "./service";
import { sourceRecordBigintSql, canonicalSocialSignalBigintSql } from "./source-record";

after(() => pool.end());

test("source-record joins accept the full positive bigint range and reject malformed or overflowing IDs", async () => {
  const values = [null, "", "not-a-number", "-1", "1.5", "1", "999999999999999999", "9223372036854775807", "9223372036854775808", "99999999999999999999999999999999999999"];
  const { rows } = await pool.query(`SELECT evidence.source_record_id,${sourceRecordBigintSql("evidence", "item")} AS parsed,
    ${canonicalSocialSignalBigintSql("event")} AS canonical
    FROM unnest($1::text[]) WITH ORDINALITY evidence_input(source_record_id,position)
    CROSS JOIN LATERAL (SELECT evidence_input.source_record_id,'item'::text AS source_record_type) evidence
    CROSS JOIN LATERAL (SELECT jsonb_build_object('canonical_evidence_key','social:social_signal:'||evidence_input.source_record_id) AS metadata) event
    ORDER BY evidence_input.position`, [values]);
  assert.deepEqual(rows.map((row) => row.parsed), [null, null, null, null, null, "1", "999999999999999999", "9223372036854775807", null, null]);
  assert.deepEqual(rows.map((row) => row.canonical), rows.map((row) => row.parsed));
});

test("event feed and detail retain valid evidence when other source IDs overflow", async (t) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  // Route the reader's parallel metadata queries through this rollback-only
  // fixture transaction without returning its connection to the shared pool.
  const connection = { query: client.query.bind(client), release() {} };
  t.mock.method(pool, "connect", async () => connection as never);
  try {
    const id = randomUUID();
    const hiddenId = randomUUID();
    const eventType = `safe_id_fixture_${id}`;
    const source = await client.query<{ id: string }>("INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id", [`safe-id-${id}`]);
    const sourceId = source.rows[0].id;
    const itemId = "9223372036854775807";
    await client.query(`INSERT INTO item(id,source_id,kind,title,url,event_time,payload)
      VALUES($1::bigint,$2,'news_article','Maximum valid source ID','https://example.org/story',now(),'{}')`, [itemId, sourceId]);
    for (const [eventId, canonicalKey] of [[id, `news:item:${itemId}`], [hiddenId, "social:social_signal:9223372036854775808"]]) {
      await client.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time,metadata)
        VALUES($1::uuid,$1::text,$2,'Source ID fixture','Reader must tolerate malformed evidence IDs',now(),now(),
          jsonb_build_object('origin_domain','news','canonical_evidence_key',$3::text))`, [eventId, eventType, canonicalKey]);
    }
    for (const [recordType, recordId] of [["item", itemId], ["item", "9223372036854775808"], ["item", "not-a-number"], ["global_event", "999999999999999999999999999999"]]) {
      await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,source_id,observed_at,confidence,relationship,provenance)
        VALUES($1,'news','publisher_report',$2,$3,$4,now(),0.6,'reported','{}')`, [id, recordType, recordId, sourceId]);
    }
    await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,source_id,observed_at,confidence,relationship,provenance)
      VALUES($1,'news','publisher_report','item',$2,$3,now(),0.6,'reported','{}')`, [hiddenId, itemId, sourceId]);
    const feed = await listIntelligenceEvents({ eventType, limit: 100 });
    assert.deepEqual(feed.map((event) => event.id), [id]);
    assert.equal(feed[0].evidence_count, 4);
    const detail = await getIntelligenceEvent(id);
    assert.ok(detail);
    assert.equal(detail.event.evidence_count, 4);
    assert.equal(detail.evidence.length, 4);
    assert.equal(detail.evidence.find((evidence) => evidence.source_record_id === itemId)?.source_title, "Maximum valid source ID");
    assert.equal(await getIntelligenceEvent(hiddenId), null);
  } finally {
    t.mock.restoreAll();
    await client.query("ROLLBACK");
    client.release();
  }
});
