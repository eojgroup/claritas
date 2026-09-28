import assert from "node:assert/strict";
import test from "node:test";
const { waitForApiReadiness } = require("../../../infra/scripts/wait-for-api-readiness.cjs");

test("release readiness tolerates startup timeout and 503 before recovering", async () => {
  let calls = 0;
  const waits: number[] = [];
  await waitForApiReadiness({
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error("TimeoutError");
      return { ok: calls === 3, status: calls === 3 ? 200 : 503 };
    },
    sleep: async (ms: number) => { waits.push(ms); }, log: () => {},
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 5000]);
});

test("persistent readiness failure remains a bounded release failure", async () => {
  let calls = 0;
  let waits = 0;
  await assert.rejects(waitForApiReadiness({
    fetchImpl: async () => { calls++; return { ok: false, status: 503 }; },
    sleep: async () => { waits++; }, log: () => {},
  }), /failed after 6 attempts/);
  assert.equal(calls, 6);
  assert.equal(waits, 5);
});
