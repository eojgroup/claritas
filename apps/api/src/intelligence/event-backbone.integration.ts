import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool, query } from "../db";
import { consumeDomainEvent } from "./consumer";
import { buildEventDedupeKey } from "./correlation";
import { upsertIntelligenceSignal } from "./service";

test("outbox consumption, multi-domain evidence, alerts, and idempotency share one durable graph", async () => {
  const suffix = randomUUID();
  const now = new Date();
  process.env.EVENT_ALERTS_ENABLED = "true";
  process.env.EVENT_ALERT_RELEVANCE_THRESHOLD = "0.7";

  const source = await query<{ id: number }>(`SELECT id FROM source WHERE name='usgs-earthquakes'`);
  const sourceId = source.rows[0].id;
  const location = await query<{ id: string }>(`SELECT id FROM intelligence_location WHERE slug='port-singapore'`);
  const locationId = location.rows[0].id;

  const item = await query<{ id: string }>(
    `INSERT INTO item (source_id,external_id,kind,title,summary,url,country_iso2,event_time,payload,dedupe_hash)
     VALUES ($1,$2,'news_article','Wildfire reported near Port of Singapore',
       'Integration evidence for the transactional intelligence backbone.',$3,'SG',$4,$5::jsonb,$2)
     RETURNING id`,
    [sourceId, `integration-news-${suffix}`, `https://example.invalid/${suffix}`, now, JSON.stringify({ source: "integration-test" })],
  );
  const outbox = await query<any>(
    `SELECT id,event_type,aggregate_type,aggregate_id,payload,occurred_at
     FROM event_outbox WHERE event_type='news.story.ingested' AND aggregate_id=$1`,
    [item.rows[0].id],
  );
  assert.equal(outbox.rows.length, 1);
  const row = outbox.rows[0];
  const envelope = {
    id: row.id,
    type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    payload: row.payload,
    occurred_at: new Date(row.occurred_at).toISOString(),
  };
  assert.deepEqual(await consumeDomainEvent(envelope), { duplicate: false });
  assert.deepEqual(await consumeDomainEvent(envelope), { duplicate: true });

  const user = await query<{ id: string }>(
    `INSERT INTO app_user (email,email_verified,display_name) VALUES ($1,true,'Integration User') RETURNING id`,
    [`integration-${suffix}@example.invalid`],
  );
  await query(
    `INSERT INTO user_intelligence_watchlist (user_id,watch_type,watch_key,minimum_severity)
     VALUES ($1,'country','SG','high')`,
    [user.rows[0].id],
  );

  const eventDedupe = buildEventDedupeKey(["integration-port-disruption", suffix]);
  const signalBase = {
    dedupeKey: eventDedupe,
    eventType: "transport_disruption",
    title: "Material disruption near Port of Singapore",
    summary: "A high-priority integration signal with independently labelled evidence.",
    severity: "high" as const,
    confidence: 0.9,
    startTime: now,
    lastActivityTime: now,
    primaryLocationId: locationId,
    primaryCountryIso2: "SG",
    latitude: 1.264,
    longitude: 103.84,
    relevanceScore: 0.9,
    urgencyScore: 0.8,
    materialityScore: 0.85,
    scoreComponents: { integration: 1 },
    metadata: { symbol: "BDRY" },
  };
  const created = await upsertIntelligenceSignal({
    ...signalBase,
    evidence: {
      domain: "news",
      evidenceType: "reported_event",
      sourceRecordType: "integration_news",
      sourceRecordId: suffix,
      sourceId,
      observedAt: now,
      locationId,
      confidence: 0.85,
      relationship: "reported",
      provenance: { fixture: true },
      attribution: "Claritas integration fixture",
    },
  });
  await upsertIntelligenceSignal({
    ...signalBase,
    evidence: {
      domain: "transport",
      evidenceType: "movement_anomaly",
      sourceRecordType: "integration_transport",
      sourceRecordId: suffix,
      observedAt: now,
      locationId,
      confidence: 0.92,
      relationship: "derived",
      provenance: { fixture: true },
      attribution: "Claritas integration fixture",
    },
  });

  const graph = await query<{ domains: number; evidence: number; recipients: number; candidates: number }>(
    `SELECT
       (SELECT domain_count FROM intelligence_event WHERE id=$1)::int AS domains,
       (SELECT count(*) FROM intelligence_event_evidence WHERE event_id=$1)::int AS evidence,
       (SELECT count(*) FROM alert_candidate_recipient recipient JOIN alert_candidate candidate ON candidate.id=recipient.candidate_id WHERE candidate.event_id=$1)::int AS recipients,
       (SELECT count(*) FROM alert_candidate WHERE event_id=$1)::int AS candidates`,
    [created.id],
  );
  assert.deepEqual(graph.rows[0], { domains: 2, evidence: 2, recipients: 1, candidates: 1 });
});

test.after(async () => {
  await pool.end();
});
