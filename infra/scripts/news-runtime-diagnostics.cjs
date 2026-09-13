#!/usr/bin/env node
"use strict";

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

function classifyError(value) {
  if (!value) return null;
  const message = typeof value === "string" ? value : String(value.message || "");
  const result = { fingerprint: createHash("sha256").update(message).digest("hex").slice(0, 16) };
  const patterns = [
    ["postgres_bind_type", /could not determine data type of parameter \$(\d+)/i],
    ["postgres_inconsistent_bind_type", /inconsistent types deduced for parameter \$(\d+)/i],
    ["postgres_bind_count", /bind message supplies (\d+) parameters, but prepared statement.*requires (\d+)/i],
    ["postgres_undefined_column", /column (?:"([a-z_][a-z0-9_.]*)"|([a-z_][a-z0-9_.]*)) does not exist/i],
    ["postgres_undefined_relation", /relation "([a-z_][a-z0-9_.]*)" does not exist/i],
    ["postgres_undefined_function", /function ([a-z_][a-z0-9_.]*)\([^)]*\) does not exist/i],
    ["postgres_operator", /operator does not exist/i],
    ["postgres_syntax", /syntax error at or near/i],
    ["postgres_invalid_input", /invalid input syntax for type ([a-z ]+):/i],
    ["postgres_json_shape", /cannot extract (?:elements|field) from a (?:scalar|object)|cannot get array length of a (?:scalar|non-array)/i],
    ["postgres_unique_constraint", /duplicate key value violates unique constraint/i],
    ["postgres_constraint", /violates (?:foreign key|check|not-null) constraint|null value in column/i],
    ["postgres_deadlock", /deadlock detected/i],
    ["postgres_connection_limit", /too many clients|remaining connection slots/i],
    ["postgres_connection", /connection terminated|connection closed|terminating connection/i],
    ["postgres_statement_timeout", /canceling statement due to statement timeout/i],
    ["javascript_reference", /([a-z_$][a-z0-9_$]*) is not defined/i],
    ["javascript_type", /is not a function|cannot read properties of|cannot convert undefined or null/i],
    ["invalid_date", /invalid time value/i],
    ["upstream_response_size", /response exceeds \d+ bytes/i],
    ["upstream_content_type", /unexpected .*content type/i],
    ["doc_empty", /no current persisted article/i],
    ["gal_empty", /no usable publisher headline/i],
    ["upstream_rate_limit", /\bHTTP\s+429\b/i],
    ["upstream_http", /\bHTTP\s+[1-5][0-9]{2}\b/i],
    ["timeout", /AbortError|TimeoutError|timeout|timed out|aborted/i],
    ["network", /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|terminated/i],
  ];
  for (const [kind, pattern] of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    result.class = kind;
    if (kind === "postgres_bind_type" || kind === "postgres_inconsistent_bind_type") result.parameter = Number(match[1]);
    if (kind === "postgres_bind_count") {
      result.supplied = Number(match[1]);
      result.required = Number(match[2]);
    }
    const identifier = match[1] || match[2];
    if (kind.startsWith("postgres_undefined_") && identifier
        && /^(?:public\.)?(?:item|source|country|news_|gdelt_|canonical_news_|ingestion_)/.test(identifier)) {
      result.object = identifier;
    }
    if (kind === "postgres_invalid_input" && /^(?:json|jsonb|integer|bigint|boolean|timestamp with time zone|timestamp without time zone|double precision|numeric|uuid)$/.test(identifier)) {
      result.type = identifier;
    }
    break;
  }
  result.class ||= "unclassified";
  const http = message.match(/\bHTTP\s+([1-5][0-9]{2})\b/i);
  if (http) result.http_status = Number(http[1]);
  if (typeof value === "object" && /^[0-9A-Z]{5}$/.test(value.code || "")) result.sqlstate = value.code;
  return result;
}

function counters(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const key of ["fetched", "accepted", "selected", "inserted", "updated", "unchanged", "skipped", "candidates", "budget", "gkg_sampled", "gkg_archives_scanned", "gkg_canonical_country_url_probes", "persistence_failures", "alias_synchronization_failures", "duration_ms", "assessed"]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) output[key] = value[key];
  }
  for (const key of ["quality_rejections", "persistence_failure_classes"]) {
    if (value[key] && typeof value[key] === "object") {
      output[key] = Object.fromEntries(Object.entries(value[key]).filter(([name, count]) => /^[a-z_]{1,64}$/.test(name) && typeof count === "number").slice(0, 30));
    }
  }
  return output;
}

function summarizeRun(run) {
  const steps = Array.isArray(run.stats?.steps) ? run.stats.steps : [];
  const step = steps.find((candidate) => candidate?.step === "gdelt/doc-event-gkg");
  const result = step?.result || {};
  const lanes = Array.isArray(result.articles?.discovery_lanes) ? result.articles.discovery_lanes : [];
  return {
    run_id: Number(run.id), status: run.status, trigger_mode: run.trigger_mode,
    started_at: run.started_at, finished_at: run.finished_at,
    gdelt_step_status: step?.status, counters: counters(result),
    step_error: classifyError(step?.error), doc_error: classifyError(result.doc_error),
    gal_error: classifyError(result.gal_error || result.gal_supplement_error),
    doc: counters(result.articles), gal: counters(result.gal_fallback || result.gal_supplement),
    doc_lanes: lanes.filter((lane) => lane && typeof lane === "object").slice(0, 12).map((lane) => ({
      id: /^[a-z_]{1,40}$/.test(lane.id) ? lane.id : "other",
      status: lane.status, counters: counters(lane), error: classifyError(lane.error),
    })),
  };
}

async function main() {
  if (process.argv[2] === "--logs") {
    for (const line of readFileSync(0, "utf8").split("\n")) {
      const start = line.indexOf("{");
      if (start < 0) continue;
      let value;
      try { value = JSON.parse(line.slice(start)); } catch { continue; }
      if (!/^(?:news_|gdelt_|ingestion_|database_)[a-z_]*$/.test(value.event || "")) continue;
      console.log(JSON.stringify({ event: value.event, ...counters(value), error: classifyError(value.error || value.message) }));
    }
    return;
  }
  const runID = process.argv[2] || "";
  if (runID && !/^[1-9][0-9]{0,14}$/.test(runID)) throw new Error("Invalid run identifier");
  const { Client } = require("pg");
  const client = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    ssl: false, application_name: "claritas-read-only-diagnostics",
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
    options: "-c default_transaction_read_only=on",
  });
  try {
    await client.connect();
    const social = await client.query(`SELECT
      (SELECT count(*)::int FROM social_signal WHERE expires_at > now()) AS retained_posts,
      (SELECT max(posted_at) FROM social_signal WHERE expires_at > now()) AS latest_post,
      (SELECT jsonb_build_object('enabled',enabled,'scheduled',schedule_enabled,'next_run',next_scheduled_at)
       FROM ingestion_automation_rule WHERE pipeline='social') AS collection,
      (SELECT jsonb_build_object('id',id,'status',status,'started_at',started_at,'stats',stats)
       FROM ingestion_run WHERE pipeline='social' ORDER BY id DESC LIMIT 1) AS last_run`);
    console.log(JSON.stringify({ social_runtime: social.rows[0] }));
    try {
      const { fetchBlueskySignals } = require(process.cwd() + "/dist/connectors/social-media.js");
      const probe = await fetchBlueskySignals("geopolitics", 3);
      console.log(JSON.stringify({ social_provider_probe: { provider: "bluesky", posts: probe.signals.length, requests: probe.requests } }));
    } catch (error) {
      console.log(JSON.stringify({ social_provider_probe: { provider: "bluesky", error: classifyError(error) } }));
    }
    const result = await client.query(`SELECT id,status,trigger_mode,started_at,finished_at,stats
      FROM ingestion_run WHERE pipeline='news' AND trigger_mode='release_gate'
        AND ($1::bigint IS NULL OR id=$1::bigint) ORDER BY id DESC LIMIT 1`, [runID || null]);
    if (!result.rows.length) throw new Error("Requested release run was not found");
    console.log(JSON.stringify(summarizeRun(result.rows[0])));
  } finally { await client.end(); }
}

module.exports = { classifyError, summarizeRun };
if (require.main === module || module.id === "[stdin]") {
  main().catch((error) => { console.error(JSON.stringify({ diagnostic_error: classifyError(error) })); process.exitCode = 1; });
}
