import assert from "node:assert/strict";
import test from "node:test";
import { DailyBriefingDispatcher } from "./daily-briefing-dispatch";

test("queued daily briefings run without a client and slow generation cannot overlap", async () => {
  let finish!: () => void;
  const processed: string[] = [];
  const dispatcher = new DailyBriefingDispatcher({
    read: async () => ({ rows: [{ id: "persisted-job" }] }),
    lease: async (_name, _seconds, run) => { await run(); return true; },
    process: async (id) => { processed.push(id); await new Promise<void>((resolve) => { finish = resolve; }); },
  });
  const first = dispatcher.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(processed, ["persisted-job"]);
  assert.equal(await dispatcher.run("second-job"), false);
  finish();
  assert.equal(await first, true);
});

test("generation failure releases local admission and another worker's lease prevents duplicate work", async () => {
  let allowed = true;
  let calls = 0;
  const dispatcher = new DailyBriefingDispatcher({
    read: async () => ({ rows: [] }),
    lease: async (_name, _seconds, run) => { if (!allowed) return false; await run(); return true; },
    process: async () => { calls++; throw new Error("provider unavailable"); },
  });
  await assert.rejects(dispatcher.run("job"), /provider unavailable/);
  allowed = false;
  assert.equal(await dispatcher.run("job"), false);
  assert.equal(calls, 1);
  allowed = true;
  await assert.rejects(dispatcher.run("job"), /provider unavailable/);
  assert.equal(calls, 2);
});
