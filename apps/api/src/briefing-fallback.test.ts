import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBriefingWithFallback } from "./briefing-fallback";
import { LlmProviderError, type LlmClient } from "./llm";
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
  const { OpenCodeLlmClient } = await import("./llm");
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
