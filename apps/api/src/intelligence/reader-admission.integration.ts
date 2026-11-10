import assert from "node:assert/strict";
import test from "node:test";
import { withReadPriority } from "../reader-work";
process.env.CLARITAS_RUNTIME_ROLE = "api";
const { pool, query } = require("../db") as typeof import("../db");

test("core reads and readiness succeed during a real database burst of optional page requests", async () => {
  let optionalFinished = 0;
  const background = Array.from({ length: 24 }, () => withReadPriority("optional", async () => {
    await query("SELECT pg_sleep(0.05)"); optionalFinished++;
  }));
  const [core, probe] = await Promise.all([
    withReadPriority("core", () => query<{ result: number }>("SELECT 42 AS result")),
    pool.query("SELECT 1 AS ready"),
  ]);
  assert.equal(core.rows[0].result, 42);
  assert.equal(probe.rows[0].ready, 1);
  assert.ok(optionalFinished < 24, "core/probe must not wait behind the entire optional backlog");
  await Promise.all(background);
  assert.equal(pool.waitingCount, 0);
});
test.after(async () => { await pool.end(); });
