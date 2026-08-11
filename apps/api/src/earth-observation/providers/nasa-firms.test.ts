import assert from "node:assert/strict";
import test from "node:test";
import { parseFirmsCsv } from "./nasa-firms";

test("FIRMS CSV parser retains observation provenance fields", () => {
  const rows = parseFirmsCsv("latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,version,frp,daynight\n25.10000,55.20000,2026-08-11,0521,N20,VIIRS,h,2.0NRT,14.2,D\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].acquisitionTime.toISOString(), "2026-08-11T05:21:00.000Z");
  assert.equal(rows[0].fireRadiativePower, 14.2);
  assert.equal(rows[0].confidence, "h");
  assert.equal(rows[0].externalId.length, 64);
});
