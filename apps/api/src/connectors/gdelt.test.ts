import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const connector = import("./gdelt");

test("GDELT timestamp parsing never fabricates current recency", async () => {
  const {
    DEFAULT_GDELT_DOC_QUERY,
    hasUsableGdeltDocCoverage,
    hasUsableGdeltFallbackCoverage,
    parseGdeltTimestamp,
  } = await connector;
  assert.equal(parseGdeltTimestamp("20260814T091500Z"), "2026-08-14T09:15:00Z");
  assert.equal(parseGdeltTimestamp("20260814091500"), "2026-08-14T09:15:00Z");
  assert.equal(parseGdeltTimestamp("not-a-provider-time"), null);
  assert.equal(parseGdeltTimestamp(undefined), null);
  for (const materialDomain of [
    "energy", "disaster", "earthquake", "aftershock", "tsunami", "volcano", "landslide",
    "shipping", "transport", "logistics", "agriculture", "food", "public health",
  ]) {
    assert.match(DEFAULT_GDELT_DOC_QUERY, new RegExp(materialDomain));
  }
  assert.equal(hasUsableGdeltDocCoverage({ latest_event_time: null }), false);
  assert.equal(hasUsableGdeltDocCoverage({ latest_event_time: "not-a-time" }), false);
  assert.equal(hasUsableGdeltDocCoverage({ latest_event_time: "2026-08-14T09:15:00Z" }), true);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 0, latest_event_time: null }), false);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 1, latest_event_time: "not-a-time" }), false);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 1, latest_event_time: "2026-08-14T09:15:00Z" }), true);
});

test("GDELT reserves GAL coverage without exceeding the headline budget", async () => {
  const { planGdeltHeadlineBudgets } = await connector;
  assert.deepEqual(planGdeltHeadlineBudgets(25), { total: 25, doc: 20, galReserve: 5 });
  assert.deepEqual(planGdeltHeadlineBudgets(5), { total: 5, doc: 4, galReserve: 1 });
  assert.deepEqual(planGdeltHeadlineBudgets(4), { total: 4, doc: 4, galReserve: 0 });

  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const ingest = source.slice(source.indexOf("export async function ingestGdelt"), source.indexOf("export async function getGdeltEvents"));
  assert.match(ingest, /coverage_diversity_supplement/);
  assert.match(ingest, /headlineBudgets\.total - doc\.accepted/);
});

test("GDELT DOC candidate selection protects major events and publisher diversity", async () => {
  const { selectGdeltDocCandidates } = await connector;
  const routine = Array.from({ length: 20 }, (_, index) => ({
    title: `Government policy update ${index} for the national parliament`,
    url: `https://routine.example.com/politics/update-${index}`,
    domain: "routine.example.com",
    seendate: `20260816${String(95900 - index * 100).padStart(6, "0")}`,
  }));
  const selected = selectGdeltDocCandidates([
    ...routine,
    {
      title: "Major M7.7 earthquake near Ende Indonesia leaves roads blocked",
      url: "https://disaster.example.com/world/indonesia-earthquake",
      domain: "disaster.example.com",
      seendate: "20260816070000",
    },
    {
      title: "Port transport update after an emergency",
      url: "https://second.example.com/world/port-update",
      domain: "second.example.com",
      seendate: "20260816095830",
    },
  ], { limit: 6, now: new Date("2026-08-16T10:00:00Z") });

  assert.equal(selected.length, 6);
  assert.ok(selected.some((article) => article.url?.includes("indonesia-earthquake")));
  assert.ok(new Set(selected.map((article) => article.domain)).size >= 3);
});

test("GDELT DOC requires a verified, timely publisher date instead of trusting provider discovery time", async () => {
  const { assessGdeltDocArticleQuality, extractGdeltPublisherPublicationTime } = await connector;
  const now = new Date("2026-08-16T03:00:00Z");
  const freshUrl = "https://publisher.example.com/news/2026/08/16/port-disruption";
  const metadataPublication = extractGdeltPublisherPublicationTime(
    `<html><head><meta property="article:published_time" content="2026-08-16T02:31:00Z"></head></html>`,
    freshUrl,
  );
  assert.deepEqual(metadataPublication, {
    publishedAt: "2026-08-16T02:31:00.000Z",
    source: "article_metadata",
    precision: "second",
  });

  assert.equal(assessGdeltDocArticleQuality({
    title: "Port disruption affects regional shipping",
    url: freshUrl,
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: metadataPublication,
    now,
    maxPublisherAgeHours: 72,
    maxProviderSeenAgeHours: 3,
  }).accepted, true);

  const stalePublication = extractGdeltPublisherPublicationTime(
    "",
    "https://publisher.example.com/politics/2021/09/13/old-government-story",
  );
  assert.deepEqual(stalePublication, {
    publishedAt: "2021-09-13T00:00:00.000Z",
    source: "url_date",
    precision: "day",
  });
  assert.equal(assessGdeltDocArticleQuality({
    title: "Historic government announcement is rediscovered",
    url: "https://publisher.example.com/politics/2021/09/13/old-government-story",
    // This deliberately looks current: it models a GDELT rediscovery that
    // used to promote old articles to the top of the product.
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: stalePublication,
    now,
    maxPublisherAgeHours: 72,
    maxProviderSeenAgeHours: 3,
  }).reason, "publisher_published_at_stale");

  assert.equal(assessGdeltDocArticleQuality({
    title: "A current-looking headline without publisher metadata",
    url: "https://publisher.example.com/news/current-story",
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: null,
    now,
    maxPublisherAgeHours: 72,
    maxProviderSeenAgeHours: 3,
  }).reason, "publisher_publication_unverified");
});

test("GDELT source-date extraction chooses the conservative date when metadata conflicts", async () => {
  const { assessGdeltDocArticleQuality, extractGdeltPublisherPublicationTime } = await connector;
  const url = "https://publisher.example.com/world/2023/10/14/old-story-republished";
  const publication = extractGdeltPublisherPublicationTime(
    `<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-08-16T01:00:00Z"}</script>`,
    url,
  );
  // A newer structured date cannot erase an unambiguous older canonical URL
  // date. This errs on the side of hiding a potentially stale resurfacing.
  assert.deepEqual(publication, {
    publishedAt: "2023-10-14T00:00:00.000Z",
    source: "url_date",
    precision: "day",
  });
  assert.equal(assessGdeltDocArticleQuality({
    title: "Old story appears in a new provider batch",
    url,
    providerSeenAt: "2026-08-16T02:00:00Z",
    publication,
    now: new Date("2026-08-16T03:00:00Z"),
    maxPublisherAgeHours: 72,
    maxProviderSeenAgeHours: 3,
  }).accepted, false);
});

test("GDELT rejects impossible publisher calendar dates instead of normalizing them forward", async () => {
  const { extractGdeltPublisherPublicationTime } = await connector;
  assert.equal(extractGdeltPublisherPublicationTime(
    `<meta property="article:published_time" content="2026-02-31T01:00:00Z">`,
    "https://publisher.example.com/news/current-story",
  ), null);
  assert.equal(extractGdeltPublisherPublicationTime(
    "",
    "https://publisher.example.com/news/2026/02/31/current-story",
  ), null);
});

test("GDELT rejects private article addresses and pins publisher verification to public DNS answers", async () => {
  const { assessGdeltDocArticleQuality, isPublicGdeltArticleAddress } = await connector;
  for (const address of ["127.0.0.1", "10.0.0.8", "172.16.0.1", "192.168.1.9", "169.254.169.254", "::1", "[::1]", "fd12::1"]) {
    assert.equal(isPublicGdeltArticleAddress(address), false, address);
  }
  assert.equal(isPublicGdeltArticleAddress("8.8.8.8"), true);
  assert.equal(isPublicGdeltArticleAddress("2606:4700:4700::1111"), true);
  assert.equal(assessGdeltDocArticleQuality({
    title: "A headline that should never trigger an internal request",
    url: "http://127.0.0.1/internal/news",
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: null,
    now: new Date("2026-08-16T03:00:00Z"),
  }).reason, "missing_or_unsafe_url");
  assert.equal(assessGdeltDocArticleQuality({
    title: "An IPv6 loopback headline should also be rejected",
    url: "http://[::1]/internal/news",
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: null,
    now: new Date("2026-08-16T03:00:00Z"),
  }).reason, "missing_or_unsafe_url");

  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const verifier = source.slice(
    source.indexOf("async function requestVerifiedPublisherPage"),
    source.indexOf("async function resolveGdeltPublisherPublicationTime"),
  );
  assert.match(verifier, /resolvePublicArticleAddress/);
  assert.match(verifier, /lookup: \(_hostname, _options, callback\) => callback\(null, address\.address, address\.family\)/);
});

test("a stale GDELT rediscovery quarantines its prior item without rewriting its publication time", async () => {
  const { assessGdeltDocArticleQuality } = await connector;
  const staleRediscovery = assessGdeltDocArticleQuality({
    title: "Previously accepted story is rediscovered years later",
    url: "https://publisher.example.com/news/2021/09/13/previously-accepted-story",
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: {
      publishedAt: "2021-09-13T00:00:00.000Z",
      source: "url_date",
      precision: "day",
    },
    now: new Date("2026-08-16T03:00:00Z"),
    maxPublisherAgeHours: 72,
    maxProviderSeenAgeHours: 3,
  });
  assert.equal(staleRediscovery.reason, "publisher_published_at_stale");

  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const quarantine = source.slice(
    source.indexOf("async function quarantineGdeltArticle"),
    source.indexOf("export function parseGdeltTimestamp"),
  );
  assert.match(quarantine, /'quality_status', 'rejected'/);
  assert.match(quarantine, /'quality_rejection_reason', \$3/);
  assert.doesNotMatch(quarantine, /event_time\s*=/);
});

test("GAL fallback is relevance filtered, deduplicated and bounded", async () => {
  const { parseGdeltGalRss } = await connector;
  const xml = `
    <rss><channel>
      <item><title>Military strike closes port after security attack</title><link>https://news.example.com/world/port-attack</link><pubDate>14 Aug 2026 09:58:00 +0000</pubDate></item>
      <item><title>Port security update</title><link>https://news.example.com/world/port-attack</link><pubDate>14 Aug 2026 09:59:00 +0000</pubDate></item>
      <item><title>Security analyst profile</title><link>https://news.example.com/author/reporter</link><pubDate>14 Aug 2026 09:59:00 +0000</pubDate></item>
      <item><title>Review of a local concert</title><link>https://culture.example.com/reviews/concert</link><pubDate>14 Aug 2026 09:57:00 +0000</pubDate></item>
      <item><title>Government election result</title><link>https://news.example.com/politics/election</link><pubDate>10 Aug 2026 09:57:00 +0000</pubDate></item>
      <item><title>Markets &amp; central bank respond to inflation</title><link>https://finance.example.com/markets/inflation</link><pubDate>14 Aug 2026 09:56:00 +0000</pubDate></item>
    </channel></rss>`;
  const parsed = parseGdeltGalRss(xml, {
    limit: 1,
    now: new Date("2026-08-14T10:00:00Z"),
    maxAgeHours: 48,
  });

  assert.equal(parsed.feed_items, 6);
  assert.equal(parsed.articles.length, 1);
  assert.equal(parsed.articles[0].url, "https://news.example.com/world/port-attack");
  assert.match(parsed.articles[0].title, /Military strike/);
  assert.ok(parsed.skipped >= 4);
});

test("GAL relevance is an admission gate and cannot displace newer headlines", async () => {
  const { parseGdeltGalRss } = await connector;
  const parsed = parseGdeltGalRss(`
    <rss><channel>
      <item><title>Military security attack disrupts shipping port and energy pipeline</title><link>https://old.example.com/world/major-attack</link><pubDate>13 Aug 2026 10:05:00 +0000</pubDate></item>
      <item><title>Port transport update after emergency</title><link>https://current.example.com/news/port-update</link><pubDate>14 Aug 2026 09:55:00 +0000</pubDate></item>
    </channel></rss>`, {
    limit: 1,
    now: new Date("2026-08-14T10:00:00Z"),
    maxAgeHours: 48,
  });

  assert.equal(parsed.articles[0].url, "https://current.example.com/news/port-update");
});

test("GAL selection retains a major disaster inside the current freshness band", async () => {
  const { parseGdeltGalRss } = await connector;
  const routineItems = Array.from({ length: 12 }, (_, index) => `
    <item><title>Government policy update ${index} for the national parliament</title><link>https://routine.example.com/politics/update-${index}</link><pubDate>16 Aug 2026 09:${String(59 - index).padStart(2, "0")}:00 +0000</pubDate></item>
  `).join("");
  const parsed = parseGdeltGalRss(`
    <rss><channel>
      ${routineItems}
      <item><title>Major M7.7 earthquake near Ende Indonesia leaves roads blocked</title><link>https://disaster.example.com/world/indonesia-earthquake</link><pubDate>16 Aug 2026 07:00:00 +0000</pubDate></item>
    </channel></rss>`, {
    limit: 3,
    now: new Date("2026-08-16T10:00:00Z"),
    maxAgeHours: 48,
  });

  assert.equal(parsed.articles[0].url, "https://disaster.example.com/world/indonesia-earthquake");
  assert.ok(parsed.articles[0].materialityScore >= 7);
  assert.ok(parsed.articles.some((article) => article.domain === "routine.example.com"));
});

test("GAL selection prevents one publisher from monopolising a bounded sample", async () => {
  const { parseGdeltGalRss } = await connector;
  const parsed = parseGdeltGalRss(`
    <rss><channel>
      <item><title>Major earthquake warning after severe damage</title><link>https://wire-a.example.com/world/quake-one</link><pubDate>16 Aug 2026 09:59:00 +0000</pubDate></item>
      <item><title>Major earthquake warning after more damage</title><link>https://wire-a.example.com/world/quake-two</link><pubDate>16 Aug 2026 09:58:00 +0000</pubDate></item>
      <item><title>Major earthquake warning as roads are blocked</title><link>https://wire-b.example.com/world/quake-three</link><pubDate>16 Aug 2026 09:57:00 +0000</pubDate></item>
    </channel></rss>`, {
    limit: 2,
    now: new Date("2026-08-16T10:00:00Z"),
  });

  assert.deepEqual(new Set(parsed.articles.map((article) => article.domain)).size, 2);
});

test("GAL fallback accepts only defensibly English headlines and avoids short-stem false positives", async () => {
  const { isLikelyEnglishGalTitle, parseGdeltGalRss } = await connector;
  assert.equal(isLikelyEnglishGalTitle("Port closes after a military strike"), true);
  assert.equal(isLikelyEnglishGalTitle("Esto es lo que gasta el Gobierno"), false);
  assert.equal(isLikelyEnglishGalTitle("Krafttraining: Warum Erholung wichtig ist"), false);

  const parsed = parseGdeltGalRss(`
    <rss><channel>
      <item><title>Esto es lo que gasta el Gobierno</title><link>https://es.example.com/noticias/gasto</link><pubDate>14 Aug 2026 09:59:00 +0000</pubDate></item>
      <item><title>Krafttraining: Warum Trader Pausen brauchen</title><link>https://de.example.com/nachrichten/trader</link><pubDate>14 Aug 2026 09:58:00 +0000</pubDate></item>
      <item><title>Port closes after a military strike</title><link>https://en.example.com/news/port-strike</link><pubDate>14 Aug 2026 09:57:00 +0000</pubDate></item>
    </channel></rss>`, { now: new Date("2026-08-14T10:00:00Z") });

  assert.deepEqual(parsed.articles.map((article) => article.url), ["https://en.example.com/news/port-strike"]);
});

test("GAL parsing cannot be crashed by an invalid numeric XML entity", async () => {
  const { parseGdeltGalRss } = await connector;
  const parsed = parseGdeltGalRss(
    `<rss><channel><item><title>Government security update &#999999999999;</title><link>https://news.example.com/world/security-update</link><pubDate>14 Aug 2026 09:59:00 +0000</pubDate></item></channel></rss>`,
    { now: new Date("2026-08-14T10:00:00Z") },
  );
  assert.equal(parsed.articles.length, 1);
  assert.equal(parsed.articles[0].title, "Government security update");
});
