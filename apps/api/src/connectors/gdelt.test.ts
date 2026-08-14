import assert from "node:assert/strict";
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
  for (const materialDomain of ["energy", "disaster", "shipping", "transport", "logistics", "agriculture", "food", "public health"]) {
    assert.match(DEFAULT_GDELT_DOC_QUERY, new RegExp(materialDomain));
  }
  assert.equal(hasUsableGdeltDocCoverage({ latest_event_time: null }), false);
  assert.equal(hasUsableGdeltDocCoverage({ latest_event_time: "not-a-time" }), false);
  assert.equal(hasUsableGdeltDocCoverage({ latest_event_time: "2026-08-14T09:15:00Z" }), true);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 0, latest_event_time: null }), false);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 1, latest_event_time: "not-a-time" }), false);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 1, latest_event_time: "2026-08-14T09:15:00Z" }), true);
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
