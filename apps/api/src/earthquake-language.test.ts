import assert from "node:assert/strict";
import test from "node:test";
import { hasEarthquakeHeadlineSignal } from "./earthquake-language";

test("reviewed multilingual earthquake vocabulary recognizes local reporting", () => {
  for (const headline of [
    "青海发生5.9级地震",
    "日本で強い地震、津波の恐れなし",
    "Terremoto de magnitud 5.9 sacude la región",
    "Séisme de magnitude 5,9 dans la région",
    "Starkes Erdbeben erschüttert die Region",
    "Gempa bumi magnitudo 5,9 mengguncang wilayah itu",
    "Землетрясение магнитудой 5,9 произошло в регионе",
    "زلزال بقوة 5.9 درجات يضرب المنطقة",
    "क्षेत्र में 5.9 तीव्रता का भूकंप",
    "규모 5.9 지진이 지역을 강타",
  ]) {
    assert.equal(hasEarthquakeHeadlineSignal(headline), true, headline);
  }
});

test("multilingual detector is bounded and rejects unrelated text", () => {
  assert.equal(hasEarthquakeHeadlineSignal("青海发布新的经济发展规划"), false);
  assert.equal(hasEarthquakeHeadlineSignal("Regional transport and weather update"), false);
  assert.equal(hasEarthquakeHeadlineSignal("地震".repeat(501)), false);
  assert.equal(hasEarthquakeHeadlineSignal(null), false);
});
