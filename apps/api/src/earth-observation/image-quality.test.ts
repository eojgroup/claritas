import assert from "node:assert/strict";
import test from "node:test";
import {
  accountedProcessingUnits,
  aoiGroundDimensions,
  contentAddressedObservationObject,
  earthObservationToApi,
  earthProductPresentation,
  renderDimensionsForAoi,
  renderWindowForScene,
} from "./image-quality";

test("observation assets use immutable content-addressed object names", () => {
  const first = contentAddressedObservationObject("observation", "preview", "a".repeat(64), "PNG");
  const second = contentAddressedObservationObject("observation", "preview", "b".repeat(64), "png");
  assert.equal(first, `observations/observation/preview-${"a".repeat(64)}.png`);
  assert.notEqual(first, second);
});

test("processing-unit accounting fails closed without double reservation", () => {
  assert.equal(accountedProcessingUnits(6, undefined), 6);
  assert.equal(accountedProcessingUnits(6, Number.NaN), 6);
  assert.equal(accountedProcessingUnits(6, 0), 6);
  assert.equal(accountedProcessingUnits(6, 4.5), 6);
  assert.equal(accountedProcessingUnits(6, 7.25), 7.25);
});

test("event AOIs render at their physical aspect ratio without exceeding provider ceilings", () => {
  const squareGroundAoi: [number, number, number, number] = [-74.07, 4.53, -73.93, 4.67];
  const dimensions = renderDimensionsForAoi(squareGroundAoi, 1_024, 768);
  assert.equal(dimensions.height, 768);
  assert.ok(dimensions.width >= 760 && dimensions.width <= 772);
  assert.ok(dimensions.effective_pixel_size_m < 25);
  assert.ok(aoiGroundDimensions(squareGroundAoi).widthM > 15_000);
});

test("scene render windows cannot drift into a different day's acquisition", () => {
  const instant = renderWindowForScene(new Date("2026-08-11T12:00:00Z"));
  assert.equal(instant.start.toISOString(), "2026-08-11T11:55:00.000Z");
  assert.equal(instant.end.toISOString(), "2026-08-11T12:30:00.000Z");
  const longCapture = renderWindowForScene(
    new Date("2026-08-11T12:00:00Z"),
    new Date("2026-08-12T12:00:00Z"),
  );
  assert.equal(longCapture.end.toISOString(), "2026-08-11T15:00:00.000Z");
});

test("observation contracts prefer full previews and explain event/news linkage", () => {
  const result = earthObservationToApi({
    id: "observation",
    event_id: "event",
    event_title: "Port access disrupted after flooding",
    event_summary: "Road and terminal access was interrupted.",
    event_type: "flood",
    event_status: "active",
    event_severity: "high",
    event_start_time: "2026-08-11T10:00:00Z",
    event_last_activity_time: "2026-08-11T13:00:00Z",
    event_relevance_score: "0.87",
    event_urgency_score: "0.75",
    event_materiality_score: "0.8",
    location_name: "Cartagena",
    event_country_iso2: "CO",
    event_latitude: "10.39",
    event_longitude: "-75.48",
    provider: "copernicus",
    product_type: "true_color",
    resolution_m: "10",
    methodology: { render_context: { effective_pixel_size_m: 14.8 } },
    analysis_kind: "rendered_observation",
    analysis_summary: "The model sees possible surface water near the terminal.",
    analysis_details: { model_interpretation: {
      summary: "The model sees possible surface water near the terminal.",
      confidence: 0.63,
      provider: "openrouter",
      actual_model: "free-vision-model",
      generated_at: "2026-08-11T13:30:00Z",
      observed_features: ["Possible standing water"],
      possible_changes: ["A newly inundated access road may be present"],
      limitations: ["Cloud and shadow may resemble water"],
    } },
    linked_news_count: 2,
    linked_news: [{ title: "Terminal access interrupted" }],
    assets: [
      { asset_type: "thumbnail", width: 640, height: 480, size_bytes: 12 },
      { asset_type: "preview", width: 1024, height: 1024, size_bytes: 40 },
    ],
  });
  assert.equal(result.imagery.preferred_asset.asset_type, "preview");
  assert.equal(result.imagery.quality_tier, "high_resolution_processed");
  assert.equal(result.imagery.effective_pixel_size_m, 14.8);
  assert.equal(result.analysis_summary_role, "model_interpretation");
  assert.equal(result.model_interpretation.model, "free-vision-model");
  assert.equal(result.model_interpretation.confidence, 0.63);
  assert.deepEqual(result.model_interpretation.findings, ["Possible standing water"]);
  assert.deepEqual(result.model_interpretation.possible_changes, ["A newly inundated access road may be present"]);
  assert.match(result.model_interpretation.notice, /not an independent sensor measurement/);
  assert.equal(result.imagery.natural_color, true);
  assert.equal(result.event_context.news.count, 2);
  assert.equal(result.event_context.news.items[0].title, "Terminal access interrupted");
  assert.match(result.event_context.linkage.limitation, /does not by itself prove/);
  assert.equal(earthProductPresentation("burn_index").visual_class, "analytical");
});
