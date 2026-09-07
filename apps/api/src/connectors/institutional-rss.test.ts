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

test("institutional text tolerates malformed numeric entities and strips encoded markup", async () => {
  const { parseInstitutionalFeedItem } = await connector;
  const item = parseInstitutionalFeedItem(`<title>Rates &#x2014; &#9999999999; &#0; &#55296;</title>
    <link>https://www.ecb.europa.eu/news?a=1&amp;b=2</link>
    <description>&lt;p&gt;Inflation &amp; prices&lt;/p&gt;</description>`, "https://www.ecb.europa.eu/rss/press.html");
  assert.equal(item?.title, "Rates — � � �");
  assert.equal(item?.summary, "Inflation & prices");
  assert.equal(item?.url, "https://www.ecb.europa.eu/news?a=1&b=2");
});

test("institutional Atom links choose the article over self feeds and enclosures", async () => {
  const { parseInstitutionalFeedItem } = await connector;
  const item = parseInstitutionalFeedItem(`<title>Policy decision</title>
    <link rel="self" type="application/atom+xml" href="/api/item/123" />
    <link rel="enclosure" href="/recording.mp3" />
    <link href="/news/123" rel="alternate" type="text/html" />
    <published>2026-09-01T09:00:00Z</published>`, "https://www.ecb.europa.eu/rss/press.html");
  assert.equal(item?.url, "https://www.ecb.europa.eu/news/123");
  assert.equal(item?.publishedRaw, "2026-09-01T09:00:00Z");
});

test("institutional article links reject executable schemes and credentials", async () => {
  const { parseInstitutionalFeedItem } = await connector;
  for (const link of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/story", "https://user:secret@example.com/news"]) {
    assert.equal(parseInstitutionalFeedItem(`<title>News</title><link>${link}</link>`, "https://www.ecb.europa.eu/rss/press.html"), null);
  }
});

test("updated-only entries cannot masquerade as newly published news", async () => {
  const { parseInstitutionalFeedItem } = await connector;
  const item = parseInstitutionalFeedItem(`<title>Old policy page</title>
    <link>https://www.ecb.europa.eu/policy</link>
    <updated>2026-09-07T15:00:00Z</updated>`, "https://www.ecb.europa.eu/rss/press.html");
  assert.equal(item?.publishedRaw, null);
});

test("institutional feed parsing bounds records and source text", async () => {
  const { feedItems, parseInstitutionalFeedItem } = await connector;
  assert.equal(feedItems(`<rss>${"<item><title>News</title></item>".repeat(300)}</rss>`).length, 200);
  const item = parseInstitutionalFeedItem(`<title>${"x".repeat(3_000)}</title>
    <link>https://www.ecb.europa.eu/news</link><description>${"y".repeat(20_000)}</description>`, "https://www.ecb.europa.eu/rss/press.html");
  assert.equal(item?.title.length, 2_000);
  assert.equal(item?.summary?.length, 10_000);
  const longIdItem = (suffix: string) => parseInstitutionalFeedItem(`<title>News</title>
    <link>https://www.ecb.europa.eu/news</link><guid>${"x".repeat(3_000)}${suffix}</guid>`, "https://www.ecb.europa.eu/rss/press.html");
  assert.match(longIdItem("a")!.externalId, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(longIdItem("a")!.externalId, longIdItem("b")!.externalId);
});

test("institutional feed downloads cancel oversized chunked bodies", async () => {
  const { readInstitutionalFeed } = await connector;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(1_000_000)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readInstitutionalFeed(new Response(stream)), /size limit/);
  assert.equal(cancelled, true);
  assert.equal(await readInstitutionalFeed(new Response("<rss />")), "<rss />");
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
