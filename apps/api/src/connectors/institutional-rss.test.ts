import assert from "node:assert/strict";
import test from "node:test";
import { inferNewsCountry } from "./country-inference";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const connector = import("./institutional-rss");

test("institutional feed registry contains only reviewed, attributed feeds", async () => {
  const { INSTITUTIONAL_RSS_FEEDS } = await connector;
  const ids = INSTITUTIONAL_RSS_FEEDS.map((feed) => feed.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("federal_reserve_press_releases"));
  assert.ok(ids.includes("bls_employment_situation"));
  assert.ok(ids.includes("bls_consumer_price_index"));
  assert.ok(ids.includes("ecb_press_releases"));
  assert.ok(ids.includes("ecb_statistical_press_releases"));

  for (const feed of INSTITUTIONAL_RSS_FEEDS) {
    assert.match(feed.url, /^https:\/\//);
    assert.match(feed.homepage, /^https:\/\//);
    assert.match(feed.licenseUrl, /^https:\/\//);
    assert.ok(feed.publisher.length > 0);
    assert.ok(feed.attribution.length > 0);
    assert.ok(feed.license.length > 0);
    assert.ok(feed.topics.length > 0);
  }
});

test("RSS and Atom entries use the same bounded parser", async () => {
  const { feedItems } = await connector;
  const rss = feedItems("<rss><channel><item><title>A</title></item><item><title>B</title></item></channel></rss>");
  const atom = feedItems("<feed><entry><title>C</title></entry></feed>");

  assert.equal(rss.length, 2);
  assert.match(rss[0], /<title>A<\/title>/);
  assert.equal(atom.length, 1);
  assert.match(atom[0], /<title>C<\/title>/);
});

test("institutional publication time rejects invalid and future feed dates", async () => {
  const { parseInstitutionalPublicationTime } = await connector;
  const now = Date.parse("2026-08-21T12:00:00.000Z");

  assert.equal(
    parseInstitutionalPublicationTime("Fri, 21 Aug 2026 11:55:00 GMT", now),
    "2026-08-21T11:55:00.000Z",
  );
  assert.equal(parseInstitutionalPublicationTime("not-a-date", now), null);
  assert.equal(parseInstitutionalPublicationTime("2026-08-21T12:05:01.000Z", now), null);
});

test("reviewed institutional jurisdiction is subject context, while explicit content remains primary", async () => {
  const { institutionalSubjectGeography } = await connector;
  const feedOnly = inferNewsCountry({
    title: "Quarterly enforcement update",
    feedCountryHint: "US",
  });
  assert.deepEqual(institutionalSubjectGeography(feedOnly, "US"), {
    primary: "US",
    countries: ["US"],
    attribution: "institutional_jurisdiction",
  });

  const international = inferNewsCountry({
    title: "SEC charges Singapore issuer after market disclosure failures",
    feedCountryHint: "US",
  });
  assert.deepEqual(institutionalSubjectGeography(international, "US"), {
    primary: "SG",
    countries: ["SG", "US"],
    attribution: "content_alias",
  });
});
