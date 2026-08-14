import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIEFING_PRIORITY_EVENT_LIMITS,
  buildEventInterestReasons,
  describeEventLocation,
  normalizeBriefingEventContextRow,
  projectBriefingPriorityEvents,
} from "./briefing-event-context";

test("briefing event location states named geography before coordinates", () => {
  assert.equal(describeEventLocation({
    location_name: "Port of Rotterdam",
    country_iso2: "nl",
    latitude: 51.95,
    longitude: 4.14,
  }), "Port of Rotterdam, NL");
  assert.equal(describeEventLocation({
    latitude: 51.95,
    longitude: 4.14,
  }), "Near 51.950, 4.140");
  assert.equal(describeEventLocation({}), "Location not yet resolved");
});

test("briefing event reasons distinguish publisher and Earth-observation evidence", () => {
  const reasons = buildEventInterestReasons({
    severity: "high",
    relevance_score: 0.86,
    urgency_score: 0.7,
    materiality_score: 0.64,
    source_diversity: 4,
    domain_count: 3,
    linked_news_count: 2,
    physical_observation_count: 1,
    model_interpretation_count: 1,
  });
  assert.deepEqual(reasons, [
    "High-severity event",
    "Relevance 86/100 · urgency 70/100 · materiality 64/100",
    "3 evidence domains across 4 distinct sources",
    "2 linked publisher reports",
    "1 event-aligned Earth observation asset available; imagery is context, not automatic impact confirmation",
  ]);
  const modelOnly = buildEventInterestReasons({
    severity: "medium",
    relevance_score: 0.6,
    urgency_score: 0.4,
    materiality_score: 0.3,
    source_diversity: 1,
    domain_count: 1,
    linked_news_count: 0,
    physical_observation_count: 0,
    model_interpretation_count: 1,
  });
  assert.match(modelOnly.at(-1) ?? "", /no sensor image is treated as confirmation/);
  assert.ok(modelOnly.some((reason) => /No linked publisher reporting yet/.test(reason)));
});

test("briefing news preserves publication time separately from evidence receipt", () => {
  const normalized = normalizeBriefingEventContextRow({
    id: "news-event",
    event_type: "wildfire",
    title: "Wildfire reporting",
    summary: "A publisher report is linked.",
    status: "active",
    severity: "medium",
    confidence: 0.8,
    primary_country_iso2: "BR",
    region: "Americas",
    location_name: "Coffee belt",
    latitude: -21.5,
    longitude: -47.4,
    relevance_score: 0.8,
    urgency_score: 0.6,
    materiality_score: 0.7,
    source_diversity: 2,
    domain_count: 2,
    start_time: "2026-08-11T08:00:00Z",
    last_activity_time: "2026-08-11T12:00:00Z",
    evidence: [{
      domain: "news",
      evidence_type: "publisher_report",
      relationship: "reported",
      confidence: 0.8,
      published_at: "2026-08-11T09:00:00Z",
      observed_at: "2026-08-11T11:30:00Z",
      source: "Publisher",
      source_record_type: "item",
      source_title: "Fire response reported",
      source_original_title: "Incendio reportado",
      source_language: "es",
      translation_provider: "openrouter",
      translation_model: "openrouter/free",
    }],
    entities: [],
    earth_observations: [],
  });

  assert.equal(normalized.linked_news[0]?.published_at, "2026-08-11T09:00:00.000Z");
  assert.equal(normalized.linked_news[0]?.original_language, "es");
  assert.equal(normalized.linked_news[0]?.original_title, "Incendio reportado");
  assert.equal(normalized.linked_news[0]?.translation?.target_language, "en");
  assert.notEqual(normalized.linked_news[0]?.published_at, normalized.evidence[0]?.observed_at);
  assert.equal(normalized.start_time, "2026-08-11T08:00:00.000Z");
});

test("vision prose is separated from the sensor observation evidentiary role", () => {
  const normalized = normalizeBriefingEventContextRow({
    id: "event",
    event_type: "wildfire",
    title: "Wildfire context",
    summary: "Smoke has been reported.",
    status: "active",
    severity: "high",
    confidence: 0.8,
    primary_country_iso2: "GR",
    region: "Europe",
    location_name: "Attica",
    latitude: 38,
    longitude: 23.7,
    relevance_score: 0.9,
    urgency_score: 0.8,
    materiality_score: 0.7,
    source_diversity: 2,
    domain_count: 2,
    start_time: "2026-08-11T09:00:00Z",
    last_activity_time: "2026-08-11T12:00:00Z",
    evidence: [],
    entities: [],
    earth_observations: [{
      observation_id: "observation",
      product_type: "true_color",
      analysis_kind: "rendered_observation",
      status: "available",
      analysis_summary: "A model suggests a possible smoke plume.",
      methodology: {
        vision_enrichment: {
          provider: "openrouter",
          summary: "A model suggests a possible smoke plume.",
        },
      },
      captured_at: "2026-08-11T10:00:00Z",
      provider: "copernicus",
      mission: "Sentinel-2",
      resolution_m: 10,
      cloud_cover: 5,
      source_url: "https://dataspace.copernicus.eu/",
      attribution: "Copernicus Sentinel data",
      imagery_available: true,
    }],
  });
  assert.equal(normalized.earth_observation.length, 2);
  const sensor = normalized.earth_observation.find((item) => item.evidentiary_role === "sensor_observation");
  const model = normalized.earth_observation.find((item) => item.evidentiary_role === "model_interpretation");
  assert.equal(sensor?.analysis_summary, null);
  assert.equal(sensor?.imagery_available, true);
  assert.match(sensor?.temporal_alignment ?? "", /1 hour after/);
  assert.match(sensor?.assessment_boundary ?? "", /neither confirms nor disproves/);
  assert.equal(model?.analysis_summary, "A model suggests a possible smoke plume.");
  assert.equal(model?.imagery_available, false);
  assert.match(model?.assessment_boundary ?? "", /not an independent sensor observation/);
});

test("single-source machine-coded events are not priority-eligible at ordinary relevance", () => {
  const normalized = normalizeBriefingEventContextRow({
    id: "gdelt-event",
    event_type: "gdelt_190",
    title: "Machine-coded signal",
    summary: "A structured GDELT record.",
    status: "active",
    severity: "medium",
    confidence: 0.7,
    primary_country_iso2: "RU",
    region: "Europe",
    location_name: null,
    latitude: null,
    longitude: null,
    relevance_score: 0.72,
    urgency_score: 0.4,
    materiality_score: 0.4,
    source_diversity: 1,
    domain_count: 1,
    last_activity_time: "2026-08-11T12:00:00Z",
    evidence: [{
      domain: "news",
      evidence_type: "gdelt_event",
      relationship: "derived",
      confidence: 0.7,
      observed_at: "2026-08-11T12:00:00Z",
      source: "GDELT",
      source_record_type: "global_event",
      source_title: "Actor A / Actor B",
    }],
    entities: [],
    earth_observations: [],
  });
  assert.equal(normalized.linked_news.length, 0);
  assert.equal(normalized.source_quality.machine_coded_only, true);
  assert.equal(normalized.source_quality.priority_eligible, false);
});

test("briefing context never turns missing geography or sensor values into zero", () => {
  const normalized = normalizeBriefingEventContextRow({
    id: "missing-values",
    event_type: "wildfire",
    title: "Unresolved signal",
    summary: null,
    status: "active",
    severity: "medium",
    confidence: 0.7,
    primary_country_iso2: null,
    region: null,
    location_name: null,
    latitude: null,
    longitude: "",
    relevance_score: 0.7,
    urgency_score: 0.5,
    materiality_score: 0.5,
    source_diversity: 1,
    domain_count: 1,
    start_time: null,
    last_activity_time: "2026-08-11T12:00:00Z",
    evidence: [],
    entities: [],
    earth_observations: [{
      observation_id: "missing-sensor-values",
      product_type: "true_color",
      analysis_kind: "rendered_observation",
      status: "available",
      analysis_summary: null,
      methodology: {},
      captured_at: "2026-08-11T10:00:00Z",
      provider: "copernicus",
      mission: "Sentinel-2",
      resolution_m: null,
      cloud_cover: "",
      source_url: null,
      attribution: null,
      imagery_available: true,
    }],
  });

  assert.equal(normalized.latitude, null);
  assert.equal(normalized.longitude, null);
  assert.equal(normalized.where, "Location not yet resolved");
  const sensor = normalized.earth_observation.find(
    (item) => item.evidentiary_role === "sensor_observation",
  );
  assert.equal(sensor?.resolution_m, null);
  assert.equal(sensor?.cloud_cover, null);
});

test("priority-event projection bounds prompt and stored payloads", () => {
  const linkedNews = Array.from({ length: 10 }, (_, index) => ({
    title: `Report ${index}`,
    summary: null,
    url: `https://publisher.example/${index}`,
    publisher: "Publisher",
    published_at: "2026-08-11T11:00:00.000Z",
    relationship: "reported",
  }));
  const observations = Array.from({ length: 8 }, (_, index) => ({
    observation_id: `observation-${index}`,
    product_type: "true_color",
    analysis_kind: "rendered_observation",
    status: "available",
    provider: "Copernicus",
    mission: "Sentinel-2",
    captured_at: "2026-08-11T10:00:00.000Z",
    resolution_m: 10,
    cloud_cover: 5,
    imagery_available: true,
    analysis_summary: null,
    source_url: "https://dataspace.copernicus.eu/",
    attribution: "Copernicus Sentinel data",
    evidentiary_role: "sensor_observation" as const,
  }));
  const source = normalizeBriefingEventContextRow({
    id: "bounded-event",
    event_type: "port_disruption",
    title: "Bounded event",
    summary: "Bounded event summary.",
    status: "active",
    severity: "high",
    confidence: 0.8,
    primary_country_iso2: "NL",
    region: "Europe",
    location_name: "Rotterdam",
    latitude: 51.95,
    longitude: 4.14,
    relevance_score: 0.9,
    urgency_score: 0.8,
    materiality_score: 0.7,
    source_diversity: 2,
    domain_count: 2,
    last_activity_time: "2026-08-11T12:00:00Z",
    evidence: [],
    entities: [],
    earth_observations: [],
  });
  const expanded = {
    ...source,
    title: "T".repeat(5_000),
    summary: "S".repeat(5_000),
    what: "W".repeat(5_000),
    where: "L".repeat(5_000),
    why_interesting: Array.from({ length: 20 }, () => "R".repeat(5_000)),
    linked_news: linkedNews.map((item) => ({
      ...item,
      title: "N".repeat(5_000),
      summary: "Q".repeat(5_000),
      url: `https://publisher.example/${"u".repeat(5_000)}`,
    })),
    earth_observation: observations.map((item) => ({
      ...item,
      analysis_summary: "A".repeat(5_000),
      source_url: `https://dataspace.copernicus.eu/${"u".repeat(5_000)}`,
      attribution: "C".repeat(5_000),
    })),
    evidence: Array.from({ length: 30 }, () => ({ domain: "news" })),
    entities: Array.from({ length: 30 }, () => ({ display_name: "Entity" })),
  };
  const projected = projectBriefingPriorityEvents(
    Array.from({ length: 20 }, (_, index) => ({ ...expanded, id: `event-${index}` })),
  );

  assert.equal(projected.length, BRIEFING_PRIORITY_EVENT_LIMITS.events);
  assert.equal(projected[0].linked_news.length, BRIEFING_PRIORITY_EVENT_LIMITS.linked_news);
  assert.equal(projected[0].earth_observation.length, BRIEFING_PRIORITY_EVENT_LIMITS.earth_observation);
  assert.equal("evidence" in projected[0], false);
  assert.equal("entities" in projected[0], false);
  assert.equal("summary" in projected[0], true);
  assert.ok(Buffer.byteLength(JSON.stringify(projected), "utf8") < 100_000);
});
