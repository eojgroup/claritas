import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool, query, withTransaction } from "../db";
import { consumeDomainEvent } from "./consumer";
import { buildEventDedupeKey } from "./correlation";
import { buildNewsReaderQuery } from "../news-reader-query";
import { buildNewsSearchPredicate } from "../news-search";
import { buildGdeltQuarantineQuery } from "../connectors/gdelt";
import {
  correlateAndUpsertIntelligenceSignal,
  recomputeIntelligenceEventAggregateTx,
  upsertIntelligenceSignal,
} from "./service";

test("canonical publisher identity converges direct and aggregator discoveries", async () => {
  const { rows } = await query<{
    ecb_direct: string;
    ecb_aggregated: string;
    govuk_direct: string;
    govuk_aggregated: string;
    unrelated: string;
  }>(`SELECT
      canonical_news_publisher_key(
        'https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html',
        '{"publisher":"European Central Bank"}'::jsonb,
        'institutional-rss'
      ) AS ecb_direct,
      canonical_news_publisher_key(
        'https://ecb.europa.eu/press/pr/date/2026/html/example.en.html',
        '{"domain":"ecb.europa.eu","provider":"gdelt"}'::jsonb,
        'gdelt'
      ) AS ecb_aggregated,
      canonical_news_publisher_key(
        'https://www.gov.uk/government/news/example',
        '{"publisher":"UK Government"}'::jsonb,
        'govuk-search'
      ) AS govuk_direct,
      canonical_news_publisher_key(
        'https://gov.uk/government/news/example',
        '{"domain":"gov.uk","provider":"gdelt"}'::jsonb,
        'gdelt'
      ) AS govuk_aggregated,
      canonical_news_publisher_key(
        'https://example.org/report',
        '{}'::jsonb,
        'fixture'
      ) AS unrelated`);

  assert.equal(rows[0].ecb_direct, "ecb.europa.eu");
  assert.equal(rows[0].ecb_aggregated, rows[0].ecb_direct);
  assert.equal(rows[0].govuk_direct, "gov.uk");
  assert.equal(rows[0].govuk_aggregated, rows[0].govuk_direct);
  assert.notEqual(rows[0].unrelated, rows[0].ecb_direct);
});

test("GDELT quarantine binds JSON parameters and preserves the first-seen history of existing stories", async () => {
  await withTransaction(async (client) => {
    const name = `gdelt-quarantine-fixture-${randomUUID()}`;
    const source = await client.query<{ id: number }>(
      "INSERT INTO source(name,api_base_url,auth_type) VALUES($1,'https://example.org/','none') RETURNING id",
      [name],
    );
    const sourceId = source.rows[0].id;
    const url = `https://example.org/${name}`;
    const firstSeen = "2026-09-07T18:00:00.000Z";
    const checkedAt = "2026-09-07T21:00:00.000Z";
    const rejected = buildGdeltQuarantineQuery(sourceId, url, "A rejected publisher story", "publisher_published_at_stale", checkedAt, firstSeen);
    const inserted = await client.query(rejected.sql, rejected.params);
    assert.equal(inserted.rows.length, 1);
    const original = await client.query("SELECT event_time::text,payload FROM item WHERE id=$1", [inserted.rows[0].id]);
    assert.equal(original.rows[0].payload.quality_status, "rejected");
    assert.equal(original.rows[0].payload.quality_checked_at, checkedAt);
    assert.equal(original.rows[0].payload.first_provider_seen_at, firstSeen);
    await client.query("UPDATE item SET payload=payload || '{\"quality_status\":\"accepted\"}'::jsonb WHERE id=$1", [inserted.rows[0].id]);
    const laterSeen = "2026-09-07T21:05:00.000Z";
    const update = buildGdeltQuarantineQuery(sourceId, url, "Rediscovered headline", "publisher_publication_unverified", checkedAt, laterSeen);
    assert.equal((await client.query(update.sql, update.params)).rows.length, 1);
    const final = await client.query("SELECT event_time::text,payload FROM item WHERE id=$1", [inserted.rows[0].id]);
    assert.equal(final.rows[0].payload.quality_status, "rejected");
    assert.equal(final.rows[0].payload.quality_rejection_reason, "publisher_publication_unverified");
    assert.equal(final.rows[0].payload.first_provider_seen_at, firstSeen);
    assert.equal(final.rows[0].payload.last_provider_seen_at, laterSeen);
    assert.equal(final.rows[0].event_time, original.rows[0].event_time);
    assert.equal((await client.query(update.sql, update.params)).rows.length, 0, "unchanged rejection stays idempotent");
    await client.query("DELETE FROM event_outbox WHERE aggregate_type='item' AND aggregate_id IN (SELECT id::text FROM item WHERE source_id=$1)", [sourceId]);
    await client.query("DELETE FROM source WHERE id=$1", [sourceId]);
  });
});

test("news reader query executes with and without metadata across bind layouts", async () => {
  const cases = [
    buildNewsReaderQuery({
      displayLanguage: "en",
      limit: 3,
      offset: 0,
      q: "",
      country: "",
      language: "",
      sourceCountry: "",
      provider: "",
      category: "",
      sort: "importance",
      archive: false,
      includeMetadata: true,
    }),
    buildNewsReaderQuery({
      displayLanguage: "en",
      limit: 10,
      offset: 10,
      q: "rates",
      country: "US",
      language: "en",
      sourceCountry: "US",
      provider: "institutional_rss",
      category: "economy",
      sort: "newest",
      archive: true,
      includeMetadata: false,
    }),
  ];

  for (const readerQuery of cases) {
    const result = await pool.query(readerQuery.sql, readerQuery.params);
    assert.equal(result.rows.length, 1);
    assert.ok(Array.isArray(result.rows[0].items));
  }
});

test("news research search matches phrases and publishers with literal wildcards and null-safe exclusions", async () => {
  const fixtures = [
    { id: 1, title: "The central bank cuts interest rates", summary: null, payload: { publisher: "Federal Reserve Board" }, url: "https://www.federalreserve.gov/policy", provider: "institutional_rss" },
    { id: 2, title: "Zinsentscheid", translated_title: "A decision on interest rates", summary: null, payload: { publisher: "Federal Reserve Board" }, url: "https://www.federalreserve.gov/decision", provider: "gdelt" },
    { id: 3, title: "The Fed holds interest rates", summary: "Inflation stays elevated", payload: {}, url: "https://www.federalreserve.gov/inflation", provider: "institutional_rss" },
    { id: 4, title: String.raw`10% growth for foo_bar at C:\markets`, payload: {}, provider: "fixture", url: "https://example.org/literal" },
    { id: 5, title: "100 growth for fooXbar at CXmarkets", payload: {}, provider: "fixture", url: "https://example.org/wildcard" },
    { id: 6, title: "Rates draw interest from the Fed", payload: {}, provider: "fixture", url: "https://example.org/order" },
  ];
  const cases: Array<[string, number[]]> = [
    ['Fed "interest rates" -inflation', [1, 2]],
    ['"interest rates"', [1, 2, 3]],
    ["-inflation", [1, 2, 4, 5, 6]],
    [String.raw`"10% growth" foo_bar C:\markets`, [4]],
    ["federalreserve.gov", [1, 2, 3]],
    ["institutional_rss", [1, 3]],
  ];
  for (const [search, expected] of cases) {
    const predicate = buildNewsSearchPredicate(search, 2);
    const { rows } = await query<{ id: number }>(`SELECT i.id
      FROM jsonb_to_recordset($1::jsonb) AS i(
        id int,title text,summary text,payload jsonb,url text,provider text,
        translated_title text,generated_summary text
      )
      CROSS JOIN LATERAL (SELECT i.translated_title,i.generated_summary) translation
      CROSS JOIN LATERAL (SELECT i.provider AS name) s
      WHERE ${predicate.sql}
      ORDER BY i.id`, [JSON.stringify(fixtures), ...predicate.params]);
    assert.deepEqual(rows.map((row) => row.id), expected, search);
  }
});

test("outbox consumption, multi-domain evidence, alerts, and idempotency share one durable graph", async () => {
  const suffix = randomUUID();
  const now = new Date();
  process.env.EVENT_ALERTS_ENABLED = "true";
  process.env.EVENT_ALERT_RELEVANCE_THRESHOLD = "0.7";
  process.env.EARTH_OBSERVATION_ENABLED = "true";
  process.env.EO_OBSERVABLE_EVENT_RELEVANCE_THRESHOLD = "0.46";

  const source = await query<{ id: number }>(`SELECT id FROM source WHERE name='usgs-earthquakes'`);
  const sourceId = source.rows[0].id;
  const location = await query<{ id: string }>(`SELECT id FROM intelligence_location WHERE slug='port-singapore'`);
  const locationId = location.rows[0].id;

  const item = await query<{ id: string }>(
    `INSERT INTO item (source_id,external_id,kind,title,summary,url,country_iso2,event_time,payload,dedupe_hash)
     VALUES ($1,$2,'news_article','Wildfire reported in coastal Singapore',
       'Integration evidence for the transactional intelligence backbone.',$3,'SG',$4,$5::jsonb,$2)
     RETURNING id`,
    [sourceId, `integration-news-${suffix}`, `https://example.invalid/${suffix}`, now, JSON.stringify({
      source: "integration-test",
      gkg: { locations: [{ type: 4, name: "Singapore", latitude: 1.264, longitude: 103.84, country_iso2: "SG" }] },
    })],
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

  const correlatedNews = await query<{ event_id: string }>(
    `SELECT event_id FROM intelligence_event_evidence
     WHERE domain='news' AND source_record_type='item' AND source_record_id=$1`,
    [item.rows[0].id],
  );
  assert.equal(correlatedNews.rows.length, 1);
  const physicalSignal = await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["integration-physical", suffix]),
    eventType: "wildfire",
    title: "Observed physical signal near Port of Singapore",
    summary: "A separately sourced physical observation for correlation testing.",
    severity: "high",
    confidence: 0.94,
    startTime: now,
    lastActivityTime: now,
    primaryLocationId: locationId,
    primaryCountryIso2: "SG",
    latitude: 1.264,
    longitude: 103.84,
    coordinatesAreExact: true,
    relevanceScore: 0.75,
    urgencyScore: 0.72,
    materialityScore: 0.7,
    scoreComponents: { integration_physical: 1 },
    evidence: {
      domain: "earth_observation",
      evidenceType: "integration_physical_observation",
      sourceRecordType: "integration_physical",
      sourceRecordId: suffix,
      sourceId,
      observedAt: now,
      locationId,
      confidence: 0.94,
      relationship: "observed",
      provenance: { fixture: true, provider: "integration-physical" },
      attribution: "Claritas integration fixture",
    },
  });
  assert.equal(physicalSignal.id, correlatedNews.rows[0].event_id);
  const correlationAudit = await query<{ score: number; decision: string }>(
    `SELECT score,decision FROM intelligence_correlation_decision
     WHERE source_record_type='integration_physical' AND source_record_id=$1`,
    [suffix],
  );
  assert.equal(correlationAudit.rows[0].decision, "attached");
  assert.ok(Number(correlationAudit.rows[0].score) >= 0.58);

  const remotePhysical = await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["integration-remote-earthquake", suffix]),
    eventType: "earthquake",
    title: "Remote observed earthquake",
    summary: "An exact physical observation without a nearby catalogued asset.",
    severity: "high",
    confidence: 0.98,
    startTime: now,
    lastActivityTime: now,
    primaryLocationId: null,
    primaryCountryIso2: null,
    latitude: -42.25,
    longitude: 166.75,
    coordinatesAreExact: true,
    relevanceScore: 0.82,
    urgencyScore: 0.8,
    materialityScore: 0.75,
    scoreComponents: { integration_remote_physical: 1 },
    evidence: {
      domain: "disaster", evidenceType: "seismic_observation",
      sourceRecordType: "integration_remote_physical", sourceRecordId: suffix,
      sourceId, observedAt: now, locationId: null, confidence: 0.98,
      relationship: "observed", provenance: { fixture: true },
      attribution: "Claritas integration fixture",
    },
  });
  const remoteDiscovery = await query<{ location_id: string | null; parameters: Record<string, unknown> }>(
    `SELECT location_id,parameters FROM earth_processing_job
     WHERE event_id=$1::uuid AND job_type='scene_discovery'`,
    [remotePhysical.id],
  );
  assert.equal(remoteDiscovery.rows.length, 1);
  assert.equal(remoteDiscovery.rows[0].location_id, null);
  assert.deepEqual(remoteDiscovery.rows[0].parameters.aoi_center, { latitude: -42.25, longitude: 166.75 });

  const weakFollowUpInput: Parameters<typeof correlateAndUpsertIntelligenceSignal>[0] = {
    dedupeKey: buildEventDedupeKey(["integration-weak-follow-up", suffix]),
    eventType: "wildfire",
    title: "Weak follow-up headline must not replace observed evidence",
    summary: "A lower-confidence reported update.",
    severity: "medium",
    confidence: 0.55,
    startTime: now,
    lastActivityTime: new Date(now.getTime() + 60_000),
    primaryLocationId: locationId,
    primaryCountryIso2: "SG",
    latitude: 1.264,
    longitude: 103.84,
    coordinatesAreExact: true,
    relevanceScore: 0.48,
    urgencyScore: 0.4,
    materialityScore: 0.4,
    scoreComponents: { integration_weak_follow_up: 1 },
    evidence: {
      domain: "news", evidenceType: "reported_event", sourceRecordType: "integration_weak_news",
      sourceRecordId: suffix, sourceId, observedAt: new Date(now.getTime() + 60_000),
      locationId, confidence: 0.55, relationship: "reported",
      provenance: { fixture: true, publisher: "weak-fixture.example" },
      attribution: "Claritas integration fixture",
    },
  };
  const weakFollowUp = await correlateAndUpsertIntelligenceSignal(weakFollowUpInput);
  assert.equal(weakFollowUp.id, physicalSignal.id);
  const canonicalAfterWeakUpdate = await query<{ title: string }>(
    `SELECT title FROM intelligence_event WHERE id=$1::uuid`,
    [physicalSignal.id],
  );
  assert.equal(canonicalAfterWeakUpdate.rows[0].title, "Observed physical signal near Port of Singapore");
  await correlateAndUpsertIntelligenceSignal({
    ...weakFollowUpInput,
    title: "Replayed weak source must still not become canonical",
    lastActivityTime: new Date(now.getTime() + 120_000),
    evidence: {
      ...weakFollowUpInput.evidence,
      observedAt: new Date(now.getTime() + 120_000),
    },
  });
  const canonicalAfterWeakReplay = await query<{ title: string }>(
    `SELECT title FROM intelligence_event WHERE id=$1::uuid`,
    [physicalSignal.id],
  );
  assert.equal(canonicalAfterWeakReplay.rows[0].title, "Observed physical signal near Port of Singapore");

  const countryLocation = await query<{ id: string }>(`SELECT id FROM intelligence_location WHERE slug='country-sg'`);
  const genericBase = {
    eventType: "reported_development",
    title: "Generic national development",
    summary: "Country context alone must not merge unrelated reports.",
    severity: "medium" as const,
    confidence: 0.75,
    startTime: now,
    lastActivityTime: now,
    primaryLocationId: countryLocation.rows[0].id,
    primaryCountryIso2: "SG",
    latitude: null,
    longitude: null,
    relevanceScore: 0.42,
    urgencyScore: 0.35,
    materialityScore: 0.35,
    scoreComponents: { integration_generic: 1 },
  };
  const genericA = await correlateAndUpsertIntelligenceSignal({
    ...genericBase,
    dedupeKey: buildEventDedupeKey(["generic-a", suffix]),
    evidence: {
      domain: "news", evidenceType: "reported_event", sourceRecordType: "integration_generic_a",
      sourceRecordId: suffix, observedAt: now, confidence: 0.75, relationship: "reported",
      provenance: { fixture: true }, attribution: "Claritas integration fixture",
    },
  });
  const genericB = await correlateAndUpsertIntelligenceSignal({
    ...genericBase,
    title: "Another unrelated national development",
    dedupeKey: buildEventDedupeKey(["generic-b", suffix]),
    evidence: {
      domain: "news", evidenceType: "reported_event", sourceRecordType: "integration_generic_b",
      sourceRecordId: suffix, observedAt: now, confidence: 0.75, relationship: "reported",
      provenance: { fixture: true }, attribution: "Claritas integration fixture",
    },
  });
  assert.notEqual(genericA.id, genericB.id);

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

  const beforeEnrichment = await query<any>(
    `SELECT domain_count,source_diversity,relevance_score,score_components
     FROM intelligence_event WHERE id=$1::uuid`,
    [created.id],
  );
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO intelligence_event_evidence (
         event_id,domain,evidence_type,source_record_type,source_record_id,
         observed_at,confidence,relationship,provenance
       ) VALUES ($1,'earth_observation','model_interpretation','integration_vision',$2,
         now(),0.95,'model_interpretation',$3::jsonb)`,
      [created.id, suffix, JSON.stringify({ provider: "openrouter", fixture: true })],
    );
    await recomputeIntelligenceEventAggregateTx(client, created.id);
  });
  const afterModel = await query<any>(
    `SELECT domain_count,source_diversity,relevance_score,score_components
     FROM intelligence_event WHERE id=$1::uuid`,
    [created.id],
  );
  assert.equal(Number(afterModel.rows[0].domain_count), Number(beforeEnrichment.rows[0].domain_count));
  assert.equal(Number(afterModel.rows[0].source_diversity), Number(beforeEnrichment.rows[0].source_diversity));
  assert.equal(Number(afterModel.rows[0].relevance_score), Number(beforeEnrichment.rows[0].relevance_score));

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO intelligence_event_evidence (
         event_id,domain,evidence_type,source_record_type,source_record_id,
         observed_at,confidence,relationship,provenance
       ) VALUES ($1,'earth_observation','rendered_observation','integration_scene',$2,
         now(),0.9,'observed',$3::jsonb)`,
      [created.id, suffix, JSON.stringify({ source_diversity_key: `copernicus:scene:${suffix}`, fixture: true })],
    );
    await recomputeIntelligenceEventAggregateTx(client, created.id);
  });
  const afterPhysical = await query<any>(
    `SELECT domain_count,source_diversity,relevance_score,score_components
     FROM intelligence_event WHERE id=$1::uuid`,
    [created.id],
  );
  assert.equal(Number(afterPhysical.rows[0].domain_count), 3);
  assert.equal(Number(afterPhysical.rows[0].source_diversity), 3);
  assert.equal(afterPhysical.rows[0].score_components.physical_observation, true);
  assert.ok(Number(afterPhysical.rows[0].relevance_score) > Number(afterModel.rows[0].relevance_score));
});

test.after(async () => {
  await pool.end();
});
