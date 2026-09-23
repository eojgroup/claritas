import assert from "node:assert/strict";
import test from "node:test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("source resolution accepts stored source identities, never arbitrary claims or cross-domain types", async () => {
  const { parseInvestigationSource } = await import("./source-resolution");
  assert.deepEqual(parseInvestigationSource({ domain: "news", source_record_type: "item", source_record_id: 12 }), {
    domain: "news", sourceRecordType: "item", sourceRecordId: "12",
  });
  assert.ok(parseInvestigationSource({ domain: "podcast", source_record_type: "podcast_episode", source_record_id: "24" }));
  assert.equal(parseInvestigationSource({ domain: "news", source_record_type: "social_signal", source_record_id: "24" }), null);
  assert.equal(parseInvestigationSource({ domain: "news", source_record_type: "item", source_record_id: "an invented claim" }), null);
  assert.equal(parseInvestigationSource({ domain: "news", source_record_type: "item", source_record_id: -1 }), null);
});
