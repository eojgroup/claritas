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
          assert.equal(built.sql.includes("now() - interval '8 days'"), !archive);
        }
      }
    }
  }
});
