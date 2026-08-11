import assert from "node:assert/strict";
import test from "node:test";
import { CopernicusProvider } from "./copernicus";

test("Copernicus OAuth tokens are cached and STAC responses normalized", async () => {
  let tokenCalls = 0;
  let catalogCalls = 0;
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("openid-connect/token")) {
      tokenCalls += 1;
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    catalogCalls += 1;
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer token");
    return new Response(JSON.stringify({ features: [{
      id: "S2-test", collection: "sentinel-2-l2a", bbox: [0, 0, 1, 1],
      geometry: { type: "Polygon", coordinates: [] },
      properties: { datetime: "2026-08-10T10:00:00Z", "eo:cloud_cover": 4 },
      links: [{ rel: "self", href: "https://example.test/scene" }],
    }] }), { status: 200, headers: { "content-type": "application/geo+json" } });
  };
  const provider = new CopernicusProvider("client", "secret", fetchMock);
  const request = { bbox: [0, 0, 1, 1] as [number, number, number, number], start: new Date("2026-08-01"), end: new Date("2026-08-12"), collections: ["sentinel-2-l2a"], limit: 10 };
  const first = await provider.discoverScenes(request);
  await provider.discoverScenes(request);
  assert.equal(tokenCalls, 1);
  assert.equal(catalogCalls, 2);
  assert.equal(first[0].providerSceneId, "S2-test");
  assert.equal(first[0].cloudCover, 4);
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
  let processBody: any;
  const fetchMock: typeof fetch = async (input, init) => {
    if (String(input).includes("openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
    }
    processBody = JSON.parse(String(init?.body));
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
  assert.equal(processBody.output.width, 1024);
  assert.match(processBody.evalscript, /B04/);
});
