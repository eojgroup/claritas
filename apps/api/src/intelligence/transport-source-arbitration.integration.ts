import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool, query } from "../db";
import { storeTransportSnapshots } from "../connectors/transport";

test("transport persistence keeps position and provenance from the winning source", async () => {
  const entityId = `integration-maritime-${randomUUID()}`;
  const observedAt = new Date().toISOString();
  const olderObservedAt = new Date(Date.parse(observedAt) - 60_000).toISOString();
  const newerObservedAt = new Date(Date.parse(observedAt) + 60_000).toISOString();
  const sameSourceFullAt = new Date(Date.parse(observedAt) + 120_000).toISOString();
  const sameSourceSparseAt = new Date(Date.parse(observedAt) + 180_000).toISOString();
  const snapshot = (
    source_name: "aisstream" | "barentswatch",
    candidateObservedAt: string,
    latitude: number,
    status: string,
    full = true,
  ) => ({
    mode: "maritime" as const,
    entity_id: entityId,
    registration: entityId,
    ...(full
      ? {
          display_name: `${source_name}-name`,
          callsign: `${source_name}-call`,
          vehicle_type: `${source_name}-type`,
          vehicle_category: `${source_name}-category`,
          heading: latitude + 10,
          speed: latitude + 20,
          current_country_iso2: source_name === "aisstream" ? "NO" : "SG",
          origin_country_iso2: source_name === "aisstream" ? "DK" : "MY",
          destination_country_iso2: source_name === "aisstream" ? "US" : "ID",
          registration_country_iso2: source_name === "aisstream" ? "NO" : "SG",
          origin_name: `${source_name}-origin`,
          destination_name: `${source_name}-destination`,
          origin_latitude: latitude + 1,
          origin_longitude: latitude + 2,
          destination_latitude: latitude + 3,
          destination_longitude: latitude + 4,
          route_label: `${source_name}-route`,
          linkage_basis: [`${source_name}-basis`],
          linkage_confidence: "high" as const,
          current_location_name: `${source_name}-location`,
        }
      : {}),
    latitude,
    longitude: 10,
    status,
    is_alert: false,
    source_name,
    observed_at: candidateObservedAt,
    payload: { provider: source_name, latitude },
  });

  const persistedRow = () =>
    query<Record<string, unknown>>(
      `SELECT display_name,callsign,registration,vehicle_type,vehicle_category,
              latitude,longitude,heading,speed,current_country_iso2,
              origin_country_iso2,destination_country_iso2,
              registration_country_iso2,origin_name,destination_name,
              origin_latitude,origin_longitude,destination_latitude,
              destination_longitude,route_label,linkage_basis,
              linkage_confidence,status,is_alert,source_name,observed_at,payload,
              current_location_name
       FROM transport_snapshot WHERE mode='maritime' AND entity_id=$1`,
      [entityId],
    );

  try {
    await storeTransportSnapshots([
      snapshot("aisstream", observedAt, 1, "primary-newer"),
    ]);
    const primaryRow = (await persistedRow()).rows[0];
    await storeTransportSnapshots([
      snapshot("barentswatch", olderObservedAt, 2, "fallback-older"),
    ]);
    assert.deepEqual((await persistedRow()).rows[0], primaryRow);

    await storeTransportSnapshots([
      snapshot("barentswatch", observedAt, 3, "official-tie"),
    ]);
    const officialRow = (await persistedRow()).rows[0];
    await storeTransportSnapshots([
      snapshot("aisstream", observedAt, 4, "primary-lower-priority-tie"),
    ]);
    assert.deepEqual((await persistedRow()).rows[0], officialRow);

    // A newer source always wins, but sparse metadata from that source must
    // not retain fields belonging to the previous provider's attribution.
    await storeTransportSnapshots([
      snapshot("aisstream", newerObservedAt, 5, "newer-sparse", false),
    ]);
    const afterSourceChange = (await persistedRow()).rows[0];
    assert.equal(afterSourceChange.source_name, "aisstream");
    assert.equal(afterSourceChange.latitude, 5);
    assert.equal(afterSourceChange.display_name, null);
    assert.equal(afterSourceChange.callsign, null);
    assert.equal(afterSourceChange.destination_name, null);
    assert.deepEqual(afterSourceChange.linkage_basis, []);
    assert.equal(afterSourceChange.linkage_confidence, "none");
    assert.deepEqual(afterSourceChange.payload, {
      provider: "aisstream",
      latitude: 5,
    });

    // Sparse updates from the same provider may retain that provider's own
    // static metadata without creating cross-provider provenance.
    await storeTransportSnapshots([
      snapshot("aisstream", sameSourceFullAt, 6, "same-source-full"),
    ]);
    const sameSourceFull = (await persistedRow()).rows[0];
    await storeTransportSnapshots([
      snapshot("aisstream", sameSourceSparseAt, 7, "same-source-sparse", false),
    ]);
    const afterSameSourceSparse = (await persistedRow()).rows[0];
    assert.equal(afterSameSourceSparse.display_name, sameSourceFull.display_name);
    assert.equal(afterSameSourceSparse.callsign, sameSourceFull.callsign);
    assert.equal(
      afterSameSourceSparse.destination_name,
      sameSourceFull.destination_name,
    );
    assert.deepEqual(
      afterSameSourceSparse.linkage_basis,
      sameSourceFull.linkage_basis,
    );
    assert.equal(afterSameSourceSparse.latitude, 7);
    assert.equal(afterSameSourceSparse.status, "same-source-sparse");
  } finally {
    await query(
      `DELETE FROM transport_entity_activity_hour
       WHERE mode='maritime' AND entity_id=$1`,
      [entityId],
    );
    await query(
      `DELETE FROM transport_track_point WHERE mode='maritime' AND entity_id=$1`,
      [entityId],
    );
    await query(
      `DELETE FROM transport_snapshot WHERE mode='maritime' AND entity_id=$1`,
      [entityId],
    );
  }
});

test.after(async () => {
  await pool.end();
});
