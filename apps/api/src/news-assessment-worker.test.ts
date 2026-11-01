import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("assessment publisher lookup refuses unsafe SQL aliases", async () => {
  const { newsEvidenceItemIdSql } = await import("./news-assessment-worker");
  for (const alias of ["", "evidence.id", "evidence; DROP TABLE item", '"evidence"', "evidence--", "evidence\nJOIN item"]) {
    assert.throws(() => newsEvidenceItemIdSql(alias), /Invalid evidence SQL alias/);
  }
  assert.doesNotThrow(() => newsEvidenceItemIdSql("publisher_evidence"));
});

test("assessment persistence keeps the database read watermark so concurrent source updates remain eligible", async () => {
  // The API is CommonJS. Use its loader so Node 20 + tsx cannot create a
  // separate ESM database instance that escapes this connection stub.
  const { pool } = require("./db") as typeof import("./db");
  const { assessPendingNewsItems } = await import("./news-assessment-worker");
  const originalConnect = pool.connect;
  const readWatermark = new Date("2026-10-27T10:00:00.000Z");
  let persisted: unknown[] | undefined;
  pool.connect = (async () => ({
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO news_item_assessment")) {
        persisted = params;
        return { rows: [{ item_id: 123 }] };
      }
      return { rows: [{
        id: "123",
        title: "Central bank raises its policy rate",
        summary: "The central bank announced a policy rate decision.",
        event_time: "2026-10-27T09:55:00.000Z",
        created_at: "2026-10-27T09:56:00.000Z",
        payload: { time_basis: "publisher_published_verified" },
        source_name: "institutional_rss",
        linked_events: null,
        assessment_watermark: readWatermark,
      }] };
    },
    release() {},
  })) as typeof pool.connect;
  try {
    assert.deepEqual(await assessPendingNewsItems(1), { selected: 1, assessed: 1 });
    assert.ok(persisted, "the selected story must reach the durable assessment");
    assert.equal(persisted[0], 123);
    const storedWatermark = new Date(String(persisted[10]));
    assert.equal(storedWatermark.toISOString(), readWatermark.toISOString());
    const concurrentUpdate = new Date("2026-10-27T10:00:00.001Z");
    assert.ok(concurrentUpdate > storedWatermark, "a later source update must not be hidden behind a worker-clock timestamp");
    assert.ok(Number.isFinite(persisted[7]), "the assessment remains usable for ranking");
  } finally {
    pool.connect = originalConnect;
  }
});
