import assert from "node:assert/strict";
import test from "node:test";
import { boundedSourceReads } from "./bounded-source-reads";

test("briefing source reads keep tuple order and never exhaust the connection pool", async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 11 }, (_, id) => async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return id;
  });
  assert.deepEqual(await boundedSourceReads(tasks), Array.from({ length: 11 }, (_, id) => id));
  assert.equal(peak, 2);
});

test("failed source reads stop admission and settle in-flight work before returning", async () => {
  let settled = false;
  let extraStarted = false;
  await assert.rejects(boundedSourceReads([
    async () => { throw new Error("database unavailable"); },
    async () => { await new Promise((resolve) => setImmediate(resolve)); settled = true; },
    async () => { extraStarted = true; },
  ]), /database unavailable/);
  assert.equal(settled, true);
  assert.equal(extraStarted, false);
});
