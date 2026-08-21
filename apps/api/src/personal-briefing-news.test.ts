import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("personal briefing scopes news to trusted subject countries and publication time", () => {
  const source = readFileSync(resolve(__dirname, "personal-briefing.ts"), "utf8");
  const signals = source.slice(
    source.indexOf("async function selectSignals"),
    source.indexOf("async function selectPersonalIntelligenceEvents"),
  );

  assert.match(signals, /\$\{trustedNewsDirectCountrySql\("i"\)\}/);
  assert.match(signals, /i\.payload->'subject_country_iso2s'/);
  assert.match(signals, /i\.payload#>'\{gkg,locations\}'/);
  assert.match(signals, /country_evidence\.correlation_factors->>'decision'='attached'/);
  assert.match(signals, /country_event\.status<>'dismissed'/);
  assert.match(signals, /COALESCE\(subject_country\.countries,ARRAY\[\]::text\[\]\) AS country_iso2s/);
  assert.match(signals, /WHEN i\.kind='news_article' THEN i\.event_time/);
  assert.match(
    signals,
    /\(i\.kind='news_article' AND i\.event_time >= \$1::timestamptz AND i\.event_time < \$2::timestamptz\)/,
  );
  assert.match(
    signals,
    /i\.kind IS DISTINCT FROM 'news_article'\s+AND COALESCE\(i\.event_time,i\.created_at\) >= \$1::timestamptz/,
  );
  assert.doesNotMatch(
    signals,
    /i\.kind='news_article' AND COALESCE\(i\.event_time,i\.created_at\)/,
  );
  assert.match(signals, /const itemCountries = Array\.from\(new Set/);
  assert.match(signals, /matchedCountryIso2 \?\? matchedRegionIso2 \?\? itemCountries\[0\]/);
  assert.match(signals, /country_iso2: selectedItemCountryIso2/);
});
