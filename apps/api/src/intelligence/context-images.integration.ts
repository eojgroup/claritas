import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { getEventContextImages, buildContextImageQuery } from "./context-images";
after(() => pool.end());

test("retained context reuses rendered coverage and same-place article previews without changing evidence", async (t) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const locationId = randomUUID();
    const targetId = randomUUID();
    const originalId = randomUUID();
    await client.query(`INSERT INTO intelligence_location(id,slug,location_type,canonical_name,latitude,longitude)
      VALUES($1,$2,'airport','Context Test Airport',26.5,56.2)`, [locationId, `context-${locationId}`]);
    for (const id of [targetId, originalId]) {
      await client.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time,primary_location_id)
        VALUES($1::uuid,$1::text,'aviation_disruption','Context fixture','Test event',now(),now(),$2)`, [id, locationId]);
    }
    const coveringId = randomUUID();
    const distantId = randomUUID();
    const expiredId = randomUUID();
    const ownId = randomUUID();
    for (const [id, bbox, eventId] of [
      [coveringId, [56.1, 26.4, 56.3, 26.6], originalId],
      [distantId, [57, 27, 57.2, 27.2], originalId],
      [expiredId, [56.1, 26.4, 56.3, 26.6], originalId],
      [ownId, [56.1, 26.4, 56.3, 26.6], targetId],
    ] as const) {
      const hash = createHash("sha256").update(id).digest("hex");
      const sceneId = randomUUID();
      await client.query(`INSERT INTO earth_scene(id,provider,mission,collection,provider_scene_id,capture_start,geometry,bbox,source_url,license,attribution,raw_metadata)
      VALUES($1::uuid,'fixture','Sentinel-2','sentinel-2-l2a',$1::text,now()-interval '2 days',ST_MakeEnvelope(55,25,58,28,4326),
        ARRAY[55,25,58,28]::double precision[],'https://example.org/scene','Open fixture','Fixture satellite','{}')`, [sceneId]);
      await client.query(`INSERT INTO earth_observation(id,scene_id,event_id,product_type,status,captured_at,methodology,attribution,license)
        VALUES($1,$2,$3,'true_color','available',now()-interval '2 days',$4::jsonb,'Fixture satellite','Open fixture')`,
        [id, sceneId, eventId, JSON.stringify({ render_context: { aoi_bbox: bbox } })]);
      await client.query(`INSERT INTO earth_observation_asset(observation_id,asset_type,mime_type,width,height,gcs_object,content_hash,size_bytes,expires_at)
        VALUES($1::uuid,'preview','image/jpeg',768,512,$1::text,$2,20,now()+make_interval(days=>$3))`, [id, hash, id === expiredId ? -1 : 2]);
    }
    const source = await client.query<{ id: number }>(`INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id`, [`context-${locationId}`]);
    const item = await client.query<{ id: number }>(`INSERT INTO item(source_id,kind,title,url,event_time,payload)
      VALUES($1,'news_article','Earlier reporting from the airport','https://example.org/news',now()-interval '1 day','{}') RETURNING id`, [source.rows[0].id]);
    await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,observed_at,confidence,relationship,provenance)
      VALUES($1,'news','publisher_report','item',$2,now(),0.6,'reported','{}')`, [originalId, `${item.rows[0].id}`]);
    const newsHash = createHash("sha256").update(randomUUID()).digest("hex");
    await client.query(`INSERT INTO news_image_asset(content_hash,preview,width,height) VALUES($1,$2,768,512)`, [newsHash, Buffer.from("fixture")]);
    const news = await client.query<{ id: string }>(`INSERT INTO news_article_image(item_id,content_hash,image_url,discovery,publisher,article_url)
      VALUES($1,$2,'https://example.org/photo.jpg','publisher_metadata','Fixture publisher','https://example.org/news') RETURNING id`, [item.rows[0].id, newsHash]);
    const input = { id: targetId, primary_location_id: locationId, location_type: "airport", latitude: 26.5, longitude: 56.2 };
    const read = (sql: string, params: any[]) => client.query(sql, params);
    const statement = buildContextImageQuery(input)!;
    const explained = await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement.sql}`, statement.params);
    const plan = explained.rows[0]["QUERY PLAN"][0];
    t.diagnostic(`Retained context metadata query: ${plan["Execution Time"]} ms, ${plan.Plan["Actual Rows"]} candidates`);
    const images = await getEventContextImages(input, read);
    assert.deepEqual(images.map((image) => image.id).sort(), [coveringId, news.rows[0].id].sort());
    assert.equal(images.find((image) => image.kind === "news")?.captured_at, null);
    assert.equal(images.find((image) => image.kind === "satellite")?.source_event_id, originalId);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM intelligence_event_evidence WHERE event_id=$1", [targetId])).rows[0].count, 0);
    // Own photograph content must not also be presented as reused context.
    await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,observed_at,confidence,relationship,provenance)
      VALUES($1,'news','publisher_report','item',$2,now(),0.6,'reported','{}')`, [targetId, `${item.rows[0].id}`]);
    assert.deepEqual((await getEventContextImages(input, read)).map((image) => image.id), [coveringId]);
    // A known name can still provide article context without exact coordinates.
    assert.deepEqual(await getEventContextImages({ ...input, latitude: null, longitude: null }, read), []);
    await client.query("DELETE FROM intelligence_event_evidence WHERE event_id=$1", [targetId]);
    assert.deepEqual((await getEventContextImages({ ...input, latitude: null, longitude: null }, read)).map((image) => image.id), [news.rows[0].id]);
    // Expiry immediately removes retained bytes from reuse eligibility.
    await client.query("UPDATE news_image_asset SET expires_at=now()-interval '1 second' WHERE content_hash=$1", [newsHash]);
    assert.deepEqual(await getEventContextImages({ ...input, latitude: null, longitude: null }, read), []);
    // Malformed/legacy AOIs must fail closed rather than break event detail.
    await client.query("UPDATE earth_observation SET methodology='{}' WHERE id=$1", [coveringId]);
    assert.deepEqual(await getEventContextImages(input, read), []);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
