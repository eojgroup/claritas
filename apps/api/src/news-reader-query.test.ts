import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const reader = import("./news-reader-query");

test("news reader variants use every PostgreSQL bind index contiguously", async () => {
  const { buildNewsReaderQuery } = await reader;
  for (const includeMetadata of [true, false]) {
    for (const archive of [true, false]) {
      for (const sort of ["importance", "newest"] as const) {
        for (const filtered of [true, false]) {
          const built = buildNewsReaderQuery({
            displayLanguage: "en",
            limit: 20,
            offset: filtered ? 20 : 0,
            q: filtered ? "rates" : "",
            country: filtered ? "US" : "",
            language: filtered ? "en" : "",
            sourceCountry: filtered ? "US" : "",
            provider: filtered ? "institutional_rss" : "",
            category: filtered ? "economy" : "",
            sort,
            archive,
            includeMetadata,
          });
          const referenced = new Set(
            [...built.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
          );
          assert.deepEqual(
            [...referenced].sort((left, right) => left - right),
            Array.from({ length: built.params.length }, (_, index) => index + 1),
          );
          assert.equal(built.sql.includes("category_facets AS MATERIALIZED"), includeMetadata);
          assert.equal(built.sql.includes("publisher_rank"), sort === "importance");
          assert.equal(built.sql.includes("now() - interval '48 hours'"), !archive);
        }
      }
    }
  }
});

test("country and category scope compose before syndicated-story pagination", async () => {
  const { buildNewsReaderQuery } = await reader;
  const built = buildNewsReaderQuery({
    displayLanguage: "en",
    limit: 20,
    offset: 0,
    q: "",
    country: "SG",
    language: "",
    sourceCountry: "",
    provider: "",
    category: "markets",
    sort: "newest",
    archive: false,
    includeMetadata: true,
  });
  const countryIndex = built.params.indexOf("SG") + 1;
  const categoryIndex = built.params.indexOf("markets") + 1;
  assert.ok(countryIndex > 0);
  assert.ok(categoryIndex > 0);
  assert.match(built.sql, new RegExp(`upper\\(BTRIM\\(i\\.country_iso2::text\\)\\) = \\$${countryIndex}`));
  assert.match(built.sql, /country_event\.primary_country_iso2/);
  assert.match(built.sql, /country_evidence\.correlation_factors->>'decision'='attached'/);
  assert.match(built.sql, /i\.payload#>'\{gkg,locations\}'/);
  assert.match(built.sql, /category_eligible_news AS NOT MATERIALIZED/);
  assert.match(built.sql, new RegExp(`candidate\\.categories \\? \\$${categoryIndex}`));
  assert.ok(built.sql.indexOf("category_eligible_news AS NOT MATERIALIZED") < built.sql.indexOf("story_ranked AS MATERIALIZED"));
  assert.match(built.sql, /PARTITION BY candidate\.story_key/);
  assert.match(built.sql, /GROUP BY category\.value,facet_item\.story_key/);
  assert.match(built.sql, /candidate\.ranking_is_fallback ASC,\s+candidate\.time_is_provider_discovery ASC/);
  assert.match(built.sql, /'basis',COALESCE/);
  assert.match(built.sql, /'is_publisher_verified'/);
  assert.match(built.sql, /'is_publisher_verified',COALESCE\([\s\S]*LIKE 'publisher_published%',false\)/);
  assert.match(built.sql, /assessment\.assessed_at>=i\.updated_at/);
  assert.match(built.sql, /GREATEST\(changed_event\.updated_at,changed_evidence\.created_at\)/);
});

test("importance ranks provider discovery below equivalent verified publication", async () => {
  const { buildNewsReaderQuery } = await reader;
  const built = buildNewsReaderQuery({
    displayLanguage: "en",
    limit: 20,
    offset: 0,
    q: "",
    country: "",
    language: "",
    sourceCountry: "",
    provider: "",
    category: "",
    sort: "importance",
    archive: false,
    includeMetadata: false,
  });
  assert.match(
    built.sql,
    /COALESCE\(assessment\.score,0\)::double precision\s+- CASE WHEN i\.payload->>'time_basis'='provider_first_seen' THEN 8 ELSE 0 END/,
  );
  assert.match(
    built.sql,
    /COALESCE\(i\.payload->>'time_basis'='provider_first_seen',false\) AS time_is_provider_discovery/,
  );
  assert.match(
    built.sql,
    /PARTITION BY candidate\.publisher_key\s+ORDER BY candidate\.base_quality_score DESC/,
  );
  assert.match(
    built.sql,
    /candidate\.base_quality_score\s+- LEAST\(24::double precision,\(candidate\.publisher_rank-1\)::double precision\*8\)/,
  );
});

test("unassessed metadata counts wholly unassessed story representatives", async () => {
  const { buildNewsReaderQuery } = await reader;
  const built = buildNewsReaderQuery({
    displayLanguage: "en",
    limit: 20,
    offset: 0,
    q: "",
    country: "",
    language: "",
    sourceCountry: "",
    provider: "",
    category: "",
    sort: "newest",
    archive: false,
    includeMetadata: true,
  });

  assert.match(
    built.sql,
    /SELECT story_key\s+FROM base_news\s+GROUP BY story_key\s+HAVING bool_and\(ranking_is_fallback\)/,
  );
  assert.doesNotMatch(
    built.sql,
    /count\(\*\)::int FROM base_news WHERE ranking_is_fallback/,
  );
});
