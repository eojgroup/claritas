import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewsRuntimeHealthQuery,
  evaluateNewsRuntimeHealth,
  type NewsRuntimeHealthRow,
} from "./news-runtime-health";

const now = new Date("2026-08-21T12:00:00Z");
const healthy: NewsRuntimeHealthRow = {
  current_count: 20,
  assessed_count: 18,
  market_count: 5,
  verified_count: 12,
  verified_market_count: 3,
  publisher_count: 8,
  latest_verified_event_time: "2026-08-21T11:55:00Z",
  mapped_24h_count: 14,
  mapped_24h_countries: 7,
  non_gb_24h_count: 12,
  release_run_id: 842,
  release_run_status: "success",
  release_run_trigger_mode: "release_gate",
  release_run_finished_at: "2026-08-21T11:50:00Z",
  release_gdelt_step_status: "success",
  release_gdelt_doc_status: "healthy",
  release_gdelt_raw_archive_status: "healthy",
  release_gdelt_gkg_archives_scanned: 4,
  release_gdelt_gkg_sampled: 180,
  release_gdelt_gkg_matched: 4,
  release_gdelt_gkg_matched_country_rows: 3,
  release_gdelt_gkg_canonical_country_url_probes: 1,
  latest_success_at: "2026-08-21T11:50:00Z",
};

test("news runtime health proves freshness, markets, assessment and non-GB geography", () => {
  const result = evaluateNewsRuntimeHealth(healthy, now);
  assert.equal(result.ready, true);
  assert.equal(result.current.assessment_ratio, 0.9);
  assert.equal(result.release_run.id, 842);
  assert.ok(Object.values(result.checks).every(Boolean));
});

test("news runtime health fails closed for stale markets or a GB-only heatmap", () => {
  assert.equal(evaluateNewsRuntimeHealth({ ...healthy, verified_market_count: 0 }, now).ready, false);
  const gbOnly = evaluateNewsRuntimeHealth({
    ...healthy,
    mapped_24h_countries: 1,
    non_gb_24h_count: 0,
  }, now);
  assert.equal(gbOnly.ready, false);
  assert.equal(gbOnly.checks.non_gb_geography, false);
});

test("news runtime health fails closed unless the exact release-owned GDELT run completed", () => {
  const wrongRun = evaluateNewsRuntimeHealth({
    ...healthy,
    release_run_id: null,
    release_run_status: null,
  }, now);
  assert.equal(wrongRun.ready, false);
  assert.equal(wrongRun.checks.exact_release_run, false);

  const translationOnlyOrIncomplete = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_step_status: null,
    release_gdelt_doc_status: null,
  }, now);
  assert.equal(translationOnlyOrIncomplete.ready, false);
  assert.equal(translationOnlyOrIncomplete.checks.release_gdelt_acquisition, false);

  const rawArchiveOutage = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_step_status: "degraded",
    release_gdelt_raw_archive_status: "degraded",
    release_gdelt_gkg_archives_scanned: 0,
  }, now);
  assert.equal(rawArchiveOutage.ready, false);
  assert.equal(rawArchiveOutage.checks.release_gdelt_raw_enrichment, false);

  const partialOlderArchiveOutage = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_step_status: "degraded",
    release_gdelt_raw_archive_status: "degraded",
    release_gdelt_gkg_archives_scanned: 1,
  }, now);
  assert.equal(partialOlderArchiveOutage.ready, true);
  assert.equal(partialOlderArchiveOutage.checks.release_gdelt_raw_enrichment, true);

  const scannedButUnusableGkg = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_step_status: "degraded",
    release_gdelt_raw_archive_status: "degraded",
    release_gdelt_gkg_archives_scanned: 1,
    release_gdelt_gkg_sampled: 0,
  }, now);
  assert.equal(scannedButUnusableGkg.ready, false);
  assert.equal(scannedButUnusableGkg.checks.release_gdelt_raw_enrichment, false);

  const decodedAndProbedButNotRandomlyLinkedGkg = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_gkg_matched: 0,
    release_gdelt_gkg_matched_country_rows: 0,
  }, now);
  assert.equal(decodedAndProbedButNotRandomlyLinkedGkg.ready, true);
  assert.equal(decodedAndProbedButNotRandomlyLinkedGkg.checks.release_gdelt_raw_enrichment, true);

  const linkedWithoutAcceptedDocGeography = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_gkg_matched_country_rows: 0,
  }, now);
  assert.equal(linkedWithoutAcceptedDocGeography.ready, true);
  assert.equal(linkedWithoutAcceptedDocGeography.checks.release_gdelt_raw_enrichment, true);

  const decodedWithoutCanonicalCountryProbe = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_gkg_canonical_country_url_probes: 0,
  }, now);
  assert.equal(decodedWithoutCanonicalCountryProbe.ready, false);
  assert.equal(decodedWithoutCanonicalCountryProbe.checks.release_gdelt_raw_enrichment, false);
});

test("news runtime query shares trusted subject-country and accepted GDELT rules", () => {
  const sql = buildNewsRuntimeHealthQuery();
  assert.match(sql, /IN \('gkg_location','article_structured_location','targeted_event_query_fallback','institutional_jurisdiction'\)/);
  assert.match(sql, /='content_alias' AND[\s\S]*IN \('medium','high'\)/);
  assert.doesNotMatch(sql, /IN \([^)]*'none'/);
  assert.match(sql, /subject_country_iso2s/);
  assert.match(sql, /gkg,locations/);
  assert.match(sql, /correlation_factors->>'decision'='attached'/);
  assert.match(sql, /payload->>'quality_status'='accepted'/);
  assert.match(sql, /assessment\.methodology_version=\$1/);
  assert.match(sql, /id=\$2::bigint/);
  assert.match(sql, /gdelt\/doc-event-gkg/);
  assert.match(sql, /publisher_verified/);
  assert.match(sql, /count\(DISTINCT current_news\.publisher_key\) FILTER \(\s*WHERE current_news\.assessed\s+AND current_news\.publisher_verified/);
  assert.match(sql, /categories \? 'markets'/);
  assert.doesNotMatch(sql, /publication_time_verified'\)::boolean/);
  assert.match(sql, /assessment\.assessed_at>=current_item\.updated_at/);
  assert.match(sql, /lower\(current_source\.name\) IN \('gdelt','govuk_search','institutional_rss'\)/);
  assert.match(sql, /raw_archive_status/);
  assert.match(sql, /gkg_archives_scanned/);
  assert.match(sql, /gkg_sampled/);
  assert.match(sql, /gkg_matched_country_rows/);
  assert.match(sql, /gkg_canonical_country_url_probes/);
  assert.match(sql, /current_rollup AS/);
  assert.match(sql, /FROM current_rollup\s+CROSS JOIN geography_rollup/);
});
