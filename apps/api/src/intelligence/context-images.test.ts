import assert from "node:assert/strict";
import test from "node:test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const eventId = "a2a8fc41-69d4-46d3-bcb5-64ab9d5c6dda";
const locationId = "f1f8835b-b690-4036-ac86-de730260d014";

test("country-only and partial geography never select arbitrary context imagery", async () => {
  const { getEventContextImages, buildContextImageQuery } = await import("./context-images");
  for (const location_type of ["country", "region", "area", "agricultural_region", undefined]) {
    const input = { id: eventId, primary_location_id: locationId, location_type, latitude: 12, longitude: 24 };
    assert.equal(buildContextImageQuery(input), null);
    assert.deepEqual(await getEventContextImages(input, async () => { throw new Error("Must not query broad geography"); }), []);
  }
  assert.equal(buildContextImageQuery({ id: eventId, latitude: 0, metadata: { exact_geography: true } }), null);
  assert.equal(buildContextImageQuery({ id: eventId, latitude: NaN, longitude: 0, metadata: { exact_geography: true } }), null);
});

test("specific places enable retained article context while exact coordinates enable rendered-area context", async () => {
  const { buildContextImageQuery } = await import("./context-images");
  const namedPlace = buildContextImageQuery({ id: eventId, primary_location_id: locationId, location_type: "airport" });
  assert.ok(namedPlace);
  assert.deepEqual(namedPlace.params, [eventId, locationId]);
  assert.match(namedPlace.sql, /image\.article_url AS source_url/);
  assert.doesNotMatch(namedPlace.sql, /FROM earth_scene/);
  const point = buildContextImageQuery({ id: eventId, latitude: 0, longitude: 0, metadata: { exact_geography: true } });
  assert.ok(point);
  assert.deepEqual(point.params, [eventId, null, 0, 0]);
  assert.match(point.sql, /render_context'->'aoi_bbox'/);
  assert.match(point.sql, /observation\.status='available'/);
  assert.match(point.sql, /preview\.expires_at>now\(\)/);
  assert.doesNotMatch(point.sql, /JOIN news_image_asset/);
});

test("context responses deduplicate bytes, bound each kind and retain source dates without analysis or hashes", async () => {
  const { presentContextImages } = await import("./context-images");
  const row = {
    id: "observation", kind: "satellite" as const, content_hash: "a", preview_url: "/api/image", thumbnail_url: null,
    width: 768, height: 512, captured_at: new Date("2026-10-01T00:00:00Z"), published_at: null,
    collected_at: new Date("2026-10-02T00:00:00Z"), source_event_id: "original", source_event_title: "Original event",
    source_url: "https://example.org/scene", title: "Natural color", attribution: "Provider", license: "Open data",
    location_name: "Test Airport", match_reason: "rendered_area_contains_location" as const,
  };
  const rows = [row, { ...row, id: "duplicate" }, ...Array.from({ length: 6 }, (_, index) => ({ ...row, id: `${index}`, content_hash: `${index}` }))];
  const images = presentContextImages(rows);
  assert.equal(images.length, 3);
  assert.equal(images[0].captured_at, "2026-10-01T00:00:00.000Z");
  assert.equal(images[0].source_event_id, "original");
  assert.equal(images[0].license, "Open data");
  assert.match(images[0].notice, /does not establish conditions during this event/);
  assert.equal("content_hash" in images[0], false);
  const [news] = presentContextImages([{ ...row, kind: "news", captured_at: null, published_at: new Date("2026-10-05T00:00:00Z"), match_reason: "same_specific_location" }]);
  assert.equal(news.captured_at, null);
  assert.match(news.notice, /capture location and time are unverified/);
});
