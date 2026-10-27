import assert from "node:assert/strict";
import test from "node:test";
import type { LlmClient } from "./llm";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const subject = import("./news-translation");
const db = import("./db");

async function withMockQueries<T>(query: (sql: string, values: unknown[]) => unknown[], action: () => Promise<T>): Promise<T> {
  const { pool } = await db;
  const original = pool.connect;
  pool.connect = (async () => ({
    query: async (sql: string, values: unknown[] = []) => ({ rows: query(sql, values) }),
    release() {},
  })) as any;
  try { return await action(); } finally { pool.connect = original; }
}

async function withEnabledRuntime<T>(key: string, action: () => Promise<T>): Promise<T> {
  const names = ["NEWS_TRANSLATION_ENABLED", "NEWS_TRANSLATION_MODEL", "OPENROUTER_API_KEY"];
  const saved = names.map((name) => process.env[name]);
  process.env.NEWS_TRANSLATION_ENABLED = "true";
  process.env.NEWS_TRANSLATION_MODEL = "openrouter/free";
  process.env.OPENROUTER_API_KEY = key;
  try { return await action(); } finally {
    names.forEach((name, index) => { if (saved[index] == null) delete process.env[name]; else process.env[name] = saved[index]; });
  }
}

const freshBudget = { request_count: 0, automatic_request_count: 0, input_characters: 0,
  token_units_reserved: 0, next_attempt_at: null, last_status: null };

test("translation guards preserve numbers and reject an untranslated target script without changing source evidence", async () => {
  const { newsTranslationQualityIssue } = await subject;
  const source = { id: 1, title: "Terremoto de magnitud 6,2 deja 1.000 evacuados", summary: null, language_code: "es" };
  assert.equal(newsTranslationQualityIssue(source, "Magnitude 6.2 earthquake leaves 1,000 evacuated", "en"), null);
  assert.equal(newsTranslationQualityIssue(source, "Earthquake leaves residents evacuated", "en"), "numeric_evidence_lost");
  assert.equal(newsTranslationQualityIssue({ ...source, title: "Новое сообщение" }, "Новое сообщение", "en"), "wrong_target_script");
  assert.equal(newsTranslationQualityIssue({ ...source, title: "New report" }, "A report about 北京", "en"), null);
  assert.equal(source.title, "Terremoto de magnitud 6,2 deja 1.000 evacuados");
});

test("reader availability uses local state only and reports quota or scheduled work clearly", async () => {
  const { getNewsTranslationAvailability } = await subject;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; throw new Error("Reader must not call provider"); }) as typeof fetch;
  try {
    await withEnabledRuntime("reader-test", async () => {
      const limited = await withMockQueries(() => [{ ...freshBudget, automatic_request_count: 24 }], () => getNewsTranslationAvailability());
      assert.equal(limited.status, "quota_limited");
      assert.match(limited.reason ?? "", /Original publisher text/);
      assert.ok(Date.parse(limited.retry_after ?? "") > Date.now());
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      const pending = await withMockQueries(() => [{ ...freshBudget, next_attempt_at: future, last_status: "pending" }], () => getNewsTranslationAvailability());
      assert.equal(pending.status, "pending");
      assert.equal(pending.retry_after, future);
      assert.equal(requests, 0);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("an unavailable runtime does not enqueue work or touch database/provider", async () => {
  const { queueNewsHeadlineTranslations, getNewsTranslationAvailability } = await subject;
  const previous = process.env.NEWS_TRANSLATION_ENABLED;
  process.env.NEWS_TRANSLATION_ENABLED = "false";
  try {
    assert.equal(queueNewsHeadlineTranslations().queued, false);
    await withMockQueries(() => { throw new Error("Disabled runtime must not read DB"); }, async () => {
      assert.equal((await getNewsTranslationAvailability()).status, "disabled");
    });
  } finally { if (previous == null) delete process.env.NEWS_TRANSLATION_ENABLED; else process.env.NEWS_TRANSLATION_ENABLED = previous; }
});

test("shared provider quota preserves on-demand reserve without sending a completion", async () => {
  const { runPendingNewsHeadlineTranslations } = await subject;
  const originalFetch = globalThis.fetch;
  let quotaCalls = 0;
  let completionCalls = 0;
  let dispatchStatus: unknown;
  globalThis.fetch = (async (url) => {
    if (String(url) === "https://openrouter.ai/api/v1/key") {
      quotaCalls += 1;
      return new Response(JSON.stringify({ data: { free_model_daily_requests: { remaining: 6 } } }), { status: 200 });
    }
    completionCalls += 1;
    throw new Error("No completion may consume the on-demand reserve");
  }) as typeof fetch;
  try {
    await withEnabledRuntime("quota-test", () => withMockQueries((sql, values) => {
      if (sql.includes("INSERT INTO background_worker_lease")) return [{ acquired: true }];
      if (sql.startsWith("WITH pending")) return [{ id: 1, title: "Informe nuevo", summary: null, language_code: "es" }];
      if (sql.includes("FROM (SELECT 1) anchor")) return [{ ...freshBudget }];
      if (sql.includes("INSERT INTO news_translation_dispatch")) dispatchStatus = values[2];
      return [];
    }, async () => {
      const result = await runPendingNewsHeadlineTranslations();
      assert.equal(result.status, "budget_exhausted");
      assert.equal(result.requests_reserved, 0);
      assert.equal(dispatchStatus, "quota_limited");
      assert.equal(quotaCalls, 1);
      assert.equal(completionCalls, 0);
    }));
  } finally { globalThis.fetch = originalFetch; }
});

test("omitted attempted outputs enter a source-aware durable retry while successes remain stored", async () => {
  const { runPendingNewsHeadlineTranslations } = await subject;
  const retried: unknown[][] = [];
  const stored: number[] = [];
  let paced = false;
  const llmClient: LlmClient = {
    async generateStructured<T>() {
      return { output: { translations: [{ item_id: 1, translated_title: "New report", summary: null }] } as T,
        provider: "openrouter", model: "openrouter/free", metadata: { usage: { cost: 0 } } };
    },
  };
  await withEnabledRuntime("retry-test", () => withMockQueries((sql, values) => {
    if (sql.includes("INSERT INTO background_worker_lease")) return [{ acquired: true }];
    if (sql.startsWith("WITH pending")) {
      assert.match(sql, /retry\.source_title_hash = md5/);
      assert.match(sql, /retry\.next_attempt_at <= now\(\)/);
      return [
        { id: 1, title: "Informe nuevo", summary: null, language_code: "es" },
        { id: 2, title: "Deuxième rapport", summary: "Extrait original", language_code: "fr" },
      ];
    }
    if (sql.includes("WITH reservation")) return [{ reserved: true }];
    if (sql.includes("INSERT INTO item_translation")) stored.push(Number(values[0]));
    if (sql.includes("INSERT INTO news_translation_retry")) retried.push(values);
    if (sql.includes("INSERT INTO news_translation_dispatch")) paced = values[2] === "pending";
    if (sql.includes("COUNT(*)::int AS count")) return [{ count: 1 }];
    return [];
  }, async () => {
    const result = await runPendingNewsHeadlineTranslations({ llmClient });
    assert.equal(result.translated, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(stored, [1]);
    assert.equal(retried.length, 1);
    assert.equal(retried[0][0], 2);
    assert.match(String(retried[0][2]), /^[0-9a-f]{32}$/);
    assert.equal(paced, true);
  }));
});
