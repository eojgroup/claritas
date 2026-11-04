import assert from "node:assert/strict";
import test, { after } from "node:test";
import { pool } from "../db";
import { buildNewsTranslationCandidateQuery } from "../news-translation";

after(() => pool.end());

test("current canonical headlines lead high-volume reporting while analyst and archived heads retain their general tier", async (t) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    // Use the migrated column types in an isolated transaction. Temporary
    // tables keep ordering independent of pre-existing or concurrent fixtures.
    for (const table of ["source", "item", "intelligence_event", "intelligence_event_feed", "item_translation", "news_translation_retry"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
    }
    const sourceId = (await client.query("INSERT INTO source(name,api_base_url) VALUES('translation-fixture','https://example.org') RETURNING id")).rows[0].id;
    const insert = async (title: string, language: string, minutesAgo: number) => (await client.query(`
      INSERT INTO item(source_id,kind,title,language_code,event_time,payload)
      VALUES($1,'news_article',$2,$3,now()-make_interval(mins=>$4),'{}') RETURNING id`,
    [sourceId, title, language, minutesAgo])).rows[0].id as string;
    const visible = await insert("דיווח מקומי חדש", "he", 60);
    const spanish = await insert("Informe visible nuevo", "es", 120);
    const custom = await insert("דיווח אחר", "he", 30);
    const archived = await insert("Informe archivado", "es", 20);
    await client.query(`INSERT INTO item(source_id,kind,title,language_code,event_time,payload)
      SELECT $1,'news_article','أخبار كثيرة '||n,'ar',now()-n*interval '1 second','{}'::jsonb
      FROM generate_series(1,40) n`, [sourceId]);
    const event = async (id: string, title: string, status = "active") => client.query(`
      INSERT INTO intelligence_event(dedupe_key,event_type,title,summary,status,start_time,last_activity_time,metadata)
      VALUES('fixture-'||$1,'security',$2,'Fixture',$3,now(),now(),
        jsonb_build_object('canonical_evidence_key','news:item:'||$1))`, [id, title, status]);
    await event(visible, "דיווח מקומי חדש");
    await event(spanish, "Informe visible nuevo");
    await event(custom, "Analyst heading must remain intact");
    await event(archived, "Informe archivado", "resolved");
    // The production synchronization trigger is not copied to the temporary
    // canonical table; populate its narrow projection using the same fields.
    await client.query(`INSERT INTO intelligence_event_feed
      SELECT id,event_type,status,severity,source_diversity,domain_count,relevance_score,urgency_score,
        materiality_score,last_activity_time,end_time,primary_country_iso2,primary_location_id,metadata
      FROM intelligence_event`);
    const statement = buildNewsTranslationCandidateQuery("en", 25);
    const rows = (await client.query(statement.sql, statement.params)).rows;
    assert.deepEqual(rows.slice(0, 2).map((row) => row.id), [visible, spanish]);
    assert.equal(rows.length, 25);
    assert.ok(rows.slice(2).some((row) => row.id === custom));
    assert.ok(rows.slice(2).some((row) => row.id === archived));
    const plan = (await client.query(`EXPLAIN (ANALYZE,FORMAT JSON) ${statement.sql}`, statement.params)).rows[0]["QUERY PLAN"][0];
    t.diagnostic(`Bounded translation-priority fixture: ${plan["Execution Time"]} ms`);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
