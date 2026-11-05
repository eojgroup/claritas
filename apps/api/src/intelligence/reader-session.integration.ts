import assert from "node:assert/strict";
import test from "node:test";

// This file has its own test process. Set the role before constructing the
// real pool, proving the PostgreSQL startup option rather than a SQL mock.
process.env.CLARITAS_RUNTIME_ROLE = "api";
const { pool } = require("../db") as typeof import("../db");

test("reader connections disable JIT before their first planned query", async () => {
  assert.equal(pool.options.options, "-c jit=off");
  const client = await pool.connect();
  try {
    const setting = await client.query<{ jit: string }>("SHOW jit");
    assert.equal(setting.rows[0].jit, "off");
    const plan = await client.query("EXPLAIN (FORMAT JSON) SELECT 1");
    assert.ok(plan.rows[0]["QUERY PLAN"]);
  } finally {
    client.release();
  }
});

test.after(async () => { await pool.end(); });
