import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { pool } from "../db";
import { upsertIntelligenceSignalTx } from "./service";
import type { IntelligenceSignalInput } from "./types";
after(() => pool.end());

test("conflicting news geography cannot move Hormuz; retained coordinates keep their own provenance", async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const location = (await client.query("SELECT id FROM intelligence_location WHERE slug='strait-of-hormuz'")).rows[0].id;
    const now = new Date(), key = randomUUID();
    const base: IntelligenceSignalInput = {
      dedupeKey: key, eventType: "reported_development", title: "Shipping report at Strait of Hormuz", summary: "An attributed shipping report.",
      severity: "medium", confidence: .8, startTime: now, lastActivityTime: now, primaryLocationId: location,
      relevanceScore: .5, urgencyScore: .4, materialityScore: .4, scoreComponents: {},
      evidence: { domain: "news", evidenceType: "publisher_report", sourceRecordType: "geo_fixture", sourceRecordId: key,
        observedAt: now, confidence: .8, relationship: "reported", provenance: { fixture: true }, attribution: "Fixture" },
    };
    const options = { suppressEarthObservation: true, suppressAlertCandidate: true };
    const event = await upsertIntelligenceSignalTx(client, base, options);
    const enrich = (id: string, latitude: number, longitude: number): IntelligenceSignalInput => ({ ...base,
      primaryLocationId: null, primaryCountryIso2: "SE", latitude, longitude, coordinatesAreExact: true,
      confidence: .6, evidence: { ...base.evidence, sourceRecordType: "global_event", sourceRecordId: id, confidence: .6 } });
    await upsertIntelligenceSignalTx(client, enrich("1", 59.3333, 18.05), options);
    let saved = (await client.query("SELECT geography,metadata,primary_country_iso2 FROM intelligence_event WHERE id=$1", [event.id])).rows[0];
    assert.equal(saved.geography, null);
    assert.equal(saved.metadata.exact_geography, undefined);
    assert.equal(saved.primary_country_iso2, null);
    await upsertIntelligenceSignalTx(client, enrich("2", 26.1799, 56.2477), options);
    await upsertIntelligenceSignalTx(client, enrich("3", 59.3333, 18.05), options);
    await upsertIntelligenceSignalTx(client, enrich("4", 26.56, 56.25), options);
    saved = (await client.query("SELECT ST_Y(geography) AS lat,ST_X(geography) AS lon,metadata FROM intelligence_event WHERE id=$1", [event.id])).rows[0];
    assert.equal(saved.lat, 26.1799);
    assert.equal(saved.lon, 56.2477);
    assert.equal(saved.metadata.geography_provenance_key, "news:global_event:2");
    const newConflict = await upsertIntelligenceSignalTx(client, { ...base, dedupeKey: randomUUID(),
      latitude: 59.3333, longitude: 18.05, coordinatesAreExact: true, primaryCountryIso2: "SE" }, options);
    const rejected = (await client.query("SELECT geography,metadata,primary_country_iso2 FROM intelligence_event WHERE id=$1", [newConflict.id])).rows[0];
    assert.equal(rejected.geography, null);
    assert.equal(rejected.metadata.exact_geography, undefined);
    assert.equal(rejected.primary_country_iso2, null);
    // Replay the historic corrupt state through the actual repair migration.
    await client.query(`UPDATE intelligence_event SET geography=ST_SetSRID(ST_MakePoint(18.05,59.3333),4326),
      metadata=metadata||'{"exact_geography":true,"geography_provenance_key":"news:global_event:3"}' WHERE id=$1`, [event.id]);
    await client.query(readFileSync(resolve(__dirname, "../../../../infra/gcp/sql/V75__repair_conflicting_news_geography.sql"), "utf8"));
    saved = (await client.query("SELECT geography,metadata FROM intelligence_event WHERE id=$1", [event.id])).rows[0];
    assert.equal(saved.geography, null);
    assert.equal(saved.metadata.geography_repair_v1.previous_latitude, 59.3333);
    assert.equal(saved.metadata.exact_geography, undefined);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
