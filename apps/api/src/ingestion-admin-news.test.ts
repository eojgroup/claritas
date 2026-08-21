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
  assert.equal(plan.runTranslations, true);
});

test("release news plans are acquisition-only and carry durable ownership", async () => {
  const { buildNewsRunPlan } = await ingestion;
  const plan = buildNewsRunPlan({
    runTranslations: false,
    releaseId: "release-123-attempt-2",
  });

  assert.equal(plan.runTranslations, false);
  assert.equal(plan.releaseId, "release-123-attempt-2");
  assert.equal(plan.requestPayload.run_translations, false);
  assert.equal(plan.requestPayload.release_id, "release-123-attempt-2");
});

test("news run queueing is atomic and release cancellation is exact-owner scoped", () => {
  const implementation = readFileSync(resolve(__dirname, "ingestion-admin.ts"), "utf8");
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  assert.match(implementation, /pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)/);
  assert.match(implementation, /pipeline='news' AND status IN \('queued','running'\)/);
  assert.match(implementation, /request_payload->>'release_id'=\$2/);
  assert.match(implementation, /release_cancelled/);
  assert.match(implementation, /updated_at < now\(\)-make_interval\(mins => \$2::int\)/);
  assert.match(implementation, /INGESTION_RUN_HEARTBEAT_SECONDS/);
  assert.match(implementation, /updated_at < now\(\)-make_interval\(secs => \$2::int\)/);
  assert.match(implementation, /release_handoff_reclaimed/);
  assert.match(api, /buildNewsRunPlan\(\{ runTranslations: false, releaseId \}\)/);
  assert.match(api, /buildNewsRuntimeHealthQuery\(\),\s*\[NEWS_ASSESSMENT_METHODOLOGY, runId\]/);
  assert.match(api, /cancelReleaseNewsRun\(\{ runId, releaseId \}\)/);
});

test("news run plan caps GDELT volume and validates duration syntax", async () => {
  const { buildNewsRunPlan, IngestionValidationError } = await ingestion;
  const plan = buildNewsRunPlan({
    providers: { gdelt: true, institutionalRss: false, govUk: false },
    gdelt: { timespan: "1h", maxRecords: 500, maxRawRows: 5_000 },
  });
  assert.deepEqual(plan.gdelt, { timespan: "1h", maxRecords: 25, maxRawRows: 190 });
  assert.throws(
    () => buildNewsRunPlan({ gdelt: { timespan: "yesterday" } }),
    IngestionValidationError,
  );
  assert.throws(
    () => buildNewsRunPlan({ gdelt: { timespan: "30min" } }),
    /DOC API rejects shorter windows/,
  );
});

test("GDELT publisher coverage cannot hide behind fresh machine archives", async () => {
  const { classifyGdeltNewsCoverage } = await ingestion;
  assert.equal(classifyGdeltNewsCoverage({ doc_status: "healthy" }), "success");
  assert.equal(classifyGdeltNewsCoverage({
    doc_status: "healthy",
    health: "degraded",
    raw_archive_status: "degraded",
  }), "degraded");
  assert.equal(classifyGdeltNewsCoverage({
    doc_status: "healthy",
    health: "failed",
  }), "failed");
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
  const reader = readFileSync(resolve(__dirname, "news-reader-query.ts"), "utf8");
  const intelligence = readFileSync(resolve(__dirname, "intelligence/service.ts"), "utf8");

  assert.match(reader, /lower\(s\.name\) <> 'gdelt' OR i\.payload->>'quality_status' = 'accepted'/);
  assert.match(intelligence, /lower\(COALESCE\(evidence_source\.name, ''\)\) = 'gdelt'/);
  assert.match(intelligence, /source_item\.payload->>'quality_status' = 'accepted'/);
});

test("news importance and category filters are applied before pagination", () => {
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const route = api.slice(
    api.indexOf('// List recent news items with optional filters'),
    api.indexOf('app.post("/api/news/:id/translation"'),
  );
  const reader = readFileSync(resolve(__dirname, "news-reader-query.ts"), "utf8");
  const implementation = `${route}\n${reader}`;

  assert.match(route, /const archive = \["1", "true"\]\.includes/);
  assert.match(route, /buildNewsReaderQuery\(/);
  assert.match(reader, /const candidateOrder = sort === "importance"/);
  assert.match(reader, /WITH base_news AS NOT MATERIALIZED/);
  assert.match(reader, /i\.event_time >= now\(\) - interval '48 hours'/);
  assert.match(reader, /i\.event_time <= now\(\) \+ interval '5 minutes'/);
  assert.match(reader, /createNewsQueryParameterPlan\(displayLanguage, includeMetadata\)/);
  assert.match(reader, /jsonb_array_elements_text\(facet_item\.categories\)/);
  assert.match(reader, /category_facets AS MATERIALIZED/);
  assert.match(reader, /category_eligible_news AS NOT MATERIALIZED/);
  assert.match(reader, /story_ranked AS MATERIALIZED/);
  assert.match(reader, /eligible_news AS NOT MATERIALIZED/);
  assert.match(reader, /WHERE candidate\.categories \? \$\$\{categoryIndex\}/);
  assert.ok(implementation.indexOf("FROM eligible_news candidate") < implementation.indexOf("LIMIT $${limitIndex} OFFSET $${offsetIndex}"));
  assert.match(reader, /candidate\.importance_score DESC/);
  assert.match(reader, /candidate\.publisher_rank-1/);
  assert.match(route, /bounded-publisher-penalty-v1/);
  assert.match(reader, /jsonb_build_object\(\s*'score',ranked\.importance_score/);
  assert.match(reader, /'is_fallback',ranked\.ranking_is_fallback/);
  assert.match(reader, /assessment\.methodology_version=\$\$\{methodologyIndex\}/);
});

test("balanced discovery migration restores timely news without inventing publisher countries", () => {
  const migration = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V52__balanced_news_discovery.sql",
  ), "utf8");
  const indexMigration = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V53__balanced_news_indexes.sql",
  ), "utf8");
  const indexMigrationConfig = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V53__balanced_news_indexes.sql.conf",
  ), "utf8");
  const flywayJob = readFileSync(resolve(
    __dirname,
    "../../../infra/k8s/migrations/flyway-job.yaml",
  ), "utf8");
  assert.match(migration, /WHEN schedule_interval_minutes = 60 THEN 15/);
  assert.match(migration, /ELSE schedule_interval_minutes/);
  assert.match(migration, /WHERE pipeline = 'news'/);
  assert.match(migration, /"timespan":"1h","maxRecords":25,"maxRawRows":190/);
  assert.match(migration, /IN \('15min','30min','45min'\)/);
  assert.match(migration, /publication_time_verified/);
  assert.match(migration, /subject_country_iso2s/);
  assert.match(migration, /location_aliases/);
  assert.match(migration, /INSERT INTO country \(iso2, iso3, name, region\)/);
  assert.match(migration, /\('ZW','ZWE','Zimbabwe','Africa'\)/);
  assert.match(migration, /occupied palestinian territories/);
  assert.match(migration, /democratic republic of the congo/);
  assert.match(migration, /institutional_jurisdiction/);
  assert.match(migration, /'','none','publisher_country_fallback','feed_hint','locale_hint','url_tld/);
  assert.match(migration, /country_inference,source/);
  assert.match(migration, /country_iso2 = NULL/);
  assert.doesNotMatch(migration, /canonical_gdelt_article_url/);
  assert.match(migration, /claritas\.suppress_item_outbox/);
  assert.match(migration, /claritas\.preserve_updated_at/);
  assert.doesNotMatch(migration, /CREATE INDEX CONCURRENTLY/);
  assert.match(indexMigration, /DROP INDEX CONCURRENTLY IF EXISTS item_news_source_url_idx/);
  assert.match(indexMigration, /DROP INDEX CONCURRENTLY IF EXISTS item_news_source_canonical_url_idx/);
  assert.match(indexMigration, /CREATE INDEX CONCURRENTLY item_news_source_url_idx/);
  assert.match(indexMigration, /CREATE INDEX CONCURRENTLY item_news_source_canonical_url_idx/);
  assert.doesNotMatch(migration, /item_gdelt_recent_event_idx/);
  assert.match(indexMigrationConfig, /executeInTransaction=false/);
  assert.match(flywayJob, /FLYWAY_POSTGRESQL_TRANSACTIONAL_LOCK[\s\S]*value: "false"/);
  assert.match(migration, /lower\(provider\.name\) IN \('gdelt','govuk_search','institutional_rss'\)/);
  assert.doesNotMatch(migration, /UPDATE source/i);
});

test("newest news is strictly chronological in current and explicit archive modes", () => {
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const route = api.slice(
    api.indexOf('// List recent news items with optional filters'),
    api.indexOf('app.post("/api/news/:id/translation"'),
  );
  const reader = readFileSync(resolve(__dirname, "news-reader-query.ts"), "utf8");

  assert.match(reader, /: "candidate\.event_time DESC NULLS LAST, candidate\.id DESC"/);
  assert.match(route, /req\.query\.sort[\s\S]*: "newest"/);
  assert.doesNotMatch(reader, /country_rank/);
  assert.match(route, /archive,/);
  assert.match(route, /metadata_included: includeMetadata/);
  assert.match(reader, /FROM ranked_news ranked/);
});

test("news assessment migration is separate, bounded, and indexed", () => {
  const migration = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V51__news_item_assessment.sql",
  ), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS news_item_assessment/);
  assert.match(migration, /item_id\s+BIGINT PRIMARY KEY REFERENCES item\(id\) ON DELETE CASCADE/);
  assert.match(migration, /methodology_version\s+TEXT NOT NULL/);
  assert.match(migration, /score\s+DOUBLE PRECISION NOT NULL CHECK \(score BETWEEN 0 AND 100\)/);
  assert.match(migration, /tier\s+TEXT NOT NULL CHECK \(tier IN \('top','high','notable','routine'\)\)/);
  assert.match(migration, /confidence\s+DOUBLE PRECISION NOT NULL CHECK \(confidence BETWEEN 0 AND 1\)/);
  assert.match(migration, /USING GIN \(categories\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION canonical_news_publisher_key/);
  assert.match(migration, /substring\(article_url FROM/);
  assert.match(migration, /\^www\[0-9\]\*\\\./);
  assert.doesNotMatch(migration, /ALTER TABLE item/);
});

test("bounded assessment worker refreshes item and event changes without treating domains as publishers", () => {
  const worker = readFileSync(resolve(__dirname, "news-assessment-worker.ts"), "utf8");
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const reader = readFileSync(resolve(__dirname, "news-reader-query.ts"), "utf8");

  assert.match(worker, /LIMIT \$2/);
  assert.match(worker, /changed_event\.updated_at/);
  assert.match(worker, /changed_evidence\.created_at/);
  assert.match(worker, /count\(DISTINCT canonical_news_publisher_key\(/);
  assert.match(reader, /canonical_news_publisher_key\(i\.url,i\.payload,s\.name\)/);
  assert.match(worker, /event\.source_diversity,event\.domain_count/);
  assert.doesNotMatch(worker, /count\(DISTINCT domain\)/);
  assert.match(worker, /withWorkerLease\("news-item-assessment"/);
  assert.match(worker, /statement_timestamp\(\) AS assessment_watermark/);
  assert.match(worker, /WHEN assessment\.item_id IS NULL\s+AND item\.event_time>=now\(\)-interval '8 days'\s+AND item\.event_time<=now\(\)\+interval '5 minutes' THEN 0/);
  assert.match(worker, /WHEN assessment\.item_id IS NOT NULL\s+AND item\.event_time>=now\(\)-interval '8 days'\s+AND item\.event_time<=now\(\)\+interval '5 minutes' THEN 1/);
  assert.match(worker, /WHEN assessment\.item_id IS NOT NULL THEN 2\s+ELSE 3/);
  assert.match(worker, /assessment\.assessed_at ASC NULLS LAST/);
  assert.match(worker, /item\.event_time\+interval '168 hours'/);
  assert.doesNotMatch(worker, /date_trunc\('hour',now\(\)\)/);
  assert.match(worker, /assessed_at=EXCLUDED\.assessed_at/);
  assert.doesNotMatch(worker, /WHERE news_item_assessment\.inputs_hash IS DISTINCT/);
  assert.match(api, /startNewsAssessmentWorker\(\)/);
});

test("daily briefing uses current assessments and the same publisher-burst penalty", () => {
  const generator = readFileSync(resolve(__dirname, "briefing-generator.ts"), "utf8");
  const context = generator.slice(
    generator.indexOf("async function collectBriefingContext"),
    generator.indexOf("query<GdeltEventContextRow>"),
  );

  assert.match(context, /LEFT JOIN news_item_assessment assessment\s+ON assessment\.item_id=i\.id/);
  assert.match(context, /assessment\.methodology_version='\$\{NEWS_ASSESSMENT_METHODOLOGY\}'/);
  assert.match(context, /currentNewsAssessmentSql\("i", "assessment"\)/);
  assert.match(context, /\$\{newsStoryKeySql\("i"\)\} AS story_key/);
  assert.match(context, /PARTITION BY candidate\.story_key/);
  assert.match(context, /COALESCE\(i\.payload->>'time_basis'='provider_first_seen',false\) AS time_is_provider_discovery/);
  assert.match(context, /FROM distinct_news candidate/);
  assert.match(context, /PARTITION BY candidate\.publisher_key\s+ORDER BY candidate\.base_quality_score DESC/);
  assert.match(context, /base_quality_score\s+- LEAST\(24::double precision,\(publisher_rank-1\)::double precision\*8\)/);
  assert.match(context, /importance_score DESC NULLS LAST,\s+event_time DESC/);
  assert.doesNotMatch(context, /COALESCE\(i\.event_time, i\.created_at\)/);
});

test("news country coverage exposes freshness and provider depth", () => {
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const route = api.slice(
    api.indexOf('app.get("/api/news/country-stats"'),
    api.indexOf("// Admin user/role management"),
  );
  const attribution = readFileSync(resolve(__dirname, "news-country-attribution.ts"), "utf8");

  assert.match(route, /buildNewsCountryStatsQuery\(\)/);
  assert.match(route, /\[days, NEWS_ASSESSMENT_METHODOLOGY\]/);
  assert.match(route, /Math\.min\([\s\S]*, 45\)/);
  assert.match(attribution, /max\(publisher_event_time\) AS latest_at/);
  assert.match(attribution, /publication_time_verified'='true'/);
  assert.match(attribution, /count\(DISTINCT publisher_key\) FILTER \([\s\S]*AS provider_count/);
  assert.match(attribution, /verified_count/);
  assert.match(attribution, /JOIN news_item_assessment assessment/);
  assert.match(attribution, /metadata->>'retired'/);
  assert.match(attribution, /count\(DISTINCT story_key\)::int AS count/);
  assert.doesNotMatch(attribution, /COALESCE\(i\.event_time,i\.created_at\)/);
});
