import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const connector = import("./govuk-news");

test("GOV.UK search stays bounded to reviewed primary-source document types", async () => {
  const { buildGovUkNewsSearchUrl } = await connector;
  const url = new URL(buildGovUkNewsSearchUrl({
    now: new Date("2026-08-14T10:00:00Z"),
    lookbackHours: 24,
    maxRecords: 999,
  }));

  assert.equal(url.origin + url.pathname, "https://www.gov.uk/api/search.json");
  assert.equal(url.searchParams.get("count"), "250");
  assert.equal(url.searchParams.get("order"), "-public_timestamp");
  assert.equal(url.searchParams.get("filter_public_timestamp"), "from:2026-08-13T10:00:00.000Z");
  assert.deepEqual(
    url.searchParams.getAll("filter_any_content_store_document_type"),
    ["news_story", "press_release", "world_news_story"],
  );
});

test("GOV.UK result preserves publisher, public-time basis and subject country", async () => {
  const { normalizeGovUkNewsResult } = await connector;
  const result = normalizeGovUkNewsResult({
    _id: "/government/news/change-of-british-high-commissioner-to-new-zealand",
    title: "Change of British High Commissioner to New Zealand",
    description: "A new British High Commissioner has been appointed to New Zealand.",
    link: "/government/news/change-of-british-high-commissioner-to-new-zealand",
    public_timestamp: "2024-08-14T06:00:00Z",
    content_store_document_type: "world_news_story",
    organisations: [{ title: "Foreign, Commonwealth & Development Office", acronym: "FCDO", link: "/government/organisations/foreign-commonwealth-development-office" }],
    world_locations: [{ title: "New Zealand", link: "/world/new-zealand/news" }],
  });

  assert.ok(result);
  assert.equal(result.publisher, "Foreign, Commonwealth & Development Office");
  assert.equal(result.countryInference.iso2, "NZ");
  assert.equal(result.eventTime, "2024-08-14T06:00:00.000Z");
  assert.equal(result.url, "https://www.gov.uk/government/news/change-of-british-high-commissioner-to-new-zealand");
});

test("GOV.UK normalization rejects unreviewed types, external links and future timestamps", async () => {
  const { normalizeGovUkNewsResult } = await connector;
  const base = {
    title: "Security update",
    description: "An official update.",
    link: "/government/news/security-update",
    public_timestamp: "2024-08-14T06:00:00Z",
    content_store_document_type: "news_story",
  };

  assert.equal(normalizeGovUkNewsResult({ ...base, content_store_document_type: "guidance" }), null);
  assert.equal(normalizeGovUkNewsResult({ ...base, link: "https://example.com/story" }), null);
  assert.equal(normalizeGovUkNewsResult({ ...base, public_timestamp: "2999-01-01T00:00:00Z" }), null);
});
