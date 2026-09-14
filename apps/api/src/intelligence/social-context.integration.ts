import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { pool, query } from "../db";
import { listSocialSignals } from "../connectors/social-media";
import { getSocialEventContexts, refreshSocialEventContext } from "./social-context";

test("retained social claims share event/country context without changing canonical confidence", async () => {
  const id = randomUUID();
  let sourceId: number | undefined;
  try {
    await query(`INSERT INTO country(iso2,iso3,name) VALUES('SE','SWE','Sweden') ON CONFLICT DO NOTHING`);
    sourceId = (await query<{ id: number }>(`INSERT INTO source(name,api_base_url,auth_type)
      VALUES($1,'https://bsky.app','none') RETURNING id`, [`social-test-${id}`])).rows[0].id;
    await query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time,primary_country_iso2,relevance_score,confidence)
      VALUES($1,$2,'transport_disruption','Sweden refinery outage disrupts regional fuel supply','Fixture',now(),now(),'SE',1,0.7)`, [id, id]);
    const signalId = (await query<{ id: number }>(`INSERT INTO social_signal
      (source_id,external_id,platform,content_text,url,posted_at,author_account_id,responsible_party_name,responsible_party_account_id,expires_at)
      VALUES($1,$2,'bluesky','Sweden refinery outage disrupts regional fuel supply','https://bsky.app/profile/fixture/post/1',now(),'fixture','Fixture account','fixture',now()+interval '1 day') RETURNING id`, [sourceId, id])).rows[0].id;
    await refreshSocialEventContext();
    const context = await getSocialEventContexts([id]);
    assert.equal(context.length, 1);
    assert.equal(context[0].classification, "unverified_social_claim");
    assert.equal(context[0].author, "Fixture account");
    const scoped = await listSocialSignals({ country: "SE", eventId: id });
    assert.equal(scoped.items.length, 1);
    assert.equal(scoped.items[0].linked_events[0].id, id);
    assert.equal(scoped.items[0].linked_events[0].country_iso2, "SE");
    assert.equal(scoped.items[0].country_iso2, null, "event geography must not rewrite post location");
    assert.equal((await listSocialSignals({ country: "NO", eventId: id })).items.length, 0);
    assert.equal(Number((await query(`SELECT confidence FROM intelligence_event WHERE id=$1`, [id])).rows[0].confidence), 0.7);
    await query(`UPDATE social_signal SET expires_at=now()-interval '1 second' WHERE id=$1`, [signalId]);
    assert.deepEqual(await getSocialEventContexts([id]), []);
    assert.equal((await listSocialSignals({ eventId: id })).items.length, 0);
    await query(`DELETE FROM social_signal WHERE id=$1`, [signalId]);
    assert.equal((await query(`SELECT * FROM social_event_context WHERE event_id=$1`, [id])).rows.length, 0);
  } finally {
    await query(`DELETE FROM intelligence_event WHERE id=$1`, [id]);
    if (sourceId) await query(`DELETE FROM source WHERE id=$1`, [sourceId]);
  }
});

test.after(async () => { await pool.end(); });
