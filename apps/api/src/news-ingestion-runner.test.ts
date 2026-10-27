import assert from "node:assert/strict";
import test from "node:test";
import { createNewsProgressReporter, runIndependentNewsProviders, type NewsIngestionProgress } from "./news-ingestion-runner";

test("a slow GDELT provider does not block independent primary releases", async () => {
  let finishGdelt!: () => void;
  const gdelt = new Promise<void>((resolve) => { finishGdelt = resolve; });
  let finishPrimary!: () => void;
  const primary = new Promise<void>((resolve) => { finishPrimary = resolve; });
  const completed: string[] = [];
  const pending = runIndependentNewsProviders([
    async () => { await gdelt; completed.push("gdelt"); },
    async () => { completed.push("rss"); },
    async () => { completed.push("govuk"); finishPrimary(); },
  ]);
  await primary;
  assert.deepEqual(completed, ["rss", "govuk"]);
  finishGdelt();
  await pending;
  assert.deepEqual(completed, ["rss", "govuk", "gdelt"]);
});

test("a failed provider leaves remaining acquisition tasks runnable", async () => {
  const completed: string[] = [];
  await assert.rejects(runIndependentNewsProviders([
    async () => { throw new Error("provider unavailable"); },
    async () => { completed.push("rss"); },
    async () => { completed.push("govuk"); },
  ]), /orchestration failed/);
  assert.deepEqual(completed, ["rss", "govuk"]);
});

test("parallel progress retains both providers and recovers from a telemetry failure", async () => {
  const snapshots: NewsIngestionProgress[] = [];
  let writes = 0;
  const report = createNewsProgressReporter(async (progress) => {
    writes += 1;
    if (writes === 1) throw new Error("temporary database failure");
    snapshots.push(progress);
  });
  const first = report("gdelt", "discovery");
  const second = report("rss", "persisted", { articles: 8 });
  await assert.rejects(first, /temporary database failure/);
  await second;
  await report("gdelt", "persisted", { articles: 120 });
  assert.equal(snapshots.at(-1)?.gdelt.phase, "persisted");
  assert.equal(snapshots.at(-1)?.rss.details.articles, 8);
  assert.equal(snapshots[0].gdelt.phase, "discovery", "published snapshots must not mutate later");
});
