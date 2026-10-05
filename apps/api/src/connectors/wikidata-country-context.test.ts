import test from "node:test";
import assert from "node:assert/strict";
import { commonsReference, normalizeCountryContext, type CountryContextBinding } from "./wikidata-country-context";
const country: CountryContextBinding = { country: { value: "http://www.wikidata.org/entity/Q142" }, iso2: { value: "fr" } };
const capital = { ...country, property: { value: "http://www.wikidata.org/entity/P36" }, value: { value: "http://www.wikidata.org/entity/Q90" }, valueLabel: { value: "Paris" } };
test("country facts retain multi-valued fields, attribution, coordinate precision and zero values", () => {
  const result = normalizeCountryContext([capital, capital, { ...capital, value: { value: "http://www.wikidata.org/entity/Q91" }, valueLabel: { value: "Another capital" } }, { ...country, latitude: { value: "0" }, longitude: { value: "0" }, precision: { value: "0.1" } }], "2026-10-05T00:00:00Z").get("FR")!;
  assert.equal(result.capitals.length, 2);
  assert.equal(result.capitals[0].source_url, "https://www.wikidata.org/wiki/Q90");
  assert.deepEqual(result.coordinates, { latitude: 0, longitude: 0, precision_degrees: .1, basis: "country_reference_point" });
  assert.equal(result.source_license, "CC0");
});
test("missing or invalid coordinates stay absent and unresolved labels are omitted", () => {
  for (const point of [{}, { latitude: { value: "91" }, longitude: { value: "0" } }, { latitude: { value: "NaN" }, longitude: { value: "-74" } }]) {
    assert.equal(normalizeCountryContext([{ ...country, ...point }], "now").get("FR")!.coordinates, null);
  }
  assert.equal(normalizeCountryContext([{ ...capital, valueLabel: { value: "Q90" } }], "now").get("FR")!.capitals.length, 0);
});
test("Commons media references remain file-specific sources, never labelled CC0 by inheritance", () => {
  const map = commonsReference("http://commons.wikimedia.org/wiki/Special:FilePath/France%20map.svg")!;
  assert.equal(map.file_name, "France map.svg");
  assert.equal(map.source_url, "https://commons.wikimedia.org/wiki/File:France_map.svg");
  assert.equal(map.license, undefined);
  assert.equal(commonsReference("https://evil.example/wiki/Special:FilePath/map.svg"), null);
  assert.equal(commonsReference("javascript:alert(1)"), null);
});

test("country maps include attributed Commons thumbnails from either media host", async (t) => {
  const { fetchWikidataCountryContext } = await import("./wikidata-country-context");
  const maps = ["France map.svg", "France location.svg", "Restricted map.svg"];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("query.wikidata.org")) return Response.json({ results: { bindings: maps.map((name) => ({ ...country, property: { value: "http://www.wikidata.org/entity/P242" }, value: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}` } })) } });
    return Response.json({ query: { pages: Object.fromEntries(maps.map((name, index) => [String(index), {
      title: `File:${name}`, imageinfo: [{ thumburl: `https://${index === 0 ? "thumb" : "upload"}.wikimedia.org/map.png`, extmetadata: {
        LicenseShortName: { value: index === 2 ? "All rights reserved" : "CC BY-SA 4.0" },
        Artist: { value: "<a href='/wiki/User:Artist'>Map author</a>" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
      } }],
    }])) } });
  });
  const context = (await fetchWikidataCountryContext(["Q142"])).get("FR")!;
  assert.match(context.locator_maps[0].thumbnail_url!, /^https:\/\/thumb.wikimedia.org\//);
  assert.match(context.locator_maps[1].thumbnail_url!, /^https:\/\/upload.wikimedia.org\//);
  assert.equal(context.locator_maps[0].attribution, "Map author");
  assert.equal(context.locator_maps[0].license, "CC BY-SA 4.0");
  assert.equal(context.locator_maps[2].thumbnail_url, undefined);
});
