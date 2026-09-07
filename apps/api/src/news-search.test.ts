import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewsSearchPredicate,
  NewsSearchValidationError,
  parseNewsSearchQuery,
} from "./news-search";

test("news search combines terms, exact phrases and exclusions without changing source text", () => {
  assert.deepEqual(parseNewsSearchQuery('  "interest rates" Fed -inflation -"press release"  '), [
    { text: "interest rates", excluded: false },
    { text: "Fed", excluded: false },
    { text: "inflation", excluded: true },
    { text: "press release", excluded: true },
  ]);
  assert.deepEqual(parseNewsSearchQuery("東京\téconomie bank-rate"), [
    { text: "東京", excluded: false }, { text: "économie", excluded: false }, { text: "bank-rate", excluded: false },
  ]);
  assert.deepEqual(parseNewsSearchQuery('"-1.5%"'), [{ text: "-1.5%", excluded: false }]);
  assert.deepEqual(parseNewsSearchQuery("   \n\t"), []);
});

test("news search rejects excess input instead of silently changing its meaning", () => {
  assert.equal(parseNewsSearchQuery("x".repeat(400))[0].text.length, 400);
  assert.equal(parseNewsSearchQuery(Array.from({ length: 12 }, (_, i) => `term${i}`).join(" ")).length, 12);
  for (const [query, message] of [
    ["x".repeat(401), /400 characters/],
    [" ".repeat(401), /400 characters/],
    [Array.from({ length: 13 }, (_, i) => `term${i}`).join(" "), /at most 12/],
    ['"missing close', /unclosed quoted phrase/],
    ['"rates"Fed', /Separate/],
    ['rates"Fed"', /complete news search phrase/],
    ['""', /cannot be empty/],
    ['-"  "', /cannot be empty/],
    ["-", /cannot be empty/],
    ["rates\u0000", /NUL/],
  ] as const) {
    assert.throws(() => parseNewsSearchQuery(query), (error: unknown) => error instanceof NewsSearchValidationError && message.test(error.message));
  }
});

test("mobile smart quotes delimit exact phrases and exclusions while preserving their contents", () => {
  assert.deepEqual(parseNewsSearchQuery('“interest rates” Fed -“press release”'), [
    { text: "interest rates", excluded: false },
    { text: "Fed", excluded: false },
    { text: "press release", excluded: true },
  ]);
  assert.deepEqual(parseNewsSearchQuery(String.raw`“ 10%  growth_\today ” " spaced phrase "`), [
    { text: String.raw` 10%  growth_\today `, excluded: false },
    { text: " spaced phrase ", excluded: false },
  ]);
  assert.deepEqual(buildNewsSearchPredicate('“interest rates” -“press release”').params, ["%interest rates%", "%press release%"]);
  for (const [query, message] of [
    ["“interest rates", /unclosed quoted phrase/],
    ['“interest rates"', /mismatched quote delimiters/],
    ['"interest rates”', /mismatched quote delimiters/],
    ["“interest rates“", /mismatched quote delimiters/],
    ["”interest rates”", /mismatched quote delimiters/],
    ["-“ ”", /cannot be empty/],
  ] as const) {
    assert.throws(() => parseNewsSearchQuery(query), (error: unknown) => error instanceof NewsSearchValidationError && message.test(error.message));
  }
});

test("search patterns bind SQL wildcards, escapes and injection text literally", () => {
  const built = buildNewsSearchPredicate(String.raw`"10% growth" foo_bar C:\markets wow! "x');DROP TABLE item;--"`, 4);
  assert.deepEqual(built.params, ["%10!% growth%", "%foo!_bar%", String.raw`%C:\markets%`, "%wow!!%", "%x');DROP TABLE item;--%"]);
  assert.ok(built.sql);
  assert.doesNotMatch(built.sql, /DROP TABLE|10% growth|foo_bar|markets/);
  const indexes = [...new Set([...built.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))];
  assert.deepEqual(indexes, [4, 5, 6, 7, 8]);
  assert.match(built.sql, /ESCAPE '!'/);
  assert.equal(buildNewsSearchPredicate("").sql, null);
  assert.deepEqual(buildNewsSearchPredicate("").params, []);
});

test("exclusions are null-safe across publisher, current translation and source fields", () => {
  const built = buildNewsSearchPredicate('Fed -"press release"');
  assert.deepEqual(built.params, ["%Fed%", "%press release%"]);
  assert.match(built.sql!, /\) AND NOT \(/);
  for (const field of ["i.title", "i.summary", "translation.translated_title", "translation.generated_summary", "i.payload->>'publisher'", "i.payload->>'domain'", "s.name", "canonical_news_publisher_key(i.url,i.payload,s.name)"]) {
    assert.ok(built.sql!.includes(`COALESCE(${field},'') ILIKE $1`), field);
    assert.ok(built.sql!.includes(`COALESCE(${field},'') ILIKE $2`), field);
  }
});
