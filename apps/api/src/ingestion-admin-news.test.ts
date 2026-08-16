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
  assert.deepEqual(plan.gdelt, { timespan: "30min", maxRecords: 25, maxRawRows: 190 });
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

test("scheduled GDELT discovery uses a bounded overlapping candidate window", () => {
  const migration = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V48__diverse_news_candidate_window.sql",
  ), "utf8");

  assert.match(migration, /"timespan":"30min"/);
  assert.match(migration, /schedule_interval_minutes = 15/);
  assert.match(migration, /default_payload#>>'\{gdelt,timespan\}'/);
  assert.doesNotMatch(migration, /maxRecords/i);
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

test("reader and investigation queries require an accepted quality marker for GDELT articles", () => {
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const intelligence = readFileSync(resolve(__dirname, "intelligence/service.ts"), "utf8");

  assert.match(api, /lower\(s\.name\) <> 'gdelt' OR i\.payload->>'quality_status' = 'accepted'/);
  assert.match(intelligence, /lower\(COALESCE\(evidence_source\.name, ''\)\) = 'gdelt'/);
  assert.match(intelligence, /source_item\.payload->>'quality_status' = 'accepted'/);
});

test("global news discovery is country-balanced while a selected country stays newest-first", () => {
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const route = api.slice(
    api.indexOf('// List recent news items with optional filters'),
    api.indexOf('app.post("/api/news/:id/translation"'),
  );

  assert.match(route, /const newsCandidateOrderSql = country/);
  assert.match(route, /ROW_NUMBER\(\) OVER \(/);
  assert.match(route, /PARTITION BY COALESCE\(i\.country_iso2, 'ZZ'::char\(2\)\)/);
  assert.match(route, /\? "candidate\.event_time DESC NULLS LAST, candidate\.id DESC"/);
  assert.match(route, /WITH eligible_news AS MATERIALIZED/);
  assert.match(route, /FROM ranked_news ranked/);
});

test("news country coverage exposes freshness and provider depth", () => {
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const route = api.slice(
    api.indexOf('app.get("/api/news/country-stats"'),
    api.indexOf("// Admin user/role management"),
  );

  assert.match(route, /MAX\(COALESCE\(i\.event_time, i\.created_at\)\) AS latest_at/);
  assert.match(route, /COUNT\(DISTINCT s\.id\)::int AS provider_count/);
});
