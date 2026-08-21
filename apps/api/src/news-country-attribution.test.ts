import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewsCountryStatsQuery,
  currentNewsAssessmentSql,
  newsStoryKeySql,
  trustedNewsDirectCountrySql,
} from "./news-country-attribution";

test("trusted news country SQL rejects publisher geography and weak content guesses", () => {
  const predicate = trustedNewsDirectCountrySql("item_row");
  assert.match(predicate, /institutional_jurisdiction/);
  assert.match(predicate, /gkg_location/);
  assert.match(predicate, /article_structured_location/);
  assert.doesNotMatch(predicate, /IN \([^)]*'none'/);
  assert.match(predicate, /content_alias/);
  assert.match(predicate, /'medium','high'/);
  assert.throws(() => trustedNewsDirectCountrySql("item; DROP TABLE item"));
});

test("news story identity deduplicates same-hour syndication without hiding hourly editions", () => {
  const expression = newsStoryKeySql("i");
  assert.match(expression, /regexp_replace\(lower\(i\.title\)/);
  assert.match(expression, /date_trunc\('hour',i\.event_time AT TIME ZONE 'UTC'\)/);
});

test("current assessment SQL rejects item and linked-event changes after the worker watermark", () => {
  const expression = currentNewsAssessmentSql("item_row", "assessment_row");
  assert.match(expression, /assessment_row\.assessed_at>=item_row\.updated_at/);
  assert.match(expression, /GREATEST\(changed_event\.updated_at,changed_evidence\.created_at\)/);
  assert.match(expression, />\s*assessment_row\.assessed_at/);
  assert.throws(() => currentNewsAssessmentSql("item; DROP TABLE item", "assessment"));
});

test("country stats use reader-compatible multi-country evidence and story semantics", () => {
  const sql = buildNewsCountryStatsQuery();
  assert.match(sql, /subject_country_iso2s/);
  assert.match(sql, /jsonb_array_elements[\s\S]*gkg,locations/);
  assert.match(sql, /correlation_factors->>'decision'='attached'/);
  assert.match(sql, /count\(DISTINCT story_key\)::int AS count/);
  assert.match(sql, /verified_count/);
  assert.match(sql, /count\(DISTINCT publisher_key\) FILTER \(/);
  assert.match(sql, /max\(publisher_event_time\) AS latest_at/);
  assert.match(sql, /publication_time_verified'='true'/);
  assert.match(sql, /JOIN news_item_assessment assessment/);
  assert.match(sql, /assessment\.methodology_version=\$2/);
  assert.match(sql, /assessment\.assessed_at>=i\.updated_at/);
  assert.match(sql, /metadata->>'retired'/);
  assert.match(sql, /mapped_story_keys AS MATERIALIZED/);
  assert.match(sql, /LEFT JOIN mapped_story_keys mapped/);
  assert.doesNotMatch(sql, /WHERE EXISTS \(\s*SELECT 1 FROM subject_countries/);
  assert.match(sql, /count\(DISTINCT eligible\.story_key\)::int AS total/);
  assert.match(sql, /i\.event_time<=now\(\)\+interval '5 minutes'/);
  assert.doesNotMatch(sql, /COALESCE\(i\.event_time,i\.created_at\)/);
});
