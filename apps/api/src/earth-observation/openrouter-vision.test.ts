import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EO_VISION_MODEL,
  OpenRouterVisionClient,
  isZeroPricedImageModel,
  normalizeVisionDailyLimit,
  validateVisionInterpretation,
} from "./openrouter-vision";

const interpretation = {
  summary: "A linear smoke-like plume is visible east of the monitored area.",
  observed_features: ["Light-toned plume"],
  possible_changes: ["Possible new plume relative to contextual reporting"],
  limitations: ["Single image; no causal attribution"],
  confidence: 0.63,
};

test("OpenRouter free router sends a bounded multimodal request and retains the actual model", async () => {
  let body: any;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      model: "google/gemma-4-26b-a4b-it:free",
      usage: { cost: 0 },
      choices: [{ message: { content: JSON.stringify(interpretation) } }],
    }), { status: 200 });
  };
  const client = new OpenRouterVisionClient("test-key", DEFAULT_EO_VISION_MODEL, fetchImpl);
  const result = await client.interpret({ image: Buffer.from("image"), mimeType: "image/jpeg", context: { event_type: "wildfire" } });
  assert.equal(body.model, "openrouter/free");
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.usage, { include: true });
  assert.equal(result.actualModel, "google/gemma-4-26b-a4b-it:free");
  assert.deepEqual(result.interpretation, interpretation);
});

for (const [name, usage] of [
  ["missing", undefined],
  ["non-finite", { cost: "not-a-number" }],
  ["non-zero", { cost: 0.000001 }],
] as const) {
  test(`free-only vision fails closed when response cost is ${name}`, async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      model: "google/gemma-4-26b-a4b-it:free",
      ...(usage === undefined ? {} : { usage }),
      choices: [{ message: { content: JSON.stringify(interpretation) } }],
    }), { status: 200 });
    const client = new OpenRouterVisionClient("test-key", DEFAULT_EO_VISION_MODEL, fetchImpl);
    await assert.rejects(
      client.interpret({ image: Buffer.from("image"), mimeType: "image/jpeg", context: {} }),
      /did not prove a zero charge/,
    );
  });
}

test("an exact paid or text-only model is rejected before inference", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [{
      id: "vendor/paid-vision",
      architecture: { input_modalities: ["text", "image"] },
      pricing: { prompt: "0.000001", completion: "0", request: "0", image: "0" },
      supported_parameters: ["structured_outputs"],
    }] }), { status: 200 });
  };
  const client = new OpenRouterVisionClient("test-key", "vendor/paid-vision", fetchImpl);
  await assert.rejects(
    client.interpret({ image: Buffer.from("image"), mimeType: "image/jpeg", context: {} }),
    /not an exact zero-priced image-input model/,
  );
  assert.equal(calls, 1);
});

test("exact zero-priced image model validation is fail-closed", () => {
  const free = {
    id: "vendor/free-vision",
    architecture: { input_modalities: ["text", "image"] },
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["response_format"],
  };
  assert.equal(isZeroPricedImageModel(free, "vendor/free-vision"), true);
  assert.equal(isZeroPricedImageModel({ ...free, architecture: { input_modalities: ["text"] } }, "vendor/free-vision"), false);
  assert.equal(isZeroPricedImageModel({ ...free, pricing: { prompt: "0" } }, "vendor/free-vision"), false);
  assert.equal(isZeroPricedImageModel({ ...free, pricing: { ...free.pricing, image: "0.1" } }, "vendor/free-vision"), false);
  assert.equal(isZeroPricedImageModel({ ...free, supported_parameters: ["temperature"] }, "vendor/free-vision"), false);
  assert.equal(isZeroPricedImageModel(free, "another-model"), false);
});

test("vision output and daily request budget are strictly bounded", () => {
  assert.deepEqual(validateVisionInterpretation(interpretation), interpretation);
  assert.throws(() => validateVisionInterpretation({ ...interpretation, confidence: 2 }), /between zero and one/);
  assert.equal(normalizeVisionDailyLimit(undefined), 10);
  assert.equal(normalizeVisionDailyLimit("12"), 12);
  assert.equal(normalizeVisionDailyLimit("500"), 50);
  assert.equal(normalizeVisionDailyLimit("0"), 0);
});
