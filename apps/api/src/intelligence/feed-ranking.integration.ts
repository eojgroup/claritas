import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { listIntelligenceEvents } from "./service";
after(() => pool.end());

test("feed evidence keeps quality, assessment freshness, shared stories, social expiry and critical diversity ranking", async (t) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  const connection = { query: (...args: any[]) => (client.query as any)(...args), release() {} };
  t.mock.method(pool, "connect", async () => connection as never);
  try {
    const sourceId = (await client.query("INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id", [`feed-ranking-${randomUUID()}`])).rows[0].id;
    let gdeltId = (await client.query("SELECT id FROM source WHERE lower(name)='gdelt' LIMIT 1")).rows[0]?.id;
    if (!gdeltId) gdeltId = (await client.query("INSERT INTO source(name,api_base_url) VALUES('gdelt','https://api.gdeltproject.org') RETURNING id")).rows[0].id;
    const article = async (quality: string, score: number, stale = false) => {
      const id = (await client.query(`INSERT INTO item(source_id,kind,title,url,event_time,payload)
        VALUES($1,'news_article','Feed ranking fixture','https://example.org/story',now(),jsonb_build_object('quality_status',$2::text)) RETURNING id`, [gdeltId, quality])).rows[0].id;
      await client.query(`INSERT INTO news_item_assessment(item_id,methodology_version,primary_category,categories,tags,reasons,components,score,tier,confidence,assessed_at,inputs_hash)
        VALUES($1,'fixture','geopolitics','[]','[]','[]','{}',$2,'high',0.8,now()+make_interval(secs=>$3::int),repeat('a',64))`, [id, score, stale ? -60 : 60]);
      return String(id);
    };
    const accepted = await article("accepted", 90);
    const rejected = await article("rejected", 100);
    const stale = await article("accepted", 100, true);
    const eventType = `security_feed_fixture_${randomUUID()}`;
    const addEvent = async (name: string, relevance: number, origin = "news", severity = "medium", ageMinutes = 30, key = `news:item:${accepted}`) => {
      const id = randomUUID();
      await client.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,severity,relevance_score,urgency_score,materiality_score,
        start_time,last_activity_time,metadata)
        VALUES($1::uuid,$1::text,$2,$3,'Reader ranking fixture',$4,$5,0.1,0.1,now()-make_interval(mins=>$6::int),now()-make_interval(mins=>$6::int),
          jsonb_build_object('origin_domain',$7::text,'canonical_evidence_key',$8::text))`, [id, eventType, name, severity, relevance, ageMinutes, origin, key]);
      return id;
    };
    const addEvidence = async (eventId: string, domain: string, type: string, recordId: string, source: string | number = sourceId) => {
      await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,source_id,
        observed_at,confidence,relationship,provenance) VALUES($1,$2,'fixture',$3,$4,$5,now(),0.7,'reported','{}')`, [eventId, domain, type, recordId, source]);
    };
    const first = await addEvent("Assessed shared story", .1);
    await addEvidence(first, "news", "item", accepted, gdeltId);
    const blocked = await addEvent("Rejected publisher only", .99, "news", "critical", 30, `news:item:${rejected}`);
    await addEvidence(blocked, "news", "item", rejected, gdeltId);
    const independent = await addEvent("Independent weather survives rejected reporting", .6, "weather");
    await addEvidence(independent, "news", "item", rejected, gdeltId);
    await addEvidence(independent, "weather", "weather_snapshot", "fixture-weather");
    const critical = await addEvent("Critical shared story", .2, "news", "critical", 60);
    await addEvidence(critical, "news", "item", accepted, gdeltId);
    const staleAssessment = await addEvent("Stale assessment is excluded", .9, "news", "medium", 15, `news:item:${stale}`);
    await addEvidence(staleAssessment, "news", "item", stale, gdeltId);
    const expiredOrigin = await addEvent("Expired social origin", .99, "social", "critical", 30, "social:social_signal:9223372036854775807");
    await addEvidence(expiredOrigin, "weather", "weather_snapshot", "fixture-retained-weather");
    const expiredEvidence = await addEvent("Only expired social evidence", .99, "social");
    await addEvidence(expiredEvidence, "social", "social_signal", "9223372036854775807");
    const empty = await addEvent("No source evidence", .99);
    const malformed = await addEvent("Legacy non-GDELT missing item", .15, "weather");
    await addEvidence(malformed, "news", "item", "9223372036854775808");
    const contextual = await addEvent("Non-item contextual source", .1, "assessment");
    await addEvidence(contextual, "assessment", "fixture_context", "context");
    const feed = await listIntelligenceEvents({ eventType, limit: 100 });
    assert.deepEqual(feed.map((event) => event.id), [staleAssessment, critical, first, independent, contextual, malformed]);
    assert.equal(feed.find((event) => event.id === first)?.news_priority, .9);
    assert.equal(feed.find((event) => event.id === critical)?.news_priority, .9);
    assert.equal(feed.find((event) => event.id === staleAssessment)?.news_priority, 0);
    assert.equal(feed.find((event) => event.id === independent)?.news_priority, 0);
    assert.equal(feed.find((event) => event.id === independent)?.evidence_count, 1);
    assert.ok(Math.abs(feed.find((event) => event.id === critical)!.priority_score - (.55 * .9 + .2 * .1 + .15 * .1 + .1 * (1 - 1 / 72))) < .000001);
    for (const hidden of [blocked, expiredOrigin, expiredEvidence, empty]) assert.equal(feed.some((event) => event.id === hidden), false);
    assert.deepEqual((await listIntelligenceEvents({ eventType, limit: 2, offset: 1 })).map((event) => event.id), [critical, first]);
    await client.query(`INSERT INTO intelligence_feed_snapshot(singleton,schema_version,generated_at,events)
      VALUES(true,1,now(),$1::jsonb) ON CONFLICT(singleton) DO UPDATE SET schema_version=1,generated_at=now(),events=EXCLUDED.events`, [JSON.stringify(feed)]);
    const statements: string[] = [];
    const originalQuery = client.query.bind(client);
    t.mock.method(client, "query", ((text: any, ...args: any[]) => {
      statements.push(typeof text === "string" ? text : text.text);
      return (originalQuery as any)(text, ...args);
    }) as any);
    assert.deepEqual((await listIntelligenceEvents({ limit: 100 })).map(event => event.id), feed.map(event => event.id));
    assert.ok(statements.some(sql => sql.includes("FROM intelligence_feed_snapshot")));
    assert.ok(!statements.some(sql => sql.includes("WITH eligible AS")), "a prepared global page must not rerank the full live history");
    await client.query("UPDATE item SET payload=jsonb_build_object('quality_status','rejected') WHERE id=$1", [accepted]);
    assert.deepEqual((await listIntelligenceEvents({ limit: 100 })).map(event => event.id), [staleAssessment, independent, contextual, malformed],
      "publisher rejection is enforced immediately, before the next background refresh");
    await client.query("UPDATE intelligence_event SET end_time=now()-interval '1 second' WHERE id=$1", [contextual]);
    await client.query("DELETE FROM intelligence_event_evidence WHERE event_id=$1 AND domain='weather'", [independent]);
    assert.deepEqual((await listIntelligenceEvents({ limit: 100 })).map(event => event.id), [staleAssessment, malformed],
      "expiry and removed independent evidence are enforced on the saved page");
  } finally {
    t.mock.restoreAll();
    await client.query("ROLLBACK");
    client.release();
  }
});
