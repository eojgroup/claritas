import assert from "node:assert/strict";
import test from "node:test";
import {
  assessNewsItem,
  classifyNewsItem,
  createNewsQueryParameterPlan,
  NEWS_ASSESSMENT_METHODOLOGY,
  newsStructuredTopicMateriality,
  strongestNewsLinkedEvent,
} from "./news-intelligence";

const NOW = new Date("2026-08-21T12:00:00Z");

test("news query metadata toggles keep PostgreSQL parameter indexes contiguous", () => {
  const withMetadata = createNewsQueryParameterPlan("en", true);
  assert.deepEqual(withMetadata.params, ["en", [
    "markets", "economy", "companies", "geopolitics", "policy", "energy",
    "technology", "climate_disasters", "health", "transport", "other",
  ], NEWS_ASSESSMENT_METHODOLOGY]);
  assert.deepEqual(
    [withMetadata.displayLanguageIndex, withMetadata.categoryCatalogIndex, withMetadata.methodologyIndex],
    [1, 2, 3],
  );

  const withoutMetadata = createNewsQueryParameterPlan("en", false);
  assert.deepEqual(withoutMetadata.params, ["en", NEWS_ASSESSMENT_METHODOLOGY]);
  assert.deepEqual(
    [withoutMetadata.displayLanguageIndex, withoutMetadata.categoryCatalogIndex, withoutMetadata.methodologyIndex],
    [1, null, 2],
  );
});

test("uses governed institutional topics before headline fallback", () => {
  const assessment = assessNewsItem({
    itemId: 1,
    title: "Consumer Price Index summary",
    eventTime: "2026-08-21T11:00:00Z",
    sourceName: "institutional_rss",
    payload: {
      provider: "institutional_rss",
      feed: "bls_consumer_price_index",
      topics: ["inflation", "consumer_prices", "macro_news"],
      time_basis: "publisher_published",
      source: "U.S. Bureau of Labor Statistics",
    },
  }, NOW);
  assert.equal(assessment.primaryCategory, "economy");
  assert.equal(assessment.components.structured_topic_materiality, 0.95);
  assert.equal(assessment.tier, "notable");
  assert.ok(assessment.score >= 35);
  assert.ok(assessment.reasons.some((reason) => reason.code === "market_sensitive_source_topic"));
  assert.ok(assessment.tags.some((tag) => tag.kind === "topic"));
});

test("routine GOV.UK reporting remains other and routine without material evidence", () => {
  const assessment = assessNewsItem({
    itemId: 2,
    title: "Victims and survivors invited to share their experiences",
    summary: "A consultation page has been updated.",
    eventTime: "2026-08-21T11:00:00Z",
    sourceName: "govuk_search",
    payload: {
      document_type: "news_story",
      organisations: ["Ministry of Justice"],
      time_basis: "publisher_published",
      publisher: "Ministry of Justice",
    },
  }, NOW);
  assert.equal(assessment.primaryCategory, "other");
  assert.equal(assessment.components.structured_topic_materiality, 0);
  assert.equal(assessment.tier, "routine");
  assert.ok(assessment.score < 35);
});

test("broad Fed and SEC feed topics do not elevate routine releases", () => {
  const fixtures = [
    {
      itemId: 15,
      title: "Federal Reserve Board announces appointment of division director",
      payload: {
        provider: "institutional_rss",
        feed: "federal_reserve_press_releases",
        topics: ["monetary_policy", "banking", "macro_news"],
        time_basis: "publisher_published",
      },
    },
    {
      itemId: 16,
      title: "SEC announces departure of senior staff member",
      payload: {
        provider: "institutional_rss",
        feed: "sec_press_releases",
        topics: ["securities_regulation", "enforcement", "market_structure"],
        time_basis: "publisher_published",
      },
    },
  ];
  for (const fixture of fixtures) {
    const assessment = assessNewsItem({
      ...fixture,
      eventTime: "2026-08-21T11:00:00Z",
      sourceName: "institutional_rss",
    }, NOW);
    assert.equal(assessment.components.structured_topic_materiality, 0);
    assert.equal(assessment.tier, "routine");
    assert.equal(assessment.primaryCategory, "other");
    assert.deepEqual(assessment.categories, ["other"]);
  }
});

test("item-specific structured context can activate a broad institutional feed", () => {
  const assessment = assessNewsItem({
    itemId: 17,
    title: "Board publishes its latest decision",
    eventTime: "2026-08-21T11:00:00Z",
    sourceName: "institutional_rss",
    payload: {
      provider: "institutional_rss",
      feed: "federal_reserve_press_releases",
      topics: ["monetary_policy", "banking", "macro_news"],
      document_type: "monetary policy decision",
      time_basis: "publisher_published",
    },
  }, NOW);
  assert.equal(assessment.primaryCategory, "economy");
  assert.equal(assessment.components.structured_topic_materiality, 0.95);
  assert.equal(assessment.tier, "notable");
});

test("strongest governed event wins even when it is not the first link", () => {
  const events = [
    {
      id: "weak",
      event_type: "market_move",
      relevance_score: 0.3,
      materiality_score: 0.2,
      urgency_score: 0.1,
      confidence: 0.7,
      correlation_score: 0.8,
    },
    {
      id: "strong",
      event_type: "transport_activity_change",
      relevance_score: 0.9,
      materiality_score: 0.8,
      urgency_score: 0.7,
      confidence: 0.9,
      correlation_score: 0.95,
      distinct_publisher_count: 3,
    },
  ];
  assert.equal(strongestNewsLinkedEvent(events)?.id, "strong");
  assert.equal(classifyNewsItem({ itemId: 3, linkedEvents: events }).primaryCategory, "transport");
});

test("maps governed weather and transport context event types", () => {
  assert.equal(classifyNewsItem({
    itemId: 4,
    linkedEvents: [{ id: "weather", event_type: "weather_conditions", relevance_score: 0.5 }],
  }).primaryCategory, "climate_disasters");
  assert.equal(classifyNewsItem({
    itemId: 5,
    linkedEvents: [{ id: "transport", event_type: "transport_activity_change", relevance_score: 0.5 }],
  }).primaryCategory, "transport");
});

test("counts only explicit distinct publishers, never domain_count, as publisher evidence", () => {
  const common = {
    itemId: 6,
    title: "Port closure disrupts freight",
    eventTime: "2026-08-21T11:00:00Z",
    payload: { time_basis: "publisher_published" },
  };
  const onePublisher = assessNewsItem({
    ...common,
    linkedEvents: [{
      id: "event",
      event_type: "transport_disruption",
      relevance_score: 0.8,
      materiality_score: 0.7,
      urgency_score: 0.7,
      confidence: 0.9,
      correlation_score: 0.9,
      distinct_publisher_count: 1,
      domain_count: 9,
    } as any],
  }, NOW);
  const threePublishers = assessNewsItem({
    ...common,
    linkedEvents: [{
      id: "event",
      event_type: "transport_disruption",
      relevance_score: 0.8,
      materiality_score: 0.7,
      urgency_score: 0.7,
      confidence: 0.9,
      correlation_score: 0.9,
      distinct_publisher_count: 3,
    }],
  }, NOW);
  assert.equal(onePublisher.components.publisher_diversity, 0);
  assert.ok(!onePublisher.reasons.some((reason) => reason.code === "independent_publishers"));
  assert.ok(threePublishers.score > onePublisher.score);
  assert.ok(threePublishers.reasons.some((reason) => reason.code === "independent_publishers"));
});

test("a story-created event is taxonomy context, not independent importance evidence", () => {
  const event = {
    id: "self-event",
    event_type: "market_move",
    relevance_score: 0.7,
    materiality_score: 0.5,
    urgency_score: 0.5,
    confidence: 0.8,
    correlation_score: 1,
    source_diversity: 1,
    domain_count: 1,
    distinct_publisher_count: 1,
  };
  const base = {
    itemId: 17,
    title: "Single publisher report",
    eventTime: "2026-08-21T11:00:00Z",
    payload: { time_basis: "publisher_published" },
  };
  const created = assessNewsItem({
    ...base,
    linkedEvents: [{ ...event, correlation_factors: { decision: "created" } }],
  }, NOW);
  const attached = assessNewsItem({
    ...base,
    linkedEvents: [{ ...event, correlation_factors: { decision: "attached" } }],
  }, NOW);
  assert.equal(created.components.event_evidence_factor, 0.25);
  assert.equal(created.tier, "routine");
  assert.equal(attached.components.event_evidence_factor, 1);
  assert.ok(attached.score > created.score);
});

test("does not use publisher brand or tone as importance", () => {
  const base = {
    itemId: 7,
    title: "Routine local notice",
    eventTime: "2026-08-21T11:00:00Z",
    payload: { tone: -99, gkg: { tone: 99 }, time_basis: "publisher_published" },
  };
  const first = assessNewsItem({ ...base, sourceName: "Reuters" }, NOW);
  const second = assessNewsItem({ ...base, sourceName: "Unknown publisher" }, NOW);
  assert.equal(first.score, second.score);
  assert.equal(first.tier, second.tier);
});

test("invalid and future timestamps fail closed without NaN", () => {
  for (const [itemId, eventTime] of [[8, "not-a-date"], [9, "2026-08-22T12:00:00Z"]] as const) {
    const assessment = assessNewsItem({ itemId, title: "Routine notice", eventTime }, NOW);
    assert.ok(Number.isFinite(assessment.score));
    assert.equal(assessment.components.publication_time_valid, false);
    assert.ok(assessment.reasons.some((reason) => reason.code === "unverified_publication_time"));
  }
});

test("ingestion time never substitutes for a missing publisher timestamp", () => {
  const assessment = assessNewsItem({
    itemId: 14,
    title: "Story discovered just now",
    eventTime: null,
    createdAt: "2026-08-21T11:59:00Z",
    payload: { topics: ["institutional_release"] },
  }, NOW);
  assert.equal(assessment.components.publication_time_valid, false);
  assert.equal(assessment.components.freshness, 0);
  assert.equal(assessment.tier, "routine");
});

test("structured context takes precedence over conflicting lexical copy", () => {
  const classification = classifyNewsItem({
    itemId: 10,
    title: "Software platform launches stock dashboard",
    payload: { topics: ["energy_supply", "natural_gas"] },
  });
  assert.equal(classification.primaryCategory, "energy");
  assert.ok(!classification.categories.includes("technology"));
  assert.ok(!classification.categories.includes("markets"));
});

test("GDELT themes support multiple categories without an unsafe policy default", () => {
  const classification = classifyNewsItem({
    itemId: 11,
    title: "Ambiguous update",
    payload: { gkg: { themes: ["ECON_INFLATION", "ENV_CLIMATECHANGE"] } },
  });
  assert.equal(classification.primaryCategory, "economy");
  assert.ok(classification.categories.includes("climate_disasters"));
  assert.ok(!classification.categories.includes("policy"));
});

test("high-quality structured and event evidence can reach top tier", () => {
  const assessment = assessNewsItem({
    itemId: 12,
    title: "Central bank decision",
    eventTime: "2026-08-21T11:30:00Z",
    payload: { topics: ["monetary_policy", "inflation"], time_basis: "publisher_published_verified" },
    linkedEvents: [{
      id: "material-event",
      event_type: "market_move",
      status: "active",
      severity: "critical",
      confidence: 1,
      relevance_score: 1,
      urgency_score: 1,
      materiality_score: 1,
      correlation_score: 1,
      distinct_publisher_count: 4,
    }],
  }, NOW);
  assert.equal(assessment.tier, "top");
  assert.ok(assessment.score >= 80 && assessment.score <= 100);
  assert.equal(assessment.methodologyVersion, NEWS_ASSESSMENT_METHODOLOGY);
});

test("assessment output and input hash are deterministic within an hourly bucket", () => {
  const input = {
    itemId: 13,
    title: "Bond yields rise after inflation report",
    eventTime: "2026-08-21T10:00:00Z",
    payload: { topics: ["inflation", "consumer_prices"], time_basis: "publisher_published" },
  };
  const first = assessNewsItem(input, new Date("2026-08-21T12:05:00Z"));
  const second = assessNewsItem(input, new Date("2026-08-21T12:55:00Z"));
  assert.equal(first.inputsHash, second.inputsHash);
  assert.equal(first.score, second.score);
  assert.deepEqual(first.categories, second.categories);
  assert.notEqual(first.assessedAt, second.assessedAt);
});

test("structured topic materiality ignores generic institutional metadata", () => {
  assert.deepEqual(newsStructuredTopicMateriality({
    topics: ["eu_policy", "institutional_release"],
    document_type: "press_release",
  }), { score: 0, codes: [], signals: [] });
});
