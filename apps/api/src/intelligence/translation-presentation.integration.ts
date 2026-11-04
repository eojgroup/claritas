import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { getIntelligenceOverview } from "./overview";
import { getIntelligenceEvent, listIntelligenceEvents } from "./service";
import { loadTranslationContext, translateEventPresentation } from "./translation-presentation";
after(() => pool.end());

test("overview, feed and detail reuse source-valid cached translations, preserve originals and expose unavailable states without model calls", async (t) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  let failMetadata = false;
  const connection = { async query(sql: any, params?: any[]) {
    if (failMetadata && typeof sql === "string" && sql.includes("WITH requested AS")) throw new Error("Simulated metadata failure");
    return client.query(sql, params);
  }, release() {} };
  t.mock.method(pool, "connect", async () => connection as never);
  let modelRequests = 0;
  t.mock.method(globalThis, "fetch", async () => { modelRequests++; throw new Error("Reader must not call a model or provider"); });
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousEnabled = process.env.NEWS_TRANSLATION_ENABLED;
  process.env.OPENROUTER_API_KEY = "synthetic-test-key";
  process.env.NEWS_TRANSLATION_ENABLED = "true";
  try {
    await client.query(`INSERT INTO news_translation_dispatch(target_language_code,next_attempt_at,last_status,last_reason)
      VALUES('en',now()+interval '1 hour','quota_limited','Shared free allowance reached')
      ON CONFLICT(target_language_code) DO UPDATE SET next_attempt_at=EXCLUDED.next_attempt_at,last_status=EXCLUDED.last_status,last_reason=EXCLUDED.last_reason`);
    const sourceId = (await client.query("INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id", [`translation-${randomUUID()}`])).rows[0].id;
    const fixtures = [
      { language: "es", original: "El puerto cierra por la tormenta", title: "Port closes because of storm", summary: "Las autoridades anunciaron el cierre.", translatedSummary: null },
      { language: "ar", original: "إغلاق الميناء بسبب العاصفة", title: "Port shut because of severe storm", summary: "أعلنت السلطات إغلاق الميناء.", translatedSummary: "Authorities announced the port closure." },
      { language: "he", original: "הנמל נסגר בגלל הסערה", title: null, summary: "הרשויות הודיעו על סגירת הנמל.", translatedSummary: null },
    ];
    const created: Array<{ id: string; itemId: string; original: string; title: string | null; language: string }> = [];
    const eventType = `security_translation_fixture_${randomUUID()}`;
    for (const [index, fixture] of fixtures.entries()) {
      const itemId = String((await client.query(`INSERT INTO item(source_id,kind,title,summary,url,language_code,event_time,payload)
        VALUES($1,'news_article',$2,$3,$4,$5,now()-make_interval(mins=>$6::int),'{}') RETURNING id`,
        [sourceId, fixture.original, fixture.summary, `https://example.org/${randomUUID()}`, fixture.language, index + 1])).rows[0].id);
      const id = randomUUID();
      await client.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time,
        primary_country_iso2,severity,relevance_score,metadata)
        VALUES($1::uuid,$1::text,$2,$3,$4,now()-make_interval(mins=>$5::int),now()-make_interval(mins=>$5::int),
          'SE','high',0.8,jsonb_build_object('origin_domain','news','canonical_evidence_key','news:item:'||$6::text))`,
        [id, eventType, fixture.original, fixture.summary, index + 1, itemId]);
      await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,
        source_id,observed_at,confidence,relationship,provenance)
        VALUES($1,'news','publisher_report','item',$2,$3,now(),0.7,'reported','{}')`, [id, itemId, sourceId]);
      if (fixture.title) await client.query(`INSERT INTO item_translation(item_id,target_language_code,translated_title,generated_summary,summary_status,
          source_title_hash,source_summary_hash,provider,model,generation_metadata,summary_generated_at)
          SELECT id,'en',$2,$3,CASE WHEN $3::text IS NULL THEN 'not_requested' ELSE 'generated' END,md5(title),md5(summary),
            'openrouter','free-fixture-model',jsonb_build_object('source_language_code',language_code),
            CASE WHEN $3::text IS NULL THEN NULL ELSE now() END FROM item WHERE id=$1`, [itemId, fixture.title, fixture.translatedSummary]);
      created.push({ id, itemId, ...fixture });
    }
    const [spanish, arabic, hebrew] = created;
    await client.query(`INSERT INTO item_translation(item_id,target_language_code,translated_title,summary_status,
      source_title_hash,source_summary_hash,provider,model,generation_metadata)
      SELECT id,'fr','Le port ferme à cause de la tempête','not_requested',md5(title),md5(summary),
        'openrouter','free-fixture-model',jsonb_build_object('source_language_code',language_code) FROM item WHERE id=$1`, [hebrew.itemId]);
    await client.query(`INSERT INTO intelligence_event_relationship(from_event_id,to_event_id,relationship,confidence,rationale)
      VALUES($1,$2,'related',0.7,'Same named port')`, [spanish.id, arabic.id]);
    const overview = await getIntelligenceOverview({ country: "SE", topic: "security", displayLanguage: "en" });
    const spanishTimeline = overview.timeline.find((entry) => entry.event_id === spanish.id)!;
    assert.equal(spanishTimeline.title, spanish.title);
    assert.equal(spanishTimeline.original_title, spanish.original);
    assert.equal(spanishTimeline.translation?.provider, "openrouter");
    assert.equal(spanishTimeline.source_refs[0].label, spanish.title);
    assert.equal(spanishTimeline.source_refs[0].original_title, spanish.original);
    const hebrewTimeline = overview.timeline.find((entry) => entry.event_id === hebrew.id)!;
    assert.equal(hebrewTimeline.title, hebrew.original);
    assert.equal(hebrewTimeline.translation_status, "pending");
    assert.equal(hebrewTimeline.translation_availability?.status, "quota_limited");
    const french = await getIntelligenceOverview({ country: "SE", topic: "security", displayLanguage: "fr" });
    assert.equal(french.timeline.find((entry) => entry.event_id === hebrew.id)?.title, "Le port ferme à cause de la tempête");
    assert.equal((await getIntelligenceOverview({ country: "SE", topic: "security", displayLanguage: "en" })).timeline.find((entry) => entry.event_id === hebrew.id)?.title, hebrew.original);
    const feed = await listIntelligenceEvents({ eventType, limit: 20 });
    assert.equal(feed.find((event) => event.id === spanish.id)?.title, spanish.title);
    const detail = await getIntelligenceEvent(spanish.id);
    assert.ok(detail);
    assert.equal(detail.event.title, spanish.title);
    assert.equal(detail.event.summary_translation_status, "pending");
    assert.equal(detail.evidence[0].source_title, spanish.title);
    assert.equal(detail.linked_news[0].original_title, spanish.original);
    assert.equal(detail.related_events[0].title, arabic.title);
    const arabicDetail = await getIntelligenceEvent(arabic.id);
    assert.equal(arabicDetail?.event.summary, "Authorities announced the port closure.");
    assert.equal(arabicDetail?.understanding.what_happened, "Authorities announced the port closure.");
    await client.query("UPDATE item_translation SET source_title_hash=md5('stale') WHERE item_id=$1 AND target_language_code='en'", [spanish.itemId]);
    const stale = await getIntelligenceEvent(spanish.id);
    assert.equal(stale?.event.title, spanish.original);
    assert.equal(stale?.event.translated_title, null);
    assert.equal(stale?.evidence[0].source_title, spanish.original);
    await client.query("UPDATE item_translation SET source_summary_hash=md5('stale summary') WHERE item_id=$1 AND target_language_code='en'", [arabic.itemId]);
    assert.equal((await getIntelligenceEvent(arabic.id))?.event.title, arabic.original);
    await client.query("UPDATE item_translation translation SET source_summary_hash=md5(item.summary) FROM item WHERE item.id=translation.item_id AND item.id=$1", [arabic.itemId]);
    await client.query("UPDATE item_translation SET generation_metadata='{\"source_language_code\":\"es\"}' WHERE item_id=$1 AND target_language_code='en'", [arabic.itemId]);
    assert.equal((await getIntelligenceEvent(arabic.id))?.event.title, arabic.original);
    failMetadata = true;
    const unavailable = await loadTranslationContext([spanish.id], [], "en");
    const fallback = translateEventPresentation({ id: spanish.id, title: spanish.original }, unavailable);
    assert.equal(fallback.title, spanish.original);
    assert.equal(fallback.translation_status, "unavailable");
    const baseFeed = await listIntelligenceEvents({ eventType, displayLanguage: "de" });
    assert.ok(baseFeed.some((event) => event.id === spanish.id && event.title === spanish.original));
    const baseDetail = await getIntelligenceEvent(spanish.id);
    assert.equal(baseDetail?.event.title, spanish.original);
    assert.equal(baseDetail?.event.translation_status, "unavailable");
    const baseOverview = await getIntelligenceOverview({ country: "SE", topic: "security", displayLanguage: "de" });
    assert.equal(baseOverview.events.find((event) => event.id === spanish.id)?.title, spanish.original);
    assert.equal(baseOverview.timeline.find((event) => event.event_id === spanish.id)?.translation_status, "unavailable");
    assert.equal(modelRequests, 0);
  } finally {
    t.mock.restoreAll();
    if (previousKey == null) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousEnabled == null) delete process.env.NEWS_TRANSLATION_ENABLED; else process.env.NEWS_TRANSLATION_ENABLED = previousEnabled;
    await client.query("ROLLBACK");
    client.release();
  }
});
