import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const discovery = import("./event-news-discovery");
const gdelt = import("./gdelt");

test("targeted earthquake search anchors the Yanglong event without query injection", async () => {
  const {
    buildEarthquakeGdeltQuery,
    earthquakeCountryIso2FromPlace,
    earthquakePlaceAnchor,
  } = await discovery;
  assert.equal(earthquakeCountryIso2FromPlace("270 km WSW of Yanglong, China"), "CN");
  assert.equal(earthquakePlaceAnchor("270 km WSW of Yanglong, China"), "Yanglong");
  const usgsEventId = "us6000tlrj";
  assert.deepEqual(buildEarthquakeGdeltQuery({
    place: "270 km WSW of Yanglong, China",
    countryIso2: "CN",
  }), {
    query: "(earthquake OR quake OR aftershock OR seismic OR tremor OR tsunami) (\"Yanglong\" OR \"China\")",
    anchorTerms: ["Yanglong", "China"],
  });
  assert.equal(usgsEventId, "us6000tlrj");

  const hostile = buildEarthquakeGdeltQuery({
    place: "12 km E of Testville\") OR (markets, China",
    countryIso2: "CN",
  });
  assert.equal(hostile.anchorTerms[0], "Testville OR markets");
  assert.match(hostile.query, /\("Testville OR markets" OR "China"\)$/);
});

test("targeted discovery includes M5.9 events and remains bounded", async () => {
  const {
    earthquakeNewsDiscoveryRevisionChanged,
    isRetryableEarthquakeNewsDiscoveryError,
    nextEarthquakeNewsDiscoveryState,
    qualifiesForEarthquakeNewsDiscovery,
    targetedDiscoveryResultHasLikelyCoverage,
  } = await discovery;
  assert.equal(qualifiesForEarthquakeNewsDiscovery({
    magnitude: 5.9,
    significance: 550,
    tsunami: false,
    place: "270 km WSW of Yanglong, China",
  }), true);
  assert.equal(qualifiesForEarthquakeNewsDiscovery({
    magnitude: 5.4,
    significance: 300,
    tsunami: false,
    place: "Remote region",
  }), false);
  assert.equal(qualifiesForEarthquakeNewsDiscovery({
    magnitude: 4.8,
    significance: 300,
    tsunami: true,
    place: "Coastal region",
  }), true);

  const observedAt = new Date("2026-08-19T08:00:00Z");
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 1,
    maxAttempts: 4,
    observedAt,
    now: new Date("2026-08-19T08:01:00Z"),
    failed: false,
  }), { status: "retry", retryAfterMinutes: 15 });
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 1,
    maxAttempts: 4,
    observedAt,
    now: new Date("2026-08-19T08:01:00Z"),
    failed: false,
    coverageFound: true,
  }), { status: "retry", retryAfterMinutes: 15 });
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 4,
    maxAttempts: 4,
    observedAt,
    now: new Date("2026-08-19T09:00:00Z"),
    failed: false,
  }), { status: "completed", retryAfterMinutes: null });
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 4,
    maxAttempts: 4,
    observedAt,
    now: new Date("2026-08-19T09:00:00Z"),
    failed: true,
  }), { status: "dead_letter", retryAfterMinutes: null });

  assert.equal(isRetryableEarthquakeNewsDiscoveryError(new Error("GDELT HTTP 429 for query")), true);
  assert.equal(isRetryableEarthquakeNewsDiscoveryError(new Error("GDELT HTTP 503 for query")), true);
  assert.equal(isRetryableEarthquakeNewsDiscoveryError(new Error("GDELT HTTP 400 for query")), false);
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 1,
    maxAttempts: 4,
    observedAt,
    now: new Date("2026-08-19T08:01:00Z"),
    failed: isRetryableEarthquakeNewsDiscoveryError(new Error("GDELT HTTP 429 for query")),
  }), { status: "retry", retryAfterMinutes: 15 });
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 4,
    maxAttempts: 4,
    observedAt,
    now: new Date("2026-08-19T09:00:00Z"),
    failed: isRetryableEarthquakeNewsDiscoveryError(new Error("GDELT HTTP 429 for query")),
  }), { status: "dead_letter", retryAfterMinutes: null });
  assert.equal(earthquakeNewsDiscoveryRevisionChanged(
    "2026-08-19T08:01:00Z",
    "2026-08-19T08:01:00Z",
  ), false);
  assert.equal(earthquakeNewsDiscoveryRevisionChanged(
    "2026-08-19T08:01:00Z",
    "2026-08-19T08:02:00Z",
  ), true);
  assert.equal(targetedDiscoveryResultHasLikelyCoverage({ accepted: 4, link_eligible: 0 }), false);
  assert.equal(targetedDiscoveryResultHasLikelyCoverage({ accepted: 2, link_eligible: 1 }), true);
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 5,
    maxAttempts: 6,
    observedAt,
    now: new Date("2026-08-19T20:00:00Z"),
    failed: false,
    coverageFound: true,
  }), { status: "retry", retryAfterMinutes: 720 });
  assert.deepEqual(nextEarthquakeNewsDiscoveryState({
    attempts: 6,
    maxAttempts: 6,
    observedAt,
    now: new Date("2026-08-20T05:00:00Z"),
    failed: false,
    coverageFound: true,
  }), { status: "completed", retryAfterMinutes: null });
});

test("targeted match metadata is explainable and does not claim impact", async () => {
  const {
    describeTargetedGdeltMatch,
    eligibleTargetedGdeltCountryFallback,
    targetedGdeltPublicationIsTimely,
  } = await gdelt;
  const context = {
    earthquakeObservationId: "11111111-1111-4111-8111-111111111111",
    usgsEventId: "us7000-test",
    place: "270 km WSW of Yanglong, China",
    countryIso2: "CN",
    magnitude: 5.9,
    latitude: 35.1,
    longitude: 82.2,
    observedAt: "2026-08-19T08:00:00.000Z",
    query: "targeted-query",
    anchorTerms: ["Yanglong", "China"],
  };
  const local = describeTargetedGdeltMatch({
    title: "M5.9 earthquake reported west of Yanglong in China",
  }, context);
  assert.equal(local.scope, "local_place");
  assert.equal(local.confidence, 0.9);
  assert.equal(local.link_eligible, true);
  assert.match(local.rationale, /local place/i);
  assert.match(local.assessment_boundary, /does not prove/i);

  const fullTextOnly = describeTargetedGdeltMatch({
    title: "Emergency officials issue a regional update",
  }, context);
  assert.equal(fullTextOnly.scope, "full_text_query");
  assert.equal(fullTextOnly.link_eligible, false);
  assert.ok(fullTextOnly.confidence < local.confidence);

  const countryOnly = describeTargetedGdeltMatch({
    title: "Magnitude 6.8 earthquake strikes Sichuan, China",
  }, context);
  assert.equal(countryOnly.scope, "country");
  assert.equal(countryOnly.link_eligible, false);
  assert.equal(eligibleTargetedGdeltCountryFallback(countryOnly, "CN"), null);

  const ambiguousSameCountryQuake = describeTargetedGdeltMatch({
    title: "Magnitude 6.0 earthquake strikes Sichuan, China",
  }, context);
  assert.equal(ambiguousSameCountryQuake.scope, "country");
  assert.equal(ambiguousSameCountryQuake.link_eligible, false);
  assert.equal(eligibleTargetedGdeltCountryFallback(ambiguousSameCountryQuake, "CN"), null);

  const signature = describeTargetedGdeltMatch({
    title: "Magnitude 5.9 earthquake strikes western China",
  }, context);
  assert.equal(signature.scope, "event_signature");
  assert.equal(signature.link_eligible, true);
  assert.equal(eligibleTargetedGdeltCountryFallback(signature, "CN"), "CN");

  const provinceSignature = describeTargetedGdeltMatch({
    title: "Magnitude 5.9 earthquake strikes Qinghai",
  }, context);
  assert.equal(provinceSignature.scope, "event_signature");
  assert.equal(provinceSignature.link_eligible, true);
  assert.ok(provinceSignature.confidence < local.confidence);

  const chineseProvinceSignature = describeTargetedGdeltMatch({
    title: "青海发生5.9级地震",
  }, context);
  assert.equal(chineseProvinceSignature.scope, "event_signature");
  assert.equal(chineseProvinceSignature.link_eligible, true);
  assert.ok(chineseProvinceSignature.factors.some((factor) => /earthquake terminology/.test(factor)));

  const localizedDecimalSignature = describeTargetedGdeltMatch({
    title: "Séisme de magnitude 5,9 dans l'ouest de la Chine",
  }, context);
  assert.equal(localizedDecimalSignature.scope, "event_signature");
  assert.equal(localizedDecimalSignature.link_eligible, true);

  const chineseCountrySignature = describeTargetedGdeltMatch({
    title: "中国发生5.9级地震",
  }, context);
  assert.equal(chineseCountrySignature.scope, "event_signature");
  assert.equal(chineseCountrySignature.link_eligible, true);

  const sameMagnitudeWrongCountry = describeTargetedGdeltMatch({
    title: "Magnitude 5.9 earthquake strikes Japan",
  }, context);
  assert.equal(sameMagnitudeWrongCountry.scope, "full_text_query");
  assert.equal(sameMagnitudeWrongCountry.link_eligible, false);
  assert.equal(eligibleTargetedGdeltCountryFallback(sameMagnitudeWrongCountry, "CN"), null);

  const japaneseSameMagnitude = describeTargetedGdeltMatch({
    title: "日本で5.9級の地震が発生",
  }, context);
  assert.equal(japaneseSameMagnitude.scope, "full_text_query");
  assert.equal(japaneseSameMagnitude.link_eligible, false);

  assert.equal(targetedGdeltPublicationIsTimely("2026-08-19T02:00:00Z", context), true);
  assert.equal(targetedGdeltPublicationIsTimely("2026-08-19T01:59:59Z", context), false);
  assert.equal(targetedGdeltPublicationIsTimely("2026-08-22T08:00:00Z", context), true);
  assert.equal(targetedGdeltPublicationIsTimely("2026-08-22T08:00:01Z", context), false);
});

test("targeted candidate selection prioritizes local and event-signature matches", async () => {
  const { selectTargetedGdeltDocCandidates } = await gdelt;
  const context = {
    earthquakeObservationId: "11111111-1111-4111-8111-111111111111",
    usgsEventId: "us6000tlrj",
    place: "270 km WSW of Yanglong, China",
    countryIso2: "CN",
    magnitude: 5.9,
    latitude: 35.1,
    longitude: 82.2,
    observedAt: "2026-08-19T08:00:00.000Z",
    query: "targeted-query",
    anchorTerms: ["Yanglong", "China"],
  };
  const selected = selectTargetedGdeltDocCandidates([
    {
      title: "Magnitude 6.0 earthquake strikes Sichuan, China",
      url: "https://broad.example.com/news/other-china-quake",
      domain: "broad.example.com",
      seendate: "20260819T085900Z",
    },
    {
      title: "M5.9 earthquake reported west of Yanglong in China",
      url: "https://local.example.com/news/yanglong-quake",
      domain: "local.example.com",
      seendate: "20260819T084500Z",
    },
    {
      title: "Magnitude 5.9 earthquake strikes western China",
      url: "https://wire.example.com/news/china-quake",
      domain: "wire.example.com",
      seendate: "20260819T085000Z",
    },
  ], context, { limit: 3, now: new Date("2026-08-19T09:00:00Z") });
  assert.deepEqual(selected.map((article) => article.url), [
    "https://local.example.com/news/yanglong-quake",
    "https://wire.example.com/news/china-quake",
    "https://broad.example.com/news/other-china-quake",
  ]);
});

test("the persistent queue has retry, capacity, retention, and publisher-quality guards", () => {
  const moduleSource = readFileSync(resolve(__dirname, "event-news-discovery.ts"), "utf8");
  const gdeltSource = readFileSync(resolve(__dirname, "gdelt.ts"), "utf8");
  const usgsSource = readFileSync(resolve(__dirname, "usgs-earthquakes.ts"), "utf8");
  const migration = readFileSync(resolve(__dirname, "../../../../infra/gcp/sql/V50__targeted_earthquake_news_discovery.sql"), "utf8");

  assert.match(moduleSource, /FOR UPDATE SKIP LOCKED/);
  assert.match(moduleSource, /EVENT_NEWS_DISCOVERY_QUEUE_CAPACITY/);
  assert.match(moduleSource, /source_updated_at'[\s\S]*IS DISTINCT FROM/);
  assert.match(moduleSource, /completed_at<now\(\)-interval '30 days'/);
  assert.match(moduleSource, /TARGETED_QUERY_MAX_RECORDS = 8/);
  assert.match(moduleSource, /DEFAULT_MAX_ATTEMPTS = 6/);
  assert.match(moduleSource, /\[15, 45, 120, 360, 720\]/);
  assert.match(gdeltSource, /ingestTargetedGdeltNews[\s\S]*ingestDocArticles/);
  assert.match(gdeltSource, /publisher_published_verified/);
  assert.match(gdeltSource, /GDELT_DOC_MIN_REQUEST_SPACING_MS = 5_500/);
  assert.match(gdeltSource, /withGdeltDocRateLimit/);
  assert.match(usgsSource, /enqueueEarthquakeNewsDiscovery/);
  assert.match(migration, /LIMIT 100/);
  assert.match(migration, /magnitude >= 5\.5/);
  assert.match(migration, /DEFAULT 6/);
  assert.match(migration, /dead_letter/);
});
