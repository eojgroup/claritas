import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBriefingWithFallback } from "./briefing-fallback";
// Keep the client and error class in the same module instance on Node 20/tsx.
// Mixing dynamic and static imports gives instanceof a different constructor.
import { LlmProviderError, OpenCodeLlmClient, getLlmRuntimeConfig, type LlmClient } from "./llm";
const request = { system: "system", prompt: "prompt", schema: {} };
const context = { briefing_date: "2026-09-15", news: [{ title: "Port closure reported", publisher: "Publisher", url: "https://example.com/report", event_time: "2026-09-15T06:00:00Z" }], intelligence_events: [{ title: "Port investigation" }], counts: { news: 1, podcasts: 0 } };
const failing = (error: Error): LlmClient => ({ async generateStructured() { throw error; } });
test("embedded free router 404 publishes an attributed, clearly labelled digest", async () => {
  const result = await generateBriefingWithFallback<{ update_text: string; key_takeaways: string[] }>(failing(new LlmProviderError("OpenCode generation failed: APIError (404): No endpoints available for openrouter/free")), request, context);
  assert.equal(result.provider, "deterministic");
  assert.equal(result.metadata.fallback, true);
  assert.match(result.output.update_text, /not a synthesized assessment/);
  assert.match(result.output.update_text, /Port investigation/);
  assert.match(result.output.key_takeaways[0], /Publisher: Port closure reported/);
  assert.deepEqual(JSON.parse(JSON.stringify(result.metadata.source_references)), context.news);
});
test("outages with no source data do not invent reporting", async () => {
  const result = await generateBriefingWithFallback<{ update_text: string }>(failing(new LlmProviderError("Unavailable", 503)), request, { ...context, news: [], intelligence_events: [], counts: {} });
  assert.match(result.output.update_text, /No source coverage/);
});
test("authentication and programming failures remain failures", async () => {
  for (const error of [new LlmProviderError("Unauthorized", 401), new Error("bug")]) {
    await assert.rejects(generateBriefingWithFallback(failing(error), request, context), error);
  }
});
test("successful provider output is preserved", async () => {
  const response = { output: { title: "Generated" }, provider: "opencode", model: "configured", metadata: {} };
  const client = { async generateStructured<T>() { return { ...response, output: response.output as T }; } };
  assert.deepEqual(await generateBriefingWithFallback(client, request, context), response);
});
test("OpenCode embedded endpoint and authentication statuses reach daily generation correctly", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [404, 401]) {
      globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("/session")
        ? { id: "test-session" }
        : { info: { error: { name: "APIError", data: { statusCode: status, message: status === 404 ? "No endpoints available for openrouter/free" : "Unauthorized" } } } }), { status: 200 });
      const client = new OpenCodeLlmClient({ baseUrl: "https://opencode.example", username: null, password: null, toolsDisabled: true, openRouterApiKey: null, sessionTimeoutMs: 1000, messageTimeoutMs: 1000, openRouterTimeoutMs: 1000, providerID: "openrouter", modelID: "openrouter/free", label: "openrouter/openrouter/free" });
      if (status === 404) {
        assert.equal((await generateBriefingWithFallback(client, request, context)).provider, "deterministic");
      } else {
        await assert.rejects(generateBriefingWithFallback(client, request, context), (error: unknown) => error instanceof LlmProviderError && error.status === 401);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("embedded OpenCode endpoint failures recover a real narrative through the same free route", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).includes("openrouter.ai")) {
        requests.push(body);
        return new Response(JSON.stringify({ model: "example/narrator:free", usage: { cost: 0 }, choices: [{ message: { content: JSON.stringify({ title: "Generated narrative", update_text: "Attributed synthesis", key_takeaways: ["Source finding"] }) } }] }));
      }
      return new Response(JSON.stringify(String(url).endsWith("/session") ? { id: "session" } : { info: { error: { name: "APIError", data: { statusCode: 404, message: "No endpoints available for openrouter/free" } } } }));
    };
    const client = new OpenCodeLlmClient({ baseUrl: "https://opencode.example", username: null, password: null, toolsDisabled: true, openRouterApiKey: "test-key", sessionTimeoutMs: 1000, messageTimeoutMs: 1000, openRouterTimeoutMs: 1000, providerID: "openrouter", modelID: "openrouter/free", label: "openrouter/openrouter/free" });
    const result = await generateBriefingWithFallback<{ title: string }>(client, request, context);
    assert.equal(result.provider, "openrouter");
    assert.equal(result.output.title, "Generated narrative");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "openrouter/free");
    assert.equal(requests[0].tools, undefined);
    assert.deepEqual(requests[0].provider, { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } });
  } finally { globalThis.fetch = originalFetch; }
});


test("production free-router shorthand resolves to the complete OpenCode model ID", () => {
  const saved = { model: process.env.OPENCODE_MODEL, provider: process.env.OPENCODE_PROVIDER_ID, id: process.env.OPENCODE_MODEL_ID };
  try {
    delete process.env.OPENCODE_PROVIDER_ID;
    delete process.env.OPENCODE_MODEL_ID;
    process.env.OPENCODE_MODEL = "openrouter/free";
    assert.equal(getLlmRuntimeConfig().opencode.model_id, "openrouter/free");
    process.env.OPENCODE_MODEL = "openrouter/openrouter/free";
    assert.equal(getLlmRuntimeConfig().opencode.model_id, "openrouter/free");
    process.env.OPENCODE_PROVIDER_ID = "openrouter";
    process.env.OPENCODE_MODEL_ID = "free";
    assert.equal(getLlmRuntimeConfig().opencode.model_id, "openrouter/free");
  } finally {
    for (const [key, value] of [["OPENCODE_MODEL", saved.model], ["OPENCODE_PROVIDER_ID", saved.provider], ["OPENCODE_MODEL_ID", saved.id]]) {
      if (value == null) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
