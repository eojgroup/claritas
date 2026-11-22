import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool, query } from "../db";
import { getIntelligenceEvent, upsertIntelligenceSignal } from "./service";
after(() => pool.end());

test("event reading includes bounded timestamped excerpts only from the attached podcast signal", async () => {
  const suffix = randomUUID(), now = new Date(), key = `source-reader-${suffix}`;
  const source = (await query(`INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id`, [key])).rows[0].id;
  let eventId: string | undefined;
  try {
    const item = (await query(`INSERT INTO item(source_id,kind,title,url,event_time) VALUES($1,'podcast_episode','Episode','https://example.org/episode',now()) RETURNING id`, [source])).rows[0].id;
    const feed = (await query(`INSERT INTO podcast_feed(source_id,podcast_index_id,title,feed_url) VALUES($1,$2,'Publisher','https://example.org/feed') RETURNING id`, [source, item])).rows[0].id;
    const episode = (await query(`INSERT INTO podcast_episode(item_id,feed_id,podcast_index_id,transcript_status) VALUES($1,$2,$1,'available') RETURNING id`, [item, feed])).rows[0].id;
    const signal = (await query(`INSERT INTO intelligence_signal(episode_id,signal_type,title,summary,canonical_key,extraction_method)
      VALUES($1,'claim','Attributed claim','Transcript interpretation','attached','transcript') RETURNING id`, [episode])).rows[0].id;
    const other = (await query(`INSERT INTO intelligence_signal(episode_id,signal_type,title,canonical_key,extraction_method)
      VALUES($1,'claim','Different claim','unrelated','transcript') RETURNING id`, [episode])).rows[0].id;
    for (let n = 1; n <= 6; n++) {
      const segment = (await query(`INSERT INTO evidence_segment(episode_id,segment_index,start_ms,text,timing_method)
        VALUES($1,$2,$2::int*60000,$3,'source') RETURNING id`, [episode, n, `Source quote ${n}`])).rows[0].id;
      await query(`INSERT INTO intelligence_signal_evidence(signal_id,evidence_segment_id) VALUES($1,$2)`, [n <= 5 ? signal : other, segment]);
    }
    const input = { dedupeKey: key, eventType: "reported_development", title: "Reported policy update", summary: "Attributed reporting",
      startTime: now, lastActivityTime: now, confidence: .7, relevanceScore: .6, urgencyScore: .3, materialityScore: .3,
      severity: "medium" as const, scoreComponents: {}, metadata: { origin_domain: "news" },
      evidence: { domain: "news" as const, evidenceType: "fixture", sourceRecordType: "fixture", sourceRecordId: key,
        observedAt: now, confidence: .7, relationship: "reported" as const, provenance: {} } };
    const event = await upsertIntelligenceSignal(input); eventId = event.id;
    await upsertIntelligenceSignal({ ...input, metadata: { origin_domain: "podcast" }, evidence: { ...input.evidence,
      domain: "podcast", sourceRecordType: "intelligence_signal", sourceRecordId: `podcast:${episode}:claim:attached`,
      sourceId: Number(source), relationship: "model_interpretation" } });
    const detail = await getIntelligenceEvent(event.id);
    const evidence = detail?.evidence.find((row: any) => row.domain === "podcast");
    assert.equal(evidence?.source_title, "Attributed claim");
    assert.equal(evidence?.source_url, "https://example.org/episode");
    assert.deepEqual(evidence?.transcript_excerpts.map((row: any) => row.quote), ["Source quote 1", "Source quote 2", "Source quote 3"]);
    assert.equal(evidence?.transcript_excerpts[0].start_ms, 60000);
    assert.equal(evidence?.transcript_excerpts[0].timing_method, "source");
    assert.equal(detail?.context_included, false, "attached sources are readable without a regional-context request");
  } finally {
    if (eventId) await query(`DELETE FROM intelligence_event WHERE id=$1`, [eventId]);
    await query(`DELETE FROM source WHERE id=$1`, [source]);
  }
});
