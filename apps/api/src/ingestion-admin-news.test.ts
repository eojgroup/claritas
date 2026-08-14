import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const ingestion = import("./ingestion-admin");

test("scheduled news defaults enable governed providers within the hourly headline ceiling", async () => {
  const { buildNewsRunPlan } = await ingestion;
  const plan = buildNewsRunPlan({});

  assert.deepEqual(plan.providers, { gdelt: true, institutionalRss: true, govUk: true });
  assert.deepEqual(plan.gdelt, { timespan: "1h", maxRecords: 25, maxRawRows: 190 });
});

test("news run plan caps GDELT volume and validates duration syntax", async () => {
  const { buildNewsRunPlan, IngestionValidationError } = await ingestion;
  const plan = buildNewsRunPlan({
    providers: { gdelt: true, institutionalRss: false, govUk: false },
    gdelt: { timespan: "30min", maxRecords: 500, maxRawRows: 5_000 },
  });
  assert.deepEqual(plan.gdelt, { timespan: "30min", maxRecords: 25, maxRawRows: 190 });
  assert.throws(
    () => buildNewsRunPlan({ gdelt: { timespan: "yesterday" } }),
    IngestionValidationError,
  );
});

test("GDELT publisher coverage cannot hide behind fresh machine archives", async () => {
  const { classifyGdeltNewsCoverage } = await ingestion;
  assert.equal(classifyGdeltNewsCoverage({ doc_status: "healthy" }), "success");
  assert.equal(classifyGdeltNewsCoverage({
    doc_status: "degraded_fallback",
    gal_fallback: { selected: 4, latest_event_time: "2026-08-14T09:15:00Z" },
  }), "degraded");
  assert.equal(classifyGdeltNewsCoverage({
    doc_status: "degraded_fallback",
    gal_fallback: { selected: 0, latest_event_time: null },
  }), "failed");
  assert.equal(classifyGdeltNewsCoverage({ doc_status: "degraded", events: 500, signals: 500 }), "failed");
});

test("news scheduling migration preserves an explicit GOV.UK opt-out", () => {
  const migration = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V46__timely_governed_news_ingestion.sql",
  ), "utf8");

  assert.match(migration, /\?\| ARRAY\['govUk', 'gov_uk', 'govuk'\]/);
  assert.match(migration, /ELSE COALESCE\(default_payload->'providers'/);
  assert.doesNotMatch(migration, /UPDATE item/i);
});

test("news freshness excludes machine-coded GDELT records", () => {
  const automation = readFileSync(resolve(__dirname, "ingestion-automation.ts"), "utf8");
  const latestDataCte = automation.slice(
    automation.indexOf("), latest_data AS ("),
    automation.indexOf("), latest_acquisition AS ("),
  );

  assert.match(latestDataCte, /WHERE i\.kind = 'news_article'/);
  assert.match(latestDataCte, /MAX\(i\.event_time\)/);
  assert.doesNotMatch(latestDataCte, /MAX\(i\.created_at\)/);
});
