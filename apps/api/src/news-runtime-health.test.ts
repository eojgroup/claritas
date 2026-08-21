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
  latest_current_event_time: "2026-08-21T11:58:00Z",
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
  release_gdelt_doc_error: null,
  release_gdelt_doc_accepted: 17,
  release_gdelt_doc_latest_event_time: "2026-08-21T11:48:00Z",
  release_gdelt_doc_quality_rejections: {
    publisher_publication_unverified: 3,
    publisher_published_at_stale: 2,
  },
  release_gdelt_gal_mode: "supplement",
  release_gdelt_gal_status: "healthy",
  release_gdelt_gal_error: null,
  release_gdelt_gal_accepted: 4,
  release_gdelt_gal_latest_event_time: "2026-08-21T11:45:00Z",
  release_gdelt_gal_quality_rejections: { publisher_published_at_stale: 1 },
  latest_success_at: "2026-08-21T11:50:00Z",
};

test("news runtime health proves freshness, markets, assessment and non-GB geography", () => {
  const result = evaluateNewsRuntimeHealth(healthy, now);
  assert.equal(result.ready, true);
  assert.equal(result.current.assessment_ratio, 0.9);
  assert.equal(result.release_run.id, 842);
  assert.ok(Object.values(result.checks).every(Boolean));
});

test("news runtime health exposes bounded exact-run GDELT diagnostics", () => {
  const result = evaluateNewsRuntimeHealth({
    ...healthy,
    release_gdelt_doc_error:
      "All GDELT DOC discovery lanes failed: markets_macro: GDELT HTTP 429 for https://api.gdeltproject.org/api/v2/doc/doc?query=secret: token=do-not-log",
    release_gdelt_gal_error:
      "request to https://example.invalid/feed?api_key=do-not-log timed out with token=do-not-log",
    release_gdelt_gal_status: "https://example.invalid/token=do-not-log",
    release_gdelt_doc_quality_rejections: {
      publisher_publication_unverified: "3",
      publisher_published_at_stale: 2,
      arbitrary_provider_text: 99,
    },
    release_gdelt_gal_quality_rejections: {
      missing_or_unsafe_url: 1,
      arbitrary_provider_text: 100,
    },
  }, now);

  assert.equal(result.ready, true, "diagnostics must not change the release gate");
  assert.deepEqual(result.release_run.gdelt_diagnostics.doc, {
    error: "All GDELT DOC discovery lanes failed (HTTP 429).",
    accepted: 17,
    latest_event_time: "2026-08-21T11:48:00.000Z",
    rejected: 5,
    rejection_counts: {
      publisher_publication_unverified: 3,
      publisher_published_at_stale: 2,
    },
  });
  assert.deepEqual(result.release_run.gdelt_diagnostics.gal, {
    mode: "supplement",
    status: null,
    error: "GDELT GAL request timed out.",
    accepted: 4,
    latest_event_time: "2026-08-21T11:45:00.000Z",
    rejected: 1,
    rejection_counts: { missing_or_unsafe_url: 1 },
  });
  const serialized = JSON.stringify(result.release_run.gdelt_diagnostics);
  assert.doesNotMatch(serialized, /https?:\/\//);
  assert.doesNotMatch(serialized, /do-not-log|api_key|token/i);
});

test("news runtime health fails closed for stale markets or a GB-only heatmap", () => {
  assert.equal(evaluateNewsRuntimeHealth({ ...healthy, market_count: 0 }, now).ready, false);
  const gbOnly = evaluateNewsRuntimeHealth({
    ...healthy,
    mapped_24h_countries: 1,
    non_gb_24h_count: 0,
  }, now);
  assert.equal(gbOnly.ready, false);
  assert.equal(gbOnly.checks.non_gb_geography, false);
});

test("first-seen reporting can supply current markets but not the publisher-time anchor", () => {
  const currentFallback = evaluateNewsRuntimeHealth({
    ...healthy,
    verified_count: 1,
    verified_market_count: 0,
    publisher_count: 4,
  }, now);
  assert.equal(currentFallback.ready, true);
  assert.equal(currentFallback.checks.markets, true);
  assert.equal(currentFallback.checks.publisher_verified, true);

  const unanchored = evaluateNewsRuntimeHealth({
    ...healthy,
    verified_count: 0,
    verified_market_count: 0,
  }, now);
  assert.equal(unanchored.ready, false);
  assert.equal(unanchored.checks.publisher_verified, false);
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
  assert.match(sql, /count\(DISTINCT current_news\.publisher_key\) FILTER \(\s*WHERE current_news\.assessed\s+AND current_news\.publisher_key<>'unknown'/);
  assert.match(sql, /max\(current_news\.event_time\)::text AS latest_current_event_time/);
  assert.match(sql, /categories \? 'markets'/);
  assert.doesNotMatch(sql, /publication_time_verified'\)::boolean/);
  assert.match(sql, /assessment\.assessed_at>=current_item\.updated_at/);
  assert.match(sql, /lower\(current_source\.name\) IN \('gdelt','govuk_search','institutional_rss'\)/);
  assert.match(sql, /raw_archive_status/);
  assert.match(sql, /gkg_archives_scanned/);
  assert.match(sql, /gkg_sampled/);
  assert.match(sql, /gkg_matched_country_rows/);
  assert.match(sql, /gkg_canonical_country_url_probes/);
  assert.match(sql, /result,doc_error/);
  assert.match(sql, /result,articles,accepted/);
  assert.match(sql, /result,articles,quality_rejections/);
  assert.match(sql, /result,gal_fallback,selected/);
  assert.match(sql, /result,gal_supplement,selected/);
  assert.match(sql, /result,gal_supplement_error/);
  assert.match(sql, /current_rollup AS/);
  assert.match(sql, /FROM current_rollup\s+CROSS JOIN geography_rollup/);
});
