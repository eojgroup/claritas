import test from "node:test";
import assert from "node:assert/strict";
import { compareObjectCounts, gateObjectCounts, validateObjectCounts, visualSignalScore, type ImageObjectCount } from "./object-counts";
const vessels: ImageObjectCount = { object_type: "vessel", area: "offshore", status: "estimated", count_min: 1, count_max: 2, confidence: .8, reason: "One clear hull and a possible second", boxes: [[.1,.2,.2,.3]] };
const context = { source_kind: "satellite" as const, product_type: "true_color", native_resolution_m: 10, effective_pixel_size_m: 10, cloud_cover: 10, width: 1024, height: 768 };
test("satellite resolution blocks truck counts and downsampled or analytical vessel estimates", () => {
  const truck = { ...vessels, object_type: "truck" as const };
  assert.equal(gateObjectCounts([vessels], context)[0].status,"estimated");
  for (const supplied of [{ ...context, effective_pixel_size_m: 30 }, { ...context, product_type: "sar" }, { ...context, native_resolution_m: null }, { ...context, cloud_cover: 50 }]) {
    const result = gateObjectCounts([vessels], supplied)[0];
    assert.equal(result.status,"not_resolvable"); assert.equal(result.count_min,null); assert.deepEqual(result.boxes,[]);
  }
  assert.equal(gateObjectCounts([truck],context)[0].status,"not_resolvable");
  assert.equal(gateObjectCounts([truck],{ ...context,native_resolution_m: 1,effective_pixel_size_m: 1 })[0].status,"estimated");
});
test("counts require visible boxes, ordered ranges and explicit unknowns", () => {
  assert.deepEqual(validateObjectCounts([vessels]),[vessels]);
  for (const invalid of [{ ...vessels,count_min: 2 },{ ...vessels,count_max: 0 },{ ...vessels,boxes: [[0,0,2,1]] },{ ...vessels,status: "not_resolvable" }]) assert.throws(()=>validateObjectCounts([invalid]));
  const unknown = { ...vessels,status: "not_resolvable" as const,count_min: null,count_max: null,boxes: [] };
  assert.deepEqual(validateObjectCounts([unknown]),[unknown]);
  assert.equal(gateObjectCounts([{ ...vessels,boxes: [[.1,.1,.101,.102]] }],{ ...context,source_kind: "news" })[0].status,"not_resolvable");
});
test("comparison uses uncertainty ranges and ignores unresolved or low-confidence baselines", () => {
  const current = { ...vessels,count_min: 8,count_max: 9 };
  const changes = compareObjectCounts([current],[vessels],"before","2026-10-06T00:00:00Z");
  assert.equal(changes[0].delta_min,6); assert.equal(changes[0].delta_max,8); assert.equal(changes[0].direction,"increase");
  assert.equal(compareObjectCounts([vessels],[vessels],"before","now")[0].direction,"overlapping_estimates");
  assert.deepEqual(compareObjectCounts([current],[{ ...vessels,confidence: .4 }],"before","now"),[]);
  assert.equal(visualSignalScore([current],changes),.04);
  assert.equal(visualSignalScore([vessels],[]),.015);
  assert.equal(visualSignalScore([{ ...vessels,count_min: 0,count_max: 0,boxes: [] }],[]),0);
});
