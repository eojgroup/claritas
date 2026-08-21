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
  const coverageNow = new Date("2026-08-14T10:00:00Z");
  assert.equal(hasUsableGdeltDocCoverage(
    { accepted: 1, latest_event_time: "2026-08-14T09:15:00Z" },
    { now: coverageNow },
  ), true);
  assert.equal(hasUsableGdeltDocCoverage(
    { accepted: 1, latest_event_time: "2026-08-13T09:15:00Z" },
    { now: coverageNow },
  ), false);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 0, latest_event_time: null }), false);
  assert.equal(hasUsableGdeltFallbackCoverage({ selected: 1, latest_event_time: "not-a-time" }), false);
  assert.equal(hasUsableGdeltFallbackCoverage(
    { selected: 1, latest_event_time: "2026-08-14T09:15:00Z" },
    { now: coverageNow },
  ), true);
});

test("GDELT reserves GAL coverage without exceeding the headline budget", async () => {
  const { planGdeltDiscoveryLaneBudgets, planGdeltHeadlineBudgets } = await connector;
  assert.deepEqual(planGdeltHeadlineBudgets(25), { total: 25, doc: 20, galReserve: 5 });
  assert.deepEqual(planGdeltHeadlineBudgets(5), { total: 5, doc: 4, galReserve: 1 });
  assert.deepEqual(planGdeltHeadlineBudgets(4), { total: 4, doc: 4, galReserve: 0 });
  const lanes = planGdeltDiscoveryLaneBudgets(20);
  assert.equal(lanes.reduce((sum, lane) => sum + lane.budget, 0), 20);
  assert.deepEqual(lanes.map((lane) => lane.id), [
    "markets_macro",
    "companies_technology",
    "geopolitics_policy",
    "energy_transport",
    "major_hazards_health",
  ]);
  assert.ok(lanes[0].budget > lanes[4].budget);

  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const ingest = source.slice(source.indexOf("export async function ingestGdelt"), source.indexOf("export async function getGdeltEvents"));
  assert.match(ingest, /coverage_diversity_supplement/);
  assert.match(ingest, /headlineBudgets\.total - doc\.accepted/);
  assert.ok(
    ingest.indexOf("result.gkg_sampled = doc.gkg_sampled")
      < ingest.indexOf("if (!hasUsableGdeltDocCoverage(doc))"),
    "GKG success metrics must survive a DOC-empty/GAL-success fallback",
  );
});

test("GDELT DOC lanes degrade independently behind the shared rate limiter", () => {
  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const ingestDoc = source.slice(
    source.indexOf("async function ingestDocArticles"),
    source.indexOf("export function hasUsableGdeltDocCoverage"),
  );
  assert.match(ingestDoc, /for \(const lane of laneBudgets\)/);
  assert.match(ingestDoc, /const response = await fetchRetry\(apiUrl\.toString\(\)\)/);
  assert.match(ingestDoc, /status: "failed"/);
  assert.match(ingestDoc, /if \(!discoveryLanes\.some\(\(lane\) => lane\.status === "healthy"\)\)/);
  assert.match(ingestDoc, /\(acceptedByLane\.get\(laneId\) \?\? 0\) >= laneBudget/);
  assert.match(ingestDoc, /const allowProviderFirstSeen = !params\.targetedDiscovery/);
  assert.match(source, /hostname === "api\.gdeltproject\.org"[\s\S]*withGdeltDocRateLimit\(request\)/);
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

test("GDELT canonical URLs deduplicate trackers while retaining the legacy alias", async () => {
  const { selectGdeltDocCandidates } = await connector;
  const selected = selectGdeltDocCandidates([
    {
      title: "Singapore stocks rally after the central bank decision",
      url: "https://finance.example.com/markets/story?utm_source=wire&edition=asia",
      seendate: "20260821094500",
    },
    {
      title: "Singapore stocks rally after the central bank decision",
      url: "https://finance.example.com/markets/story?edition=asia&utm_campaign=repeat",
      seendate: "20260821095000",
    },
  ], { now: new Date("2026-08-21T10:00:00Z"), limit: 5 });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].url, "https://finance.example.com/markets/story?edition=asia");
  assert.match(selected[0].raw_url ?? "", /utm_campaign=repeat/);
});

test("GDELT canonical rediscovery retains the earliest trusted alias history", async () => {
  const { mergeGdeltAliasTemporalEvidence, planGdeltAliasPersistence } = await connector;
  const canonicalUrl = "https://finance.example.com/markets/story?edition=asia";
  const legacyUrl = `${canonicalUrl}&utm_source=wire`;
  const legacy = {
    external_id: legacyUrl,
    url: legacyUrl,
    dedupe_hash: null,
    first_provider_seen_at: "2026-08-18T08:00:00Z",
    quality_status: "accepted",
    time_basis: "publisher_published_verified",
    publication_time_verified: true,
    publisher_published_at: "2026-08-18T07:45:00Z",
    publication_time_source: "article_metadata",
    time_precision: "second",
    event_time: "2026-08-18T07:45:00Z",
    country_iso2: "SG",
    country_attribution: "article_structured_location",
    country_inference_source: "article_structured_location",
    country_inference_confidence: "high",
    country_inference: { source: "article_structured_location", confidence: "high" },
    subject_country_iso2s: ["SG"],
    gkg: null,
  };
  const aliasHistory = planGdeltAliasPersistence(canonicalUrl, [legacy]);
  const temporal = mergeGdeltAliasTemporalEvidence(aliasHistory, {
    eventTime: "2026-08-21T09:45:00Z",
    timeBasis: "publisher_published_verified",
    publication: {
      publishedAt: "2026-08-21T09:45:00Z",
      source: "article_metadata",
      precision: "second",
    },
    providerSeenAt: "2026-08-21T10:00:00Z",
  });

  assert.equal(aliasHistory.persistenceExternalId, legacyUrl);
  assert.equal(temporal.eventTime, "2026-08-18T07:45:00.000Z");
  assert.equal(temporal.publisherPublishedAt, "2026-08-18T07:45:00.000Z");
  assert.equal(temporal.firstProviderSeenAt, "2026-08-18T08:00:00.000Z");
  assert.equal(aliasHistory.countryIso2, "SG");

  const canonicalRow = {
    ...legacy,
    external_id: canonicalUrl,
    url: canonicalUrl,
    first_provider_seen_at: "2026-08-19T08:00:00Z",
    publisher_published_at: "2026-08-19T07:45:00Z",
    event_time: "2026-08-19T07:45:00Z",
  };
  const twoAliasHistory = planGdeltAliasPersistence(canonicalUrl, [canonicalRow, legacy]);
  assert.equal(twoAliasHistory.persistenceExternalId, canonicalUrl);
  assert.equal(twoAliasHistory.verifiedPublication?.publishedAt, "2026-08-18T07:45:00.000Z");
});

test("GDELT canonical history uses the runtime WHATWG URL semantics exactly", async () => {
  const { canonicalGdeltUrl, GDELT_CANONICAL_URL_ALGORITHM } = await connector;
  assert.equal(GDELT_CANONICAL_URL_ALGORITHM, "whatwg-url-v1");
  assert.equal(
    canonicalGdeltUrl(
      "HTTPS://Bücher.Example:443/a/../markets/%7Estory?z=last&utm_source=wire&a=hello world&fbclid=x&a=again#section",
    ),
    "https://xn--bcher-kva.example/markets/%7Estory?a=hello+world&a=again&z=last",
  );
  assert.equal(
    canonicalGdeltUrl("http://Example.COM:80/news/./story?B=2&a=1&utm_medium=rss"),
    "http://example.com/news/story?B=2&a=1",
  );
  assert.equal(
    canonicalGdeltUrl("https://example.com/news?utm_source=x&utm_source=y"),
    "https://example.com/news",
  );
  assert.equal(canonicalGdeltUrl("https://user:secret@example.com/news/story"), null);
  assert.equal(canonicalGdeltUrl("http://127.0.0.1/news/story"), null);
  assert.equal(canonicalGdeltUrl("not a URL"), null);
});

test("GKG enrichment scans the full archive and joins tracking URL variants", async () => {
  const { selectGdeltGkgCountryProbeLine, selectGdeltGkgRowsForUrls } = await connector;
  const row = (id: string, url: string, locations = "") => {
    const fields = Array.from({ length: 27 }, () => "");
    fields[0] = id;
    fields[1] = "20260821094500";
    fields[3] = "finance.example.com";
    fields[4] = url;
    fields[10] = locations;
    return fields.join("\t");
  };
  const archive = [
    ...Array.from({ length: 250 }, (_, index) => row(`noise-${index}`, `https://noise.example.com/news/${index}`)),
    row("target", "https://finance.example.com/markets/story?utm_source=gdelt&edition=asia"),
  ].join("\n");

  const matches = selectGdeltGkgRowsForUrls(
    archive,
    ["https://finance.example.com/markets/story?edition=asia"],
  );
  assert.equal(matches.length, 1);
  assert.match(matches[0], /^target\t/);

  const countryProbe = row(
    "country-probe",
    "HTTPS://Bücher.Example:443/a/../markets/story?utm_source=gkg",
    "1#Singapore#SN#00#1.29#103.85#SG",
  );
  const probeArchive = [
    ...Array.from({ length: 750 }, (_, index) => row(`no-location-${index}`, `https://noise.example.com/${index}`)),
    countryProbe,
  ].join("\n");
  assert.equal(selectGdeltGkgCountryProbeLine(probeArchive), countryProbe);
});

test("GKG article-country health counts only accepted persisted canonical URLs", async () => {
  const { countAcceptedGdeltGkgCountryMatches } = await connector;
  const countryMatch = "https://finance.example.com/markets/story?edition=asia&utm_source=gkg";
  assert.equal(
    countAcceptedGdeltGkgCountryMatches([], [countryMatch]),
    0,
    "a country-bearing GKG row for a rejected-only DOC candidate must not make article linkage healthy",
  );
  assert.equal(
    countAcceptedGdeltGkgCountryMatches(
      ["https://finance.example.com/markets/story?edition=asia"],
      [countryMatch, countryMatch],
    ),
    1,
  );

  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const docIngest = source.slice(
    source.indexOf("async function ingestDocArticles"),
    source.indexOf("export function hasUsableGdeltDocCoverage"),
  );
  assert.ok(docIngest.indexOf("const result = await query") < docIngest.indexOf("acceptedPersistedUrls.add(url)"));
  assert.match(docIngest, /gkg_canonical_country_url_probes: gkg\.canonicalCountryUrls\.length/);
  assert.match(source, /canonicalCountryUrls\.add\(url\)/);
});

test("GKG enrichment covers every 15-minute archive in the supported DOC window", async () => {
  const { gdeltGkgWindowUrls } = await connector;
  const latest = "https://storage.example/gdeltv2/20260821094500.gkg.csv.zip";
  assert.deepEqual(gdeltGkgWindowUrls(latest, "1h"), [
    "https://storage.example/gdeltv2/20260821094500.gkg.csv.zip",
    "https://storage.example/gdeltv2/20260821093000.gkg.csv.zip",
    "https://storage.example/gdeltv2/20260821091500.gkg.csv.zip",
    "https://storage.example/gdeltv2/20260821090000.gkg.csv.zip",
  ]);
  assert.deepEqual(
    gdeltGkgWindowUrls("https://storage.example/gdeltv2/20260821000000.gkg.csv.zip", "1h"),
    [
      "https://storage.example/gdeltv2/20260821000000.gkg.csv.zip",
      "https://storage.example/gdeltv2/20260820234500.gkg.csv.zip",
      "https://storage.example/gdeltv2/20260820233000.gkg.csv.zip",
      "https://storage.example/gdeltv2/20260820231500.gkg.csv.zip",
    ],
  );
});

test("raw GDELT archive failures are isolated from DOC and GAL acquisition", () => {
  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const ingest = source.slice(
    source.indexOf("export async function ingestGdelt"),
    source.indexOf("export async function getGdeltEvents"),
  );
  const beforeDoc = ingest.slice(0, ingest.indexOf("if (includeDoc)"));
  assert.match(beforeDoc, /getLatestArchiveUrls\(\)\.then/);
  assert.doesNotMatch(beforeDoc, /await getLatestArchiveUrls\(\)/);
  assert.match(ingest, /event_archive_error/);
  assert.match(ingest, /raw_archive_status = "degraded"/);
  assert.ok(ingest.indexOf("if (includeDoc)") < ingest.indexOf("const event = await eventArchive"));
});

test("GDELT URL reconciliation repairs complete item and signal history in bounded transactions", () => {
  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const migration = readFileSync(resolve(
    __dirname,
    "../../../../infra/gcp/sql/V52__balanced_news_discovery.sql",
  ), "utf8");
  const indexMigration = readFileSync(resolve(
    __dirname,
    "../../../../infra/gcp/sql/V53__balanced_news_indexes.sql",
  ), "utf8");
  const reconciliation = source.slice(
    source.indexOf("async function reconcileGdeltCanonicalBatch"),
    source.indexOf("export function parseGdeltTimestamp"),
  );
  assert.match(reconciliation, /canonicalGdeltUrl\(row\.url\) \?\? canonicalGdeltUrl\(row\.external_id\)/);
  assert.match(reconciliation, /pg_advisory_xact_lock/);
  assert.match(reconciliation, /INSERT INTO source_feed/);
  assert.match(reconciliation, /SELECT cursor FROM source_feed[\s\S]*FOR UPDATE/);
  assert.match(reconciliation, /FROM item[\s\S]*canonical_url_algorithm'[\s\S]*id>\$3::bigint[\s\S]*ORDER BY id[\s\S]*LIMIT \$4/);
  assert.match(reconciliation, /FROM news_signal[\s\S]*canonical_url_algorithm'[\s\S]*id>\$3::bigint[\s\S]*ORDER BY id[\s\S]*LIMIT \$4/);
  assert.match(reconciliation, /item_complete: itemComplete/);
  assert.match(reconciliation, /signal_complete: signalComplete/);
  assert.match(reconciliation, /GDELT_SIGNAL_CANONICAL_RECONCILIATION_BATCHES/);
  assert.match(reconciliation, /while \(true\)[\s\S]*step\.itemComplete/);
  assert.match(reconciliation, /if \(!reconciliation\.itemComplete\)[\s\S]*throw new Error/);
  assert.match(reconciliation, /gdelt_signal_canonical_reconciliation_degraded/);
  assert.match(reconciliation, /claritas\.preserve_updated_at/);
  assert.match(reconciliation, /claritas\.suppress_item_outbox/);
  assert.match(reconciliation, /raw_url: rawUrl/);
  assert.match(reconciliation, /payload->>'canonical_url'=ANY\(\$3::text\[\]\)/);
  assert.doesNotMatch(reconciliation, /LIMIT\s+5000/i);
  assert.doesNotMatch(reconciliation, /interval '90 days'/);
  assert.doesNotMatch(migration, /canonical_gdelt_article_url/);
  assert.match(indexMigration, /item_gdelt_canonical_reconciliation_idx/);
  assert.match(indexMigration, /news_signal_gdelt_canonical_reconciliation_idx/);
  assert.match(indexMigration, /IS DISTINCT FROM 'whatwg-url-v1'/);
  assert.match(source, /canonical_url: url/);
  assert.match(source, /canonical_url: article\.url/);
  assert.match(source, /canonical_url_algorithm: GDELT_CANONICAL_URL_ALGORITHM/);
  assert.match(source, /raw_url: rawUrl/);
  assert.match(source, /'canonical_url',\$7/);
  const itemGate = source.slice(
    source.indexOf("async function requireGdeltCanonicalItemHistory"),
    source.indexOf("function existingGdeltPreference"),
  );
  assert.match(itemGate, /reconciliation\.itemComplete/);
  assert.doesNotMatch(itemGate, /signalComplete/);
  const docJoin = source.slice(
    source.indexOf("// Current-window GKG rows were canonicalized before persistence."),
    source.indexOf("const verificationNow", source.indexOf("// Current-window GKG rows were canonicalized before persistence.")),
  );
  const gateIndex = docJoin.indexOf("await requireGdeltCanonicalItemHistory(sourceId)");
  const joinIndex = docJoin.indexOf("FROM news_signal WHERE url = ANY");
  assert.ok(gateIndex >= 0);
  assert.ok(joinIndex >= 0);
  assert.ok(
    gateIndex < joinIndex,
  );
});

test("GDELT conflict updates retain trusted country evidence through a transient GKG miss", () => {
  const source = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const merge = source.slice(
    source.indexOf("const MERGED_GDELT_COUNTRY_SQL"),
    source.indexOf("function canonicalGdeltUrl"),
  );
  assert.match(merge, /trustedNewsDirectCountrySql\("item"\)/);
  assert.match(merge, /'country_attribution',CASE[\s\S]*EXCLUDED\.country_iso2 IS NOT NULL[\s\S]*item\.payload->>'country_attribution'/);
  assert.match(merge, /'country_inference',CASE[\s\S]*item\.payload->'country_inference'/);
  assert.match(
    merge,
    /'gkg',COALESCE\([\s\S]*NULLIF\(EXCLUDED\.payload->'gkg','null'::jsonb\)[\s\S]*NULLIF\(item\.payload->'gkg','null'::jsonb\)/,
  );
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

  const transparentDiscovery = assessGdeltDocArticleQuality({
    title: "A current-looking headline without publisher metadata",
    url: "https://publisher.example.com/news/current-story",
    providerSeenAt: "2026-08-16T02:45:00Z",
    publication: null,
    now,
    maxPublisherAgeHours: 72,
    maxProviderSeenAgeHours: 3,
    allowProviderFirstSeen: true,
  });
  assert.equal(transparentDiscovery.reason, "accepted_provider_first_seen");
  assert.equal(transparentDiscovery.effectiveTime, "2026-08-16T02:45:00.000Z");
  assert.equal(transparentDiscovery.timeBasis, "provider_first_seen");
  assert.equal(transparentDiscovery.publication, null);
});

test("publisher metadata supplies bounded country context without parsing article body", async () => {
  const { extractGdeltPublisherContext } = await connector;
  const context = extractGdeltPublisherContext(`
    <html><head>
      <meta property="og:description" content="Singapore stocks rose after the central bank decision.">
      <meta name="keywords" content="STI, Singapore, equities">
      <script type="application/ld+json">{"@type":"NewsArticle","contentLocation":{"address":{"addressCountry":"SG"}}}</script>
    </head><body><p>Article body should not be retained.</p></body></html>
  `);
  assert.equal(context.description, "Singapore stocks rose after the central bank decision.");
  assert.ok(context.keywords.includes("singapore"));
  assert.ok(context.keywords.includes("sg"));
  assert.ok(!context.keywords.some((value) => value.includes("article body")));
});

test("publisher JSON-LD geography cannot become article subject geography", async () => {
  const { extractGdeltPublisherContext } = await connector;
  const context = extractGdeltPublisherContext(`
    <script type="application/ld+json">{
      "@context":"https://schema.org",
      "@graph":[
        {"@type":"NewsArticle","description":"Singapore shares rally after a central bank decision","contentLocation":{"@type":"Place","addressCountry":"SG"}},
        {"@type":"Organization","name":"British Publisher","description":"London and UK reporting","address":{"addressCountry":"GB"},"about":{"@type":"Place","name":"United Kingdom","addressCountry":"GB"}}
      ]
    }</script>
  `);
  assert.match(context.description ?? "", /Singapore shares/i);
  assert.ok(context.keywords.includes("singapore"));
  assert.ok(!context.keywords.includes("gb"));
  assert.ok(!context.keywords.includes("united kingdom"));
  assert.ok(!context.keywords.some((value: string) => /london|british publisher|uk reporting/i.test(value)));
});

test("article-owned JSON-LD Place names and nested addresses retain subject geography", async () => {
  const { extractGdeltPublisherContext, resolveGdeltArticleSubject } = await connector;
  const context = extractGdeltPublisherContext(`
    <script type="application/ld+json">{
      "@context":"https://schema.org",
      "@graph":[
        {
          "@type":"NewsArticle",
          "description":"Equity markets react to the monetary policy decision",
          "about":{"@type":"Place","name":"Singapore","address":{"addressCountry":"SG"}}
        },
        {
          "@type":"Organization",
          "name":"British Publisher",
          "about":{"@type":"Place","name":"United Kingdom","address":{"addressCountry":"GB"}}
        }
      ]
    }</script>
  `);
  assert.match(context.description ?? "", /Equity markets/i);
  assert.ok(context.keywords.includes("singapore"));
  assert.ok(context.keywords.includes("sg"));
  assert.deepEqual(context.structuredCountryIso2s, ["SG"]);
  assert.ok(!context.keywords.includes("united kingdom"));
  assert.ok(!context.keywords.includes("gb"));
  const subject = resolveGdeltArticleSubject({
    title: "Equity markets react to the monetary policy decision",
    url: "https://publisher.example/markets/decision",
    context,
  });
  assert.equal(subject.countryIso2, "SG");
  assert.equal(subject.countryAttribution, "article_structured_location");
  assert.deepEqual(subject.subjectCountryIso2s, ["SG"]);
});

test("an Organization in NewsArticle about cannot override headline country context", async () => {
  const { extractGdeltPublisherContext, resolveGdeltArticleSubject } = await connector;
  const context = extractGdeltPublisherContext(`
    <script type="application/ld+json">{
      "@type":"NewsArticle",
      "about":{"@type":"Organization","name":"Acme","address":{"addressCountry":"US"}}
    }</script>
  `);
  const subject = resolveGdeltArticleSubject({
    title: "Singapore operations expand after major investment decision",
    url: "https://publisher.example/companies/acme-expansion",
    context,
  });
  assert.deepEqual(context.structuredCountryIso2s, []);
  assert.equal(subject.countryIso2, "SG");
  assert.equal(subject.countryAttribution, "content_alias");
});

test("typed WebPage JSON-LD discovers its article without importing publisher siblings", async () => {
  const {
    extractGdeltPublisherContext,
    extractGdeltPublisherPublicationTime,
  } = await connector;
  const html = `
    <script type="application/ld+json">{
      "@type":"WebPage",
      "mainEntity":{
        "@type":"NewsArticle",
        "datePublished":"2026-08-21T18:00:00Z",
        "description":"Singapore shares rally after the central bank decision",
        "about":{"@type":"Place","addressCountry":"SG"}
      },
      "publisher":{
        "@type":"Organization",
        "description":"British publisher based in London",
        "address":{"addressCountry":"GB"},
        "dateCreated":"1998-01-01"
      }
    }</script>`;

  assert.equal(
    extractGdeltPublisherPublicationTime(
      html,
      "https://publisher.example/news/singapore-market-story",
    )?.publishedAt,
    "2026-08-21T18:00:00.000Z",
  );
  const context = extractGdeltPublisherContext(html);
  assert.match(context.description ?? "", /Singapore shares/i);
  assert.ok(context.keywords.includes("sg"));
  assert.ok(!context.keywords.includes("gb"));
  assert.ok(!context.keywords.some((value) => /british publisher|london/i.test(value)));
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

test("JSON-LD publisher creation dates cannot make a current article stale", async () => {
  const { extractGdeltPublisherPublicationTime } = await connector;
  const publication = extractGdeltPublisherPublicationTime(`
    <script type="application/ld+json">{
      "@graph":[
        {"@type":"NewsArticle","datePublished":"2026-08-21T09:45:00Z"},
        {"@type":"Organization","name":"Publisher","dateCreated":"1998-01-01"}
      ]
    }</script>
  `, "https://publisher.example/news/current-market-story");
  assert.equal(publication?.publishedAt, "2026-08-21T09:45:00.000Z");
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
    source.indexOf("const EXISTING_GDELT_TIME_VERIFIED_SQL"),
  );
  assert.match(quarantine, /'quality_status', 'rejected'/);
  assert.match(quarantine, /'quality_rejection_reason', \$4/);
  assert.match(quarantine, /INSERT INTO item[\s\S]*event_time/);
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

  assert.ok(parsed.articles.some((article) =>
    article.url === "https://disaster.example.com/world/indonesia-earthquake"
    && article.materialityScore >= 7
  ));
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
