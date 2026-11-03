import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "../db";
import { buildOverviewSampleQuery, buildOverviewEventQuery, assembleIntelligenceOverview } from "./overview";
import { normalizeOverviewOptions, type OverviewSample } from "./overview-model";
after(() => pool.end());

test("overview reads bounded time windows, excludes rejected/expired leads and preserves source/imagery provenance", async (t) => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const now = new Date("2026-11-03T12:00:00Z");
    const fixture = randomUUID();
    const source = (await client.query("INSERT INTO source(name,api_base_url) VALUES($1,'https://example.org') RETURNING id", [`overview-${fixture}`])).rows[0].id;
    let gdelt = (await client.query("SELECT id FROM source WHERE lower(name)='gdelt' LIMIT 1")).rows[0]?.id;
    if (!gdelt) gdelt = (await client.query("INSERT INTO source(name,api_base_url) VALUES('gdelt','https://api.gdeltproject.org') RETURNING id")).rows[0].id;
    const locationId = randomUUID();
    await client.query(`INSERT INTO intelligence_location(id,slug,location_type,canonical_name,country_iso2,latitude,longitude)
      VALUES($1,$2,'port','Overview port','SE',59.3,18.1)`, [locationId, `overview-${fixture}`]);
    const ids: string[] = [];
    const createEvent = async (hoursAgo: number, eventType: string, quality = "accepted", canonical?: string, status = "active") => {
      const id = randomUUID();
      ids.push(id);
      const occurred = new Date(now.getTime() - hoursAgo * 3_600_000);
      const item = (await client.query(`INSERT INTO item(source_id,kind,title,url,event_time,payload)
        VALUES($1,'news_article',$2,$3,$4,jsonb_build_object('quality_status',$5::text)) RETURNING id`,
        [quality === "rejected" ? gdelt : source, `Overview report ${id}`, `https://example.org/${id}`, occurred, quality])).rows[0].id;
      await client.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time,
        primary_country_iso2,primary_location_id,severity,relevance_score,urgency_score,materiality_score,status,metadata)
        VALUES($1::uuid,$1::text,$2,$3,'Bounded overview fixture',$4,$4,'SE',$5,'high',0.8,0.7,0.5,$6,
          jsonb_build_object('origin_domain','news','canonical_evidence_key',$7::text))`,
        [id, eventType, `Overview event ${id}`, occurred, locationId, status, canonical ?? `news:item:${item}`]);
      await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,
        source_id,observed_at,confidence,relationship,provenance)
        VALUES($1,'news','publisher_report','item',$2,$3,$4,0.7,'reported','{}')`, [id, `${item}`, quality === "rejected" ? gdelt : source, occurred]);
      return id;
    };
    const current = await createEvent(1, "security_incident");
    const previous = await createEvent(25, "security_incident", "accepted", undefined, "resolved");
    const transport = await createEvent(2, "aviation_disruption");
    const rejected = await createEvent(3, "security_incident", "rejected");
    const expiredSocial = await createEvent(4, "security_incident", "accepted", "social:social_signal:9223372036854775808");
    const dismissed = await createEvent(2, "security_incident", "accepted", undefined, "dismissed");
    await createEvent(60, "security_incident");
    const sceneId = randomUUID();
    await client.query(`INSERT INTO earth_scene(id,provider,mission,collection,provider_scene_id,capture_start,bbox,source_url,license,attribution,raw_metadata)
      VALUES($1::uuid,'fixture','Sentinel-2','sentinel-2-l2a',$1::text,$2,ARRAY[18,59,18.2,59.5]::double precision[],
        'https://example.org/scene','Open fixture','Fixture satellite','{}')`, [sceneId, new Date(now.getTime() - 48 * 3_600_000)]);
    const observationId = (await client.query(`INSERT INTO earth_observation(scene_id,event_id,product_type,status,captured_at,attribution,license)
      VALUES($1,$2,'true_color','available',$3,'Fixture satellite','Open fixture') RETURNING id`,
      [sceneId, current, new Date(now.getTime() - 48 * 3_600_000)])).rows[0].id;
    const assetId = (await client.query(`INSERT INTO earth_observation_asset(observation_id,asset_type,mime_type,width,height,gcs_object,content_hash,size_bytes,expires_at)
      VALUES($1,'preview','image/jpeg',768,512,'private-test-object',$2,100,now()+interval '2 days') RETURNING id`,
      [observationId, createHash("sha256").update(fixture).digest("hex")])).rows[0].id;
    const options = normalizeOverviewOptions({ country: "SE" });
    const statement = buildOverviewSampleQuery(options, now);
    const allRows = (await client.query<OverviewSample>(statement.sql, statement.params)).rows;
    const rows = allRows.filter((row) => ids.includes(row.id));
    assert.equal(rows.find((row) => row.id === rejected)?.displayable, false);
    assert.equal(rows.find((row) => row.id === expiredSocial)?.displayable, false);
    assert.equal(rows.find((row) => row.id === previous)?.period, "previous");
    assert.equal(rows.some((row) => row.id === dismissed), false);
    const eventStatement = buildOverviewEventQuery([current, transport]);
    const events = (await client.query(eventStatement.sql, eventStatement.params)).rows;
    const overview = assembleIntelligenceOverview(rows, events, options, now);
    assert.equal(overview.summary.event_count, 2);
    assert.equal(overview.summary.previous_event_count, 1);
    assert.equal(overview.summary.direction, "rising");
    assert.equal(overview.coverage.comparison_available, true);
    assert.equal(overview.events.length, 2);
    assert.equal(overview.events[0].id, current);
    assert.equal(overview.timeline[0].source_refs[0].url, `https://example.org/${current}`);
    assert.match(overview.timeline[0].imagery!.preview_url, new RegExp(`/api/earth-observation/assets/${assetId}\\?v=`));
    assert.equal(overview.timeline[0].imagery!.captured_at, "2026-11-01T12:00:00.000Z");
    assert.equal(overview.timeline[0].occurred_at, "2026-11-03T11:00:00.000Z");
    assert.equal("gcs_object" in overview.timeline[0].imagery!, false);
    const scopedStatement = buildOverviewSampleQuery(normalizeOverviewOptions({ country: "SE", topic: "transport" }), now);
    const scoped = (await client.query<OverviewSample>(scopedStatement.sql, scopedStatement.params)).rows.filter((row) => ids.includes(row.id));
    assert.deepEqual(scoped.map((row) => row.id), [transport]);
    const plan = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement.sql}`, statement.params)).rows[0]["QUERY PLAN"][0];
    t.diagnostic(`Bounded overview sample fixture: ${plan["Execution Time"]} ms`);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
