import assert from "node:assert/strict";
import test from "node:test";
import type {
  type NewsTranslationCandidate,
  type NewsTranslationRuntimeConfig,
} from "./news-translation";
import type {
  type LlmClient,
  type LlmStructuredRequest,
} from "./llm";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const translation = import("./news-translation");
const llm = import("./llm");

const candidates: NewsTranslationCandidate[] = [
  { id: 1, title: "Uno", summary: null, language_code: "es" },
  { id: 2, title: "Dos", summary: null, language_code: "es" },
  { id: 3, title: "Tres", summary: null, language_code: "es" },
];

function runtime(overrides: Partial<NewsTranslationRuntimeConfig> = {}): NewsTranslationRuntimeConfig {
  return {
    enabled: true,
    available: true,
    model: "openrouter/free",
    reason: null,
    chunk_size: 12,
    max_chunk_source_characters: 4_500,
    max_retries: 1,
    max_output_tokens: 2_048,
    daily_request_limit: 30,
    automatic_daily_request_limit: 24,
    daily_character_limit: 250_000,
    daily_token_unit_limit: 350_000,
    ...overrides,
  };
}

test("free-only model policy accepts only the free router or explicit :free variants", async () => {
  const { isFreeOpenRouterModel } = await llm;
  assert.equal(isFreeOpenRouterModel("openrouter/free"), true);
  assert.equal(isFreeOpenRouterModel("google/gemma-3-12b-it:free"), true);
  assert.equal(isFreeOpenRouterModel("google/gemma-3-12b-it"), false);
  assert.equal(isFreeOpenRouterModel("openai/gpt-4.1"), false);
  assert.equal(isFreeOpenRouterModel("free"), false);
});

test("free-only response policy rejects missing, malformed, and non-zero cost", async () => {
  const { assertFreeOpenRouterResponseCost, LlmProviderError } = await llm;
  assert.equal(assertFreeOpenRouterResponseCost({ cost: 0 }), 0);
  assert.throws(
    () => assertFreeOpenRouterResponseCost({}),
    (error: unknown) => error instanceof LlmProviderError && error.status === 402,
  );
  assert.throws(
    () => assertFreeOpenRouterResponseCost({ cost: "0" }),
    (error: unknown) => error instanceof LlmProviderError && error.status === 402,
  );
  assert.throws(
    () => assertFreeOpenRouterResponseCost({ cost: 0.00001 }),
    (error: unknown) => error instanceof LlmProviderError && error.status === 402,
  );
});

test("free OpenRouter client never retries a response with ambiguous cost", async () => {
  const { FreeOpenRouterLlmClient, LlmProviderError } = await llm;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestBody: Record<string, unknown> | null = null;
  try {
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "some/free-route",
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: {},
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new FreeOpenRouterLlmClient({
      apiKey: "test-key",
      model: "openrouter/free",
      timeoutMs: 5_000,
      applicationTitle: "Claritas test",
    });
    await assert.rejects(
      client.generateStructured({
        system: "Return JSON.",
        prompt: "{}",
        schema: { type: "object" },
        retryCount: 2,
        maxOutputTokens: 128,
      }),
      (error: unknown) => error instanceof LlmProviderError && error.status === 402,
    );
    assert.equal(calls, 1);
    assert.deepEqual(requestBody?.provider, {
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime config fails closed without a key and for a non-free model", async () => {
  const { getNewsTranslationRuntimeConfig } = await translation;
  const previous = {
    enabled: process.env.NEWS_TRANSLATION_ENABLED,
    model: process.env.NEWS_TRANSLATION_MODEL,
    key: process.env.OPENROUTER_API_KEY,
  };
  try {
    process.env.NEWS_TRANSLATION_ENABLED = "true";
    delete process.env.OPENROUTER_API_KEY;
    process.env.NEWS_TRANSLATION_MODEL = "openrouter/free";
    assert.equal(getNewsTranslationRuntimeConfig().available, false);
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.NEWS_TRANSLATION_MODEL = "openai/gpt-4.1";
    const config = getNewsTranslationRuntimeConfig();
    assert.equal(config.available, false);
    assert.match(config.reason || "", /must be openrouter\/free/);
  } finally {
    if (previous.enabled === undefined) delete process.env.NEWS_TRANSLATION_ENABLED;
    else process.env.NEWS_TRANSLATION_ENABLED = previous.enabled;
    if (previous.model === undefined) delete process.env.NEWS_TRANSLATION_MODEL;
    else process.env.NEWS_TRANSLATION_MODEL = previous.model;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous.key;
  }
});

test("translation planning bounds chunks by both item count and source characters", async () => {
  const { planNewsTranslationChunks } = await translation;
  const characterBound = planNewsTranslationChunks([
    { id: 1, title: "a".repeat(500), summary: "x".repeat(1_200), language_code: "es" },
    { id: 2, title: "b".repeat(500), summary: "y".repeat(1_200), language_code: "es" },
  ], {
    maxItems: 12,
    maxSourceCharacters: 2_000,
    includeSummary: true,
  });
  assert.deepEqual(characterBound.map((chunk) => chunk.map((item) => item.id)), [[1], [2]]);

  const itemBound = planNewsTranslationChunks(candidates, {
    maxItems: 2,
    maxSourceCharacters: 10_000,
  });
  assert.deepEqual(itemBound.map((chunk) => chunk.map((item) => item.id)), [[1, 2], [3]]);
});

test("partial model output is persisted before retrying only omitted candidates", async () => {
  const { processNewsTranslationCandidates } = await translation;
  const requestedIds: number[][] = [];
  const requestPlans: LlmStructuredRequest[] = [];
  let providerCalls = 0;
  let reservations = 0;
  const client: LlmClient = {
    async generateStructured<T>(request: LlmStructuredRequest) {
      providerCalls += 1;
      requestPlans.push(request);
      const parsed = JSON.parse(request.prompt) as { items: Array<{ item_id: number }> };
      requestedIds.push(parsed.items.map((item) => item.item_id));
      const selected = providerCalls === 1 ? parsed.items.slice(0, 1) : parsed.items;
      return {
        output: {
          translations: selected.map((item) => ({
            item_id: item.item_id,
            translated_title: `English ${item.item_id}`,
            summary: null,
          })),
        } as T,
        provider: "openrouter",
        model: "openrouter/free",
        metadata: { usage: { cost: 0 } },
      };
    },
  };
  const persisted: number[][] = [];
  const result = await processNewsTranslationCandidates({
    candidates,
    targetLanguage: "en",
    includeSummary: false,
    scope: "automatic",
    llmClient: client,
    runtime: runtime({ chunk_size: 3 }),
  }, {
    async reserveBudget() {
      reservations += 1;
      return true;
    },
    async store(_chunk, generated) {
      const ids = generated.translations.map((item) => item.item_id);
      persisted.push(ids);
      return {
        translated: ids.length,
        summariesGenerated: 0,
        summariesInsufficient: 0,
        storedIds: ids,
        failedIds: [],
        errors: [],
      };
    },
  });

  assert.deepEqual(requestedIds, [[1, 2, 3], [2, 3]]);
  assert.deepEqual(persisted, [[1], [2, 3]]);
  assert.equal(result.translated, 3);
  assert.deepEqual(result.failedIds, []);
  assert.equal(providerCalls, 2);
  assert.equal(result.requestsReserved, providerCalls);
  assert.equal(reservations, providerCalls);
  assert.ok(requestPlans.every((request) => request.retryCount === 0));
  assert.ok(requestPlans.every((request) => (request.maxOutputTokens || 0) <= 2_048));
});

test("budget exhaustion prevents an unreserved provider call and reports deferred ids", async () => {
  const { processNewsTranslationCandidates } = await translation;
  let reservations = 0;
  let providerCalls = 0;
  const result = await processNewsTranslationCandidates({
    candidates,
    targetLanguage: "en",
    includeSummary: false,
    scope: "automatic",
    llmClient: {
      async generateStructured<T>() {
        providerCalls += 1;
        return {
          output: { translations: [] } as T,
          provider: "openrouter",
          model: "openrouter/free",
          metadata: {},
        };
      },
    },
    runtime: runtime({ chunk_size: 3 }),
  }, {
    async reserveBudget() {
      reservations += 1;
      return reservations === 1;
    },
    async store() {
      throw new Error("store must not be called for an empty response");
    },
  });

  assert.equal(reservations, 2);
  assert.equal(providerCalls, 1);
  assert.equal(result.requestsReserved, 1);
  assert.equal(result.budgetExhausted, true);
  assert.deepEqual(result.failedIds.sort((a, b) => a - b), [1, 2, 3]);
});

test("cost-policy rejection stops the batch without retrying or touching later chunks", async () => {
  const { processNewsTranslationCandidates } = await translation;
  const { LlmProviderError } = await llm;
  let reservations = 0;
  let providerCalls = 0;
  const result = await processNewsTranslationCandidates({
    candidates,
    targetLanguage: "en",
    includeSummary: false,
    scope: "automatic",
    llmClient: {
      async generateStructured<T>() {
        providerCalls += 1;
        throw new LlmProviderError("usage.cost was not zero", 402);
      },
    },
    runtime: runtime({ chunk_size: 2, max_retries: 2 }),
  }, {
    async reserveBudget() {
      reservations += 1;
      return true;
    },
    async store() {
      throw new Error("store must not be called after a policy rejection");
    },
  });

  assert.equal(providerCalls, 1);
  assert.equal(reservations, 1);
  assert.equal(result.requestsReserved, 1);
  assert.deepEqual(result.failedIds.sort((a, b) => a - b), [1, 2, 3]);
});

test("model output is bounded and unknown or duplicate ids are discarded before storage", async () => {
  const { processNewsTranslationCandidates } = await translation;
  let storedTitles: string[] = [];
  let storedSummaries: Array<string | null> = [];
  let outputCeiling = 0;
  const result = await processNewsTranslationCandidates({
    candidates: [candidates[0]],
    targetLanguage: "en",
    includeSummary: true,
    scope: "on_demand",
    llmClient: {
      async generateStructured<T>(request) {
        outputCeiling = request.maxOutputTokens || 0;
        return {
          output: {
            translations: [
              { item_id: 1, translated_title: "x".repeat(800), summary: "word ".repeat(100) },
              { item_id: 1, translated_title: "duplicate", summary: null },
              { item_id: 999, translated_title: "unknown", summary: null },
            ],
          } as T,
          provider: "openrouter",
          model: "openrouter/free",
          metadata: {},
        };
      },
    },
    runtime: runtime(),
  }, {
    async reserveBudget() {
      return true;
    },
    async store(_chunk, generated) {
      storedTitles = generated.translations.map((item) => item.translated_title);
      storedSummaries = generated.translations.map((item) => item.summary);
      return {
        translated: generated.translations.length,
        summariesGenerated: generated.translations.filter((item) => item.summary).length,
        summariesInsufficient: 0,
        storedIds: generated.translations.map((item) => item.item_id),
        failedIds: [],
        errors: [],
      };
    },
  });

  assert.equal(result.translated, 1);
  assert.equal(storedTitles.length, 1);
  assert.equal(storedTitles[0].length, 500);
  assert.ok((storedSummaries[0]?.split(/\s+/).length || 0) <= 55);
  assert.equal(outputCeiling, 768);
});
