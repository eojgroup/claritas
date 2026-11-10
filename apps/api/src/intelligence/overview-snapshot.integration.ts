import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { buildOverviewProjectionQuery } from "./overview";
import { normalizeOverviewOptions } from "./overview-model";
import { saveOverviewProjectionBatch, publishOverviewSnapshots, readIntelligenceOverviewSnapshot, applyOverviewDirtyBatch, purgeExpiredOverviewSocialLeads, type OverviewQuery } from "./overview-snapshot";
after(() => pool.end());

test("durable overview counts entire windows, scopes the same cohort, and keeps saved data through a failed refresh", async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  const read: OverviewQuery = async (sql, params) => ({ rows: (await client.query(sql, params)).rows });
  try {
    // Other integration fixtures may have committed ingestion events. Keep
    // this generation's dirty replay isolated inside the rollback-only test.
    await client.query("DELETE FROM intelligence_overview_dirty");
    const now = new Date();
    const fixture = randomUUID();
    const source = (await client.query("INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id", [`snapshot-${fixture}`])).rows[0].id;
    const item = (await client.query(`INSERT INTO item(source_id,kind,title,url,event_time,payload)
      VALUES($1,'news_article','Saved report','https://example.org/report',$2,'{"quality_status":"accepted"}') RETURNING id`, [source, now])).rows[0].id;
    const records = [...Array.from({ length: 301 }, () => ({ id: randomUUID(), age: 1, country: "SE", type: "security_incident", severity: "high", score: .8 })),
      { id: randomUUID(), age: 23, country: "SE", type: "security_incident", severity: "high", score: .8 },
      { id: randomUUID(), age: 47, country: "SE", type: "security_incident", severity: "high", score: .8 },
      { id: randomUUID(), age: 25, country: "SE", type: "security_incident", severity: "high", score: .8 },
      { id: randomUUID(), age: 3, country: "SE", type: "security_incident", severity: "low", score: .1 },
      { id: randomUUID(), age: 22, country: "SE", type: "aviation_disruption", severity: "high", score: .8 },
      { id: randomUUID(), age: 21, country: "NO", type: "aviation_disruption", severity: "high", score: .8 },
      ...[71, 143, 167, 169, 335].map((age) => ({ id: randomUUID(), age, country: "SE", type: "security_incident", severity: "high", score: .8 }))];
    await client.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time,primary_country_iso2,severity,relevance_score,urgency_score,materiality_score,status,metadata)
      SELECT id,id::text,type,'Saved event '||id,'Saved attributed context',$2::timestamptz-make_interval(secs=>age*3600),
        $2::timestamptz-make_interval(secs=>age*3600),country,severity,score,score,score,'active',jsonb_build_object('origin_domain','news','canonical_evidence_key',$3::text)
      FROM jsonb_to_recordset($1::jsonb) AS record(id uuid,age int,country text,type text,severity text,score double precision)`,
      [JSON.stringify(records), now, `news:item:${item}`]);
    await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,source_id,observed_at,confidence,relationship,provenance)
      SELECT id,'news','publisher_report','item',$2::text,$3,$4,0.7,'reported','{}' FROM unnest($1::uuid[]) id`, [records.map((row) => row.id), item, source, now]);
    const generation = randomUUID();
    const projection = buildOverviewProjectionQuery(now);
    const rows = (await client.query(projection.sql, projection.params)).rows.filter((row) => records.some((record) => record.id === row.id));
    assert.equal(rows.length, records.length);
    await saveOverviewProjectionBatch(rows, generation, read);
    // Replay an event that moved into the already-scanned part of the keyset.
    const moved = records.find((row) => row.age === 47)!;
    await client.query("UPDATE intelligence_event SET last_activity_time=$2 WHERE id=$1", [moved.id, new Date(now.getTime() - 22.5 * 3600_000)]);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM intelligence_overview_dirty WHERE id=ANY($1::uuid[])", [records.map((row) => row.id)])).rows[0].count, records.length);
    await applyOverviewDirtyBatch(generation, read, 500);
    const state = { generation_id: generation, generated_at: now };
    await publishOverviewSnapshots(state, read, false);
    const statements: string[] = [];
    const measured: OverviewQuery = async (sql, params) => { statements.push(sql); return read(sql, params); };
    const high = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), measured);
    assert.equal(high.summary.event_count, 305);
    assert.equal(high.summary.previous_event_count, 1);
    assert.equal(high.events.length, 40);
    assert.equal(high.timeline.length, 24);
    assert.equal(high.buckets[0].event_count, 2);
    assert.equal(high.buckets.at(-1)?.event_count, 301);
    assert.equal(high.buckets.reduce((sum, bucket) => sum + bucket.event_count, 0), 305);
    assert.equal(high.coverage.truncated, false);
    await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), measured);
    assert.equal(statements.length, 2);
    assert.ok(statements.every((sql) => !/intelligence_event(?:\s|_)|\bitem\b/.test(sql)), "Repeated global reads use only saved snapshot tables");
    const scoped = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions({ country: "SE", topic: "transport" }), measured);
    assert.equal(scoped.summary.event_count, 1);
    assert.equal(scoped.events.length, 1);
    assert.equal(scoped.events[0].event_type, "aviation_disruption");
    assert.equal(scoped.buckets.reduce((sum, bucket) => sum + bucket.event_count, 0), 1);
    const threeDays = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions({ hours: 72 }), measured);
    assert.equal(threeDays.summary.event_count, 307);
    assert.equal(threeDays.summary.previous_event_count, 1);
    assert.equal(threeDays.buckets[0].event_count, 1);
    const week = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions({ hours: 168 }), measured);
    assert.equal(week.summary.event_count, 309);
    assert.equal(week.summary.previous_event_count, 2);
    assert.ok(week.buckets[0].event_count > 0);
    assert.equal(week.buckets.reduce((sum, bucket) => sum + bucket.event_count, 0), 309);
    const all = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions({ priority: "all" }), measured);
    assert.equal(all.summary.event_count, 306);
    // An interrupted refresh rolls back both snapshot and state publication.
    await client.query("SAVEPOINT failed_refresh");
    await client.query("UPDATE intelligence_overview_snapshot SET payload='{}'::jsonb");
    await assert.rejects(client.query("SELECT 1/0"), /division by zero/);
    await client.query("ROLLBACK TO SAVEPOINT failed_refresh");
    await client.query("UPDATE intelligence_overview_state SET generated_at=$1", [new Date(now.getTime() - 600_000)]);
    const stale = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), measured);
    assert.equal(stale.snapshot.status, "stale");
    assert.equal(stale.summary.event_count, 305);
    assert.equal(stale.events.length, 40);
    // Quality changes and event deletion enqueue exact indexed source matches.
    await client.query("UPDATE item SET payload=jsonb_build_object('quality_status','rejected') WHERE id=$1", [item]);
    await applyOverviewDirtyBatch(generation, read, 500);
    await publishOverviewSnapshots(state, read, false);
    assert.equal((await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), measured)).summary.event_count, 0);
    // Publishing takes time while ingestion continues. New work after the
    // generation cutoff must not keep every completed generation stale.
    const cutoff = new Date();
    const olderPending = randomUUID();
    const newerPending = randomUUID();
    await client.query("INSERT INTO intelligence_overview_dirty(id,queued_at) VALUES($1,$2)", [olderPending, new Date(cutoff.getTime() - 1000)]);
    let enqueuedDuringPublish = false;
    const concurrent: OverviewQuery = async <T>(sql: string, params?: unknown[]) => {
      const result = await read<T>(sql, params);
      if (!enqueuedDuringPublish && sql.includes("INSERT INTO intelligence_overview_snapshot")) {
        enqueuedDuringPublish = true;
        await client.query("INSERT INTO intelligence_overview_dirty(id,queued_at) VALUES($1,$2)", [newerPending, new Date(cutoff.getTime() + 1000)]);
      }
      return result;
    };
    const nextState = { generation_id: generation, generated_at: cutoff };
    await publishOverviewSnapshots(nextState, concurrent, false);
    const backlog = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), measured);
    assert.equal(backlog.snapshot.pending_events, 1);
    assert.equal(backlog.snapshot.status, "stale");
    assert.equal(await applyOverviewDirtyBatch(generation, read, 500, cutoff), 1);
    await publishOverviewSnapshots(nextState, read, false);
    const caughtUp = await readIntelligenceOverviewSnapshot(normalizeOverviewOptions(), measured);
    assert.equal(caughtUp.snapshot.pending_events, 0);
    assert.equal(caughtUp.snapshot.status, "fresh");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM intelligence_overview_dirty WHERE id=$1", [newerPending])).rows[0].count, 1);
    const socialId = "9223372036854775806";
    await client.query(`INSERT INTO social_signal(id,source_id,external_id,platform,content_text,url,posted_at,author_account_id,
      responsible_party_name,responsible_party_account_id,expires_at)
      VALUES($1,$2,$3,'reddit','Retained claim fixture','https://example.org/claim',now(),'fixture','Fixture account','fixture',now()+interval '1 day')`, [socialId, source, fixture]);
    const socialRows = [socialId, "9223372036854775808", "not-a-number"].map((signalId) => ({ ...rows[0], id: randomUUID(),
      metadata: { origin_domain: "social", canonical_evidence_key: `social:social_signal:${signalId}` } }));
    await saveOverviewProjectionBatch(socialRows, generation, read);
    await purgeExpiredOverviewSocialLeads(generation, read);
    assert.deepEqual((await client.query("SELECT id FROM intelligence_overview_projection WHERE generation_id=$1 AND id=ANY($2::uuid[])",
      [generation, socialRows.map((row) => row.id)])).rows.map((row) => row.id), [socialRows[0].id]);
    await client.query("UPDATE social_signal SET expires_at=now()-interval '1 second' WHERE id=$1", [socialId]);
    await purgeExpiredOverviewSocialLeads(generation, read);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM intelligence_overview_projection WHERE generation_id=$1 AND id=$2", [generation, socialRows[0].id])).rows[0].count, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
