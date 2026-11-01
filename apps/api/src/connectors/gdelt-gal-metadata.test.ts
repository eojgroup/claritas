import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fetchGdeltGalMetadataMinute, gdeltMinuteStamp, parseGdeltGalMetadata, planGdeltGalMinutes, selectGdeltGalMetadataSample, type GdeltGalMetadataRecord } from "./gdelt-gal-metadata";
import { readGdeltBody } from "./gdelt-io";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("GAL retains original language and separates ambiguous provider time from immutable file time", () => {
  const rows = [
    { title: "الأسواق ترتفع بعد القرار", lang: "ar", url: "https://arabic.example.com/economy/decision", date: "20261027120000", desc: "Publisher excerpt" },
    { title: "央行公布利率决定", lang: "zh", url: "https://chinese.example.com/news/decision", date: "2026-10-27T12:01:00Z" },
    { title: "Unknown language", lang: "xx", url: "https://unknown.example.com/news/report" },
  ];
  const parsed = parseGdeltGalMetadata(rows.map((row) => JSON.stringify(row)).join("\n"), "20261027120500");
  assert.equal(parsed.records[0].title, rows[0].title);
  assert.deepEqual(parsed.records.map((row) => row.languageCode), ["ar", "zh", "und"]);
  assert.equal(parsed.records[0].providerTime, "2026-10-27T12:00:00.000Z");
  assert.equal(parsed.records[0].firstSeenAt, "2026-10-27T12:05:00.000Z");
  assert.throws(() => parseGdeltGalMetadata('{"title":"partial"', "20261027120500"), /malformed JSON/);
  assert.throws(() => parseGdeltGalMetadata("", "20260230000100"), /Invalid.*minute/);
});

test("GAL bounds catch-up and retries failed intervals across hour boundaries", () => {
  const plan = planGdeltGalMinutes({ through_minute: "20261027090000", retry_minutes: ["20261027115900", "20261027000000"] }, new Date("2026-10-27T12:10:00Z"));
  assert.equal(plan.minutes[0], "20261027115900");
  assert.ok(plan.minutes.includes("20261027113800"));
  assert.equal(plan.throughMinute, "20261027120700");
  assert.equal(plan.skippedBacklogMinutes, 157);
  assert.ok(plan.minutes.length <= 34);
  const future = planGdeltGalMinutes({ through_minute: "20271027090000" }, new Date("2026-10-27T12:10:00Z"));
  assert.equal(future.throughMinute, "20261027120700");
  assert.equal(future.minutes.length, 15);
});

test("one English publisher cannot monopolize the multilingual sample", () => {
  const record = (url: string, languageCode: string): GdeltGalMetadataRecord => ({ url, languageCode, title: "Publisher headline", description: null, image: null, outletName: null, providerTime: null, firstSeenAt: "2026-10-27T12:00:00Z" });
  const rows = [...Array.from({ length: 100 }, (_, index) => record(`https://large.example.com/news/${index}`, "en")), record("https://small.example.com/news/one", "en"), record("https://arabic.example.com/news/one", "ar"), record("https://chinese.example.com/news/one", "zh"), record("https://arabic.example.com/news/one", "ar")];
  const selected = selectGdeltGalMetadataSample(rows, 5);
  assert.equal(selected.length, 5);
  assert.deepEqual(new Set(selected.map((row) => row.languageCode)), new Set(["en", "ar", "zh"]));
  assert.ok(selected.some((row) => row.url.includes("small.example.com")));
  assert.equal(new Set(selected.map((row) => row.url)).size, selected.length);
});

test("metadata download bounds compressed/expanded bytes and a stalled body", async () => {
  const row = JSON.stringify({ title: "Economic report", url: "https://news.example.com/economy/report", lang: "en" });
  assert.equal(await fetchGdeltGalMetadataMinute("20261027120000", { request: async () => new Response(gzipSync(row)) }), row);
  assert.equal(await fetchGdeltGalMetadataMinute("20261027120000", { request: async () => new Response(null, { status: 404 }) }), null);
  await assert.rejects(fetchGdeltGalMetadataMinute("20261027120000", { request: async () => new Response(gzipSync(Buffer.alloc(33 * 1024 * 1024, 65))) }), /larger than|buffer|length|size/i);
  await assert.rejects(readGdeltBody(new Response("too large"), 2), /exceeds/);
  const controller = new AbortController();
  let cancelled = false;
  const stalled = readGdeltBody(new Response(new ReadableStream({ cancel() { cancelled = true; } })), 100, controller.signal);
  controller.abort(new Error("acquisition budget ended"));
  await assert.rejects(stalled, /acquisition budget ended/);
  assert.equal(cancelled, true);
});

test("metadata persists multilingual news before cursor acknowledgement and filters stale rows before quota", async () => {
  const { pool } = await import("../db");
  const { ingestGdelt, ingestGdeltGalMetadata } = await import("./gdelt");
  const originalConnect = pool.connect;
  const originalFetch = globalThis.fetch;
  const originalDocQuery = process.env.GDELT_DOC_QUERY;
  let activeDownloads = 0;
  let maxDownloads = 0;
  let historyChecks = 0;
  let docRequests = 0;
  let failRecord = false;
  let expectedWrites = 2;
  const minute = gdeltMinuteStamp(new Date(Date.now() - 4 * 60_000));
  const olderMinute = gdeltMinuteStamp(new Date(Date.now() - 5 * 60_000));
  const state: { cursor: any; writes: Array<{ title: string; summary: string | null; payload: any; language: string }>; failWrites: boolean; acknowledgements: number } = { cursor: null, writes: [], failWrites: false, acknowledgements: 0 };
  pool.connect = (async () => ({
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes("pg_advisory_xact_lock")) historyChecks += 1;
      if (sql.startsWith("INSERT INTO source (")) return { rows: [{ id: 991 }] };
      if (sql.includes("INSERT INTO background_worker_lease")) return { rows: [{ acquired: true }] };
      if (sql.startsWith("SELECT cursor") && params[1] === "gal_minute_metadata_v1") return { rows: state.cursor ? [{ cursor: state.cursor }] : [] };
      if (sql.includes("INSERT INTO source_feed") && params[1] === "gal_minute_metadata_v1") {
        assert.equal(state.writes.length, expectedWrites, "selected stories must persist before acknowledgement");
        state.cursor = JSON.parse(params[3]); state.acknowledgements += 1;
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO item(")) {
        if (state.failWrites) throw Object.assign(new Error("database unavailable"), { code: "08006" });
        if (failRecord) {
          failRecord = false;
          throw Object.assign(new Error("record constraint"), { code: "23514" });
        }
        state.writes.push({ title: params[2], summary: params[3], payload: JSON.parse(params[7]), language: params[9] });
        return { rows: [{ id: String(state.writes.length), inserted: true, event_time: params[6] }] };
      }
      return { rows: [] };
    }, release() {},
  })) as any;
  const rows = [
    { title: "قديم جدا", url: "https://stale.example.com/world/story", lang: "ar", date: "2020-01-01T00:00:00Z" },
    { title: "الأسواق ترتفع بعد القرار", url: "https://arabic.example.com/economy/decision", lang: "ar", date: new Date().toISOString(), desc: "Original Arabic publisher excerpt" },
    { title: "央行公布利率决定", url: "https://chinese.example.com/economy/decision", lang: "zh", date: new Date().toISOString() },
  ].map((row) => JSON.stringify(row)).join("\n");
  globalThis.fetch = (async (url) => {
    if (String(url).includes("/api/v2/doc/")) docRequests += 1;
    activeDownloads += 1;
    maxDownloads = Math.max(maxDownloads, activeDownloads);
    const olderObject = String(url).includes(`/${olderMinute}.gal.json.gz`);
    // Complete the older repeated URL last to exercise parallel ordering.
    await new Promise((resolve) => setTimeout(resolve, olderObject ? 12 : 2));
    activeDownloads -= 1;
    return olderObject || String(url).includes(`/${minute}.gal.json.gz`) ? new Response(gzipSync(rows)) : new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    process.env.GDELT_DOC_QUERY = "legacy DOC query";
    const run = await ingestGdelt({ maxRecords: 2, includeEvents: false, includeGkg: false });
    assert.equal(run.acquisition_strategy, "incremental_gal_metadata", "legacy DOC configuration must not disable the primary metadata stream");
    assert.equal(run.doc_status, "not_requested");
    assert.equal(docRequests, 0);
    const result = run.gal_primary as Record<string, unknown>;
    assert.equal(result.selected, 2);
    assert.ok(maxDownloads > 1 && maxDownloads <= 3, "minute downloads use three bounded IO slots");
    assert.equal(historyChecks, 1, "historical identity is validated once per acquisition");
    assert.equal(result.health, "healthy");
    assert.equal((result.quality_rejections as any).publisher_published_at_stale, 1);
    assert.deepEqual(new Set(state.writes.map((row) => row.language)), new Set(["ar", "zh"]));
    assert.ok(state.writes.every((row) => row.payload.time_basis === "provider_first_seen"));
    assert.ok(state.writes.every((row) => gdeltMinuteStamp(new Date(row.payload.first_provider_seen_at)) === olderMinute), "parallel duplicate objects retain the earliest first-seen interval");
    assert.ok(state.writes.every((row) => row.payload.publication_time_verified === false));
    assert.equal(state.writes[0].summary, "Original Arabic publisher excerpt");
    assert.equal(state.acknowledgements, 1);
    const quiet = await ingestGdeltGalMetadata(991, { maxRecords: 2 });
    assert.equal(quiet.health, "healthy");
    assert.equal(quiet.no_new_articles, true);
    assert.equal(quiet.selected, 0);
    assert.equal(quiet.latest_event_time, result.latest_event_time);
    assert.equal(state.acknowledgements, 2);
    state.cursor = null; state.failWrites = true;
    await assert.rejects(ingestGdeltGalMetadata(991, { maxRecords: 2 }), /database unavailable/);
    assert.equal(state.acknowledgements, 2, "a failed selected write must not advance the cursor");
    state.failWrites = false; state.writes = []; failRecord = true; expectedWrites = 1;
    const partial = await ingestGdeltGalMetadata(991, { maxRecords: 2 });
    assert.equal(partial.health, "degraded", "a selected write failure must remain visible");
    assert.equal(partial.persistence_failures, 1);
    assert.equal(partial.selected, 1);
    assert.ok(state.cursor.retry_minutes.includes(olderMinute), "a failed record's interval is retried");
    // Isolate the failed interval from the separately bounded retry queue for
    // normally absent minute objects.
    state.cursor.retry_minutes = [olderMinute];
    expectedWrites = 3;
    const replay = await ingestGdeltGalMetadata(991, { maxRecords: 2 });
    assert.equal(replay.selected, 2);
    assert.equal(replay.health, "healthy");
    assert.ok(!state.cursor.retry_minutes.includes(olderMinute), "successful replay acknowledges the interval");
  } finally {
    pool.connect = originalConnect; globalThis.fetch = originalFetch;
    if (originalDocQuery === undefined) delete process.env.GDELT_DOC_QUERY;
    else process.env.GDELT_DOC_QUERY = originalDocQuery;
  }
});
