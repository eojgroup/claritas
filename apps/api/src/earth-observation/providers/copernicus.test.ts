import assert from "node:assert/strict";
import test from "node:test";
import { CopernicusProvider } from "./copernicus";

test("Copernicus OAuth tokens are cached and STAC responses normalized", async () => {
  let tokenCalls = 0;
  let catalogCalls = 0;
  const catalogBodies: Array<Record<string, unknown>> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("openid-connect/token")) {
      tokenCalls += 1;
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    catalogCalls += 1;
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer token");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    catalogBodies.push(body);
    const collection = (body.collections as string[])[0];
    return new Response(JSON.stringify({ features: [{
      id: collection === "sentinel-2-l2a" ? "S2-test" : "S1-test", collection, bbox: [0, 0, 1, 1],
      geometry: { type: "Polygon", coordinates: [] },
      properties: {
        datetime: collection === "sentinel-2-l2a" ? "2026-08-10T10:00:00Z" : "2026-08-11T10:00:00Z",
        "eo:cloud_cover": 4,
        "s2:nodata_pixel_percentage": collection === "sentinel-2-l2a" ? 3 : undefined,
      },
      links: [{ rel: "self", href: "https://example.test/scene" }],
    }] }), { status: 200, headers: { "content-type": "application/geo+json" } });
  };
  const provider = new CopernicusProvider("client", "secret", fetchMock);
  const request = { bbox: [0, 0, 1, 1] as [number, number, number, number], start: new Date("2026-08-01"), end: new Date("2026-08-12"), collections: ["sentinel-2-l2a", "sentinel-1-grd"], limit: 10 };
  const first = await provider.discoverScenes(request);
  await provider.discoverScenes(request);
  assert.equal(tokenCalls, 1);
  assert.equal(catalogCalls, 4);
  assert.deepEqual(catalogBodies.map((body) => body.collections), [
    ["sentinel-2-l2a"], ["sentinel-1-grd"], ["sentinel-2-l2a"], ["sentinel-1-grd"],
  ]);
  assert.ok(catalogBodies.every((body) => (body.collections as string[]).length === 1));
  assert.deepEqual(first.map((scene) => scene.providerSceneId), ["S1-test", "S2-test"]);
  assert.equal(first[1].cloudCover, 4);
  assert.equal(first[1].quality.valid_pixel_coverage, 0.97);
  assert.match(first[0].attribution, /Copernicus Sentinel/);
  assert.match(first[0].license, /Copernicus Data Space/);
});

test("Copernicus refreshes an expired token once after an unauthorized response", async () => {
  let tokenCalls = 0;
  let catalogCalls = 0;
  const fetchMock: typeof fetch = async (input) => {
    if (String(input).includes("openid-connect/token")) {
      tokenCalls += 1;
      return new Response(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 3600 }), { status: 200 });
    }
    catalogCalls += 1;
    if (catalogCalls === 1) return new Response("expired", { status: 401 });
    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  };
  const provider = new CopernicusProvider("client", "secret", fetchMock);
  const scenes = await provider.discoverScenes({
    bbox: [0, 0, 1, 1], start: new Date("2026-08-01"), end: new Date("2026-08-12"),
    collections: ["sentinel-2-l2a"], limit: 10,
  });
  assert.deepEqual(scenes, []);
  assert.equal(tokenCalls, 2);
  assert.equal(catalogCalls, 2);
});

test("Copernicus Process API output is bounded and retains provider usage metadata", async () => {
  const processBodies: any[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    if (String(input).includes("openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
    }
    processBodies.push(JSON.parse(String(init?.body)));
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png", "x-processingunits-spent": "0.75" },
    });
  };
  const provider = new CopernicusProvider("client", "secret", fetchMock);
  const rendered = await provider.render({
    bbox: [0, 0, 1, 1], start: new Date("2026-08-10"), end: new Date("2026-08-11"),
    collection: "sentinel-2-l2a", product: "true_color", width: 9000, height: 9000,
  });
  assert.equal(rendered.width, 1024);
  assert.equal(rendered.height, 1024);
  assert.equal(rendered.processingUnits, 0.75);
  assert.equal(processBodies[0].output.width, 1024);
  assert.equal(processBodies[0].input.data[0].processing.upsampling, "BICUBIC");
  assert.match(processBodies[0].evalscript, /B04/);
  assert.match(processBodies[0].evalscript, /x\/\(1\+x\)/);
  assert.match(processBodies[0].evalscript, /dataMask/);
  assert.doesNotMatch(processBodies[0].evalscript, /SCL|units:\s*["']REFLECTANCE/);

  await provider.render({
    bbox: [0, 0, 1, 1], start: new Date("2026-08-10"), end: new Date("2026-08-11"),
    collection: "sentinel-2-l2a", product: "burn_index", width: 1024, height: 768,
  });
  assert.match(processBodies[1].evalscript, /B08/);
  assert.match(processBodies[1].evalscript, /B12/);
  assert.equal(processBodies[1].input.data[0].processing.upsampling, "BILINEAR");
  assert.doesNotMatch(processBodies[1].evalscript, /Math\.max\(0,1-v\)/);
});

test("Copernicus leaves an invalid processing-unit header for conservative service fallback", async () => {
  const fetchMock: typeof fetch = async (input) => {
    if (String(input).includes("openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
    }
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png", "x-processingunits-spent": "not-a-number" },
    });
  };
  const provider = new CopernicusProvider("client", "secret", fetchMock);
  const rendered = await provider.render({
    bbox: [0, 0, 0.1, 0.1], start: new Date("2026-08-11T11:55:00Z"),
    end: new Date("2026-08-11T12:30:00Z"), collection: "sentinel-2-l2a",
    product: "true_color", width: 1024, height: 1024,
  });
  assert.equal(rendered.processingUnits, undefined);
});
