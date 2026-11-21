import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool, query } from "../db";
import type { PoolClient } from "pg";
import {
  assessPendingNewsItems,
  expandNewsAssessmentEvents,
  seedNewsAssessmentQueue,
} from "../news-assessment-worker";
import { NEWS_ASSESSMENT_METHODOLOGY } from "../news-intelligence";
import { currentNewsAssessmentSql } from "../news-country-attribution";

async function assessmentIsCurrent(itemId: string) {
  return (await query<{ current: boolean }>(`SELECT (${currentNewsAssessmentSql("item", "assessment")}) AS current
    FROM item JOIN news_item_assessment assessment ON assessment.item_id=item.id
    WHERE item.id=$1`, [itemId])).rows[0]?.current ?? false;
}

async function fixture<T>(run: (sourceId: string, addItem: (age?: string, kind?: string) => Promise<string>) => Promise<T>) {
  const suffix = randomUUID();
  const { rows: [source] } = await query<{ id: string }>(
    `INSERT INTO source(name,api_base_url) VALUES($1,'https://assessment.example') RETURNING id`, [`assessment-queue-${suffix}`]);
  const events: string[] = [];
  try {
    return await run(source.id, async (age = "10 minutes", kind = "news_article") => {
      const { rows: [item] } = await query<{ id: string }>(
        `INSERT INTO item(source_id,external_id,kind,title,url,event_time,payload)
         VALUES($1,$2,$3,'Central bank raises policy rate',$4,now()-$5::interval,
           '{"time_basis":"publisher_published_verified"}'::jsonb) RETURNING id`,
        [source.id, randomUUID(), kind, `https://assessment.example/${randomUUID()}`, age]);
      return item.id;
    });
  } finally {
    const linked = await query<{ event_id: string }>(
      `SELECT DISTINCT event_id FROM intelligence_event_evidence
       WHERE source_id=$1 AND event_id IN(SELECT id FROM intelligence_event WHERE dedupe_key LIKE 'assessment-queue-%')`, [source.id]);
    events.push(...linked.rows.map((row) => row.event_id));
    if (events.length) await query(`DELETE FROM intelligence_event WHERE id=ANY($1::uuid[])`, [events]);
    await query(`DELETE FROM source WHERE id=$1`, [source.id]);
  }
}

async function addEvent(itemId: string, sourceId: string) {
  const id = randomUUID();
  await query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time)
    VALUES($1,$2,'policy_development','Policy decision','Policy decision',now(),now())`, [id, `assessment-queue-${id}`]);
  await query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,
    source_id,observed_at,confidence,relationship,provenance)
    VALUES($1,'news','reported_event','item',$2,$3,now(),.8,'reported','{}')`, [id, itemId, sourceId]);
  return id;
}

test("assessment queue reacts to actual inputs and schedules recent news while retiring old history", async () => {
  await fixture(async (_source, addItem) => {
    const recent = await addItem();
    const old = await addItem("10 days");
    const ignored = await addItem("10 minutes", "non_news_fixture");
    assert.equal((await query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [ignored])).rows[0].count, 0);
    await assessPendingNewsItems(200);
    const recentQueue = await query(`SELECT due_at>now() AS scheduled,revision FROM news_assessment_queue WHERE item_id=$1`, [recent]);
    assert.equal(recentQueue.rows[0]?.scheduled, true);
    assert.equal((await query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [old])).rows[0].count, 0);
    const revision = recentQueue.rows[0].revision;
    await query(`UPDATE item SET updated_at=now() WHERE id=$1`, [recent]);
    assert.ok(BigInt((await query(`SELECT revision FROM news_assessment_queue WHERE item_id=$1`, [recent])).rows[0].revision) > BigInt(revision),
      "reader freshness gates also require reassessment after timestamp-only provider rediscovery");
    await query(`UPDATE item SET updated_at=now() WHERE id=$1`, [old]);
    assert.equal((await query(`SELECT due_at<=now() AS due FROM news_assessment_queue WHERE item_id=$1`, [old])).rows[0].due, true,
      "archived items without a future age boundary still recover their reader assessment after rediscovery");
    await query(`UPDATE item SET title='Earthquake strikes a major city' WHERE id=$1`, [recent]);
    const invalidated = (await query(`SELECT revision,due_at<=now() AS due FROM news_assessment_queue WHERE item_id=$1`, [recent])).rows[0];
    assert.ok(BigInt(invalidated.revision) > BigInt(revision));
    assert.equal(invalidated.due, true);
    await assessPendingNewsItems(200);
    assert.equal((await query(`SELECT primary_category FROM news_item_assessment WHERE item_id=$1`, [recent])).rows[0].primary_category, "climate_disasters");
  });
});

test("event and evidence changes invalidate news without fanning out inside event writers", async () => {
  await fixture(async (source, addItem) => {
    const item = await addItem();
    const event = await addEvent(item, source);
    assert.equal((await query(`SELECT count(*)::int AS count FROM news_assessment_event_queue WHERE event_id=$1`, [event])).rows[0].count, 1);
    await assessPendingNewsItems(200);
    assert.equal(await assessmentIsCurrent(item), true);
    const prior = (await query(`SELECT revision FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].revision;
    await query(`UPDATE intelligence_event SET metadata='{"display":"only"}'::jsonb,updated_at=now() WHERE id=$1`, [event]);
    assert.equal((await query(`SELECT count(*)::int AS count FROM news_assessment_event_queue WHERE event_id=$1`, [event])).rows[0].count, 0);
    assert.equal(await assessmentIsCurrent(item), true, "display-only timestamp updates must keep valid reporting visible");
    await query(`UPDATE intelligence_event SET severity='critical' WHERE id=$1`, [event]);
    assert.equal(await assessmentIsCurrent(item), false, "actual event changes remain hidden until assessed");
    assert.equal((await query(`SELECT revision FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].revision, prior);
    await expandNewsAssessmentEvents();
    assert.equal(await assessmentIsCurrent(item), false, "fan-out must not acknowledge an assessment before persistence");
    assert.ok(BigInt((await query(`SELECT revision FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].revision) > BigInt(prior));
    await assessPendingNewsItems(200);
    assert.equal(await assessmentIsCurrent(item), true);
    await query(`DELETE FROM intelligence_event_evidence WHERE event_id=$1`, [event]);
    assert.equal(await assessmentIsCurrent(item), false, "removed evidence invalidates the item even when no linked event remains");
    assert.equal((await query(`SELECT due_at<=now() AS due FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].due, true);
    await query(`DELETE FROM intelligence_event WHERE id=$1`, [event]);
    const cascade = await addEvent(item, source);
    await assessPendingNewsItems(200);
    await query(`DELETE FROM intelligence_event WHERE id=$1`, [cascade]);
    assert.equal((await query(`SELECT due_at<=now() AS due FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].due, true,
      "cascaded evidence deletion retains the removed news source for reassessment");
  });
});

test("GDELT admission and malformed evidence IDs stay safe in queue triggers", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO source(name,api_base_url) VALUES('gdelt','https://gdelt.example') ON CONFLICT(name) DO NOTHING`);
    const { rows: [source] } = await client.query<{ id: string }>(`SELECT id FROM source WHERE name='gdelt'`);
    const { rows: [item] } = await client.query<{ id: string }>(`INSERT INTO item(source_id,kind,title,event_time,payload)
      VALUES($1,'news_article','Rejected aggregation',now(),'{"quality_status":"rejected"}') RETURNING id`, [source.id]);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [item.id])).rows[0].count, 0);
    await client.query(`UPDATE item SET payload='{"quality_status":"accepted"}' WHERE id=$1`, [item.id]);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [item.id])).rows[0].count, 1);
    await client.query(`UPDATE item SET payload='{"quality_status":"rejected"}' WHERE id=$1`, [item.id]);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [item.id])).rows[0].count, 0);
    const parsed = await client.query<{ id: string | null }>(`SELECT news_assessment_item_id(value)::text AS id
      FROM unnest(ARRAY['1','9223372036854775807','9223372036854775808','01','invalid']) value`);
    assert.deepEqual(parsed.rows.map((row) => row.id), ["1", "9223372036854775807", null, null, null]);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("source deletion refreshes the remaining event reports and publisher diversity", async () => {
  await fixture(async (source, addItem) => {
    const item = await addItem();
    const event = await addEvent(item, source);
    const { rows: [secondarySource] } = await query<{ id: string }>(
      `INSERT INTO source(name,api_base_url) VALUES($1,'https://secondary.example') RETURNING id`, [`assessment-secondary-${randomUUID()}`]);
    try {
      const { rows: [secondary] } = await query<{ id: string }>(`INSERT INTO item(source_id,kind,title,url,event_time,payload)
        VALUES($1,'news_article','Another policy report','https://secondary.example/report',now(),'{"time_basis":"publisher_published_verified"}') RETURNING id`, [secondarySource.id]);
      await query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,
        source_id,observed_at,confidence,relationship,provenance)
        VALUES($1,'news','reported_event','item',$2,$3,now(),.8,'reported','{}')`, [event, secondary.id, secondarySource.id]);
      await assessPendingNewsItems(200);
      const prior = (await query(`SELECT inputs_hash FROM news_item_assessment WHERE item_id=$1`, [item])).rows[0].inputs_hash;
      await query(`DELETE FROM source WHERE id=$1`, [secondarySource.id]);
      await expandNewsAssessmentEvents();
      assert.equal((await query(`SELECT due_at<=now() AS due FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].due, true);
      await assessPendingNewsItems(200);
      assert.notEqual((await query(`SELECT inputs_hash FROM news_item_assessment WHERE item_id=$1`, [item])).rows[0].inputs_hash, prior);
    } finally { await query(`DELETE FROM source WHERE id=$1`, [secondarySource.id]); }
  });
});

test("an input update racing assessment persistence retains its new queue revision", async () => {
  await fixture(async (_source, addItem) => {
    const item = await addItem();
    let raced = false;
    const originalConnect = pool.connect;
    const connect = originalConnect.bind(pool) as () => Promise<PoolClient>;
    pool.connect = (async () => {
      const client = await connect();
      return {
        query: async (sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (!raced && sql.includes("statement_timestamp() AS assessment_watermark")
              && result.rows.some((row) => String(row.id) === String(item))) {
            raced = true;
            const writer = await connect();
            try { await writer.query(`UPDATE item SET title='Earthquake strikes a major city' WHERE id=$1`, [item]); }
            finally { writer.release(); }
          }
          return result;
        },
        release() { client.release(); },
      };
    }) as typeof pool.connect;
    try { await assessPendingNewsItems(200); }
    finally { pool.connect = originalConnect; }
    assert.equal(raced, true);
    assert.equal((await query(`SELECT due_at<=now() AS due FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].due, true);
    await assessPendingNewsItems(200);
    assert.equal((await query(`SELECT primary_category FROM news_item_assessment WHERE item_id=$1`, [item])).rows[0].primary_category, "climate_disasters");
    assert.equal((await query(`SELECT due_at>now() AS scheduled FROM news_assessment_queue WHERE item_id=$1`, [item])).rows[0].scheduled, true);
  });
});

test("methodology replays advance a bounded cursor even through ineligible item slices", async () => {
  await fixture(async (_source, addItem) => {
    const accepted = await addItem();
    const rejected1 = await addItem("10 minutes", "non_news_fixture");
    const rejected2 = await addItem("10 minutes", "non_news_fixture");
    await query(`DELETE FROM news_assessment_queue WHERE item_id=$1`, [accepted]);
    await query(`INSERT INTO news_assessment_queue_state(singleton,methodology_version,backfill_before_item_id)
      VALUES(true,'old-methodology',0) ON CONFLICT(singleton) DO UPDATE SET methodology_version='old-methodology',backfill_before_item_id=0`);
    await seedNewsAssessmentQueue(2);
    const state = (await query(`SELECT * FROM news_assessment_queue_state WHERE singleton`)).rows[0];
    assert.equal(state.methodology_version, NEWS_ASSESSMENT_METHODOLOGY);
    assert.equal(BigInt(state.backfill_before_item_id), BigInt(rejected1) - 1n);
    assert.ok(BigInt(rejected2) > BigInt(rejected1));
    assert.equal((await query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [accepted])).rows[0].count, 0);
    await seedNewsAssessmentQueue(2);
    assert.equal((await query(`SELECT count(*)::int AS count FROM news_assessment_queue WHERE item_id=$1`, [accepted])).rows[0].count, 1);
  });
});

test.after(async () => { await pool.end(); });
