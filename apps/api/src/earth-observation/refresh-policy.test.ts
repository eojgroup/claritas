import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("V43 refresh staging is invisible to pre-v3 workers", () => {
  const migration = readFileSync(resolve(
    __dirname,
    "../../../../infra/gcp/sql/V43__refresh_event_focused_true_color_previews.sql",
  ), "utf8");
  const service = readFileSync(resolve(__dirname, "service.ts"), "utf8");

  // Flyway executes before rollout: it may mark observations, but must never
  // place a render job into a status understood by the previous worker.
  assert.match(migration, /refresh_pending/);
  assert.doesNotMatch(migration, /UPDATE\s+earth_processing_job/i);
  assert.doesNotMatch(migration, /status\s*=\s*'queued'/i);

  const legacyClaim = service.slice(
    service.indexOf("async function claimEarthJob"),
    service.indexOf("async function recoverStaleImageryRefreshes"),
  );
  assert.match(legacyClaim, /'queued','failed','budget_deferred'/);
  assert.doesNotMatch(legacyClaim, /status[^\n]+success/i);

  const v3Claim = service.slice(
    service.indexOf("async function claimPendingImageryRefresh"),
    service.indexOf("async function finishEarthJob"),
  );
  assert.match(v3Claim, /job\.status='success'/);
  assert.match(v3Claim, /FOR UPDATE OF observation,job SKIP LOCKED/);
  assert.match(v3Claim, /SET status='running'/);
  assert.match(v3Claim, /methodology=.*-'refresh_pending'/s);

  const recovery = service.slice(
    service.indexOf("async function recoverStaleImageryRefreshes"),
    service.indexOf("async function claimPendingImageryRefresh"),
  );
  assert.match(recovery, /job\.status='running'/);
  assert.match(recovery, /required_worker_policy/);
  assert.match(recovery, /SET status='success'/);
  assert.match(recovery, /status='available'/);
  assert.match(recovery, /stale_worker_claim/);

  const workerCycle = service.slice(
    service.indexOf("async function runEarthWorkerCycle"),
    service.indexOf("export function startEarthObservationWorker"),
  );
  assert.ok(
    workerCycle.indexOf("recoverStaleImageryRefreshes")
      < workerCycle.indexOf("claimPendingImageryRefresh"),
    "stale protected claims must recover before the next refresh is claimed",
  );
  assert.ok(
    workerCycle.indexOf("recoverStaleEarthJobs")
      < workerCycle.indexOf("claimPendingImageryRefresh"),
    "ordinary stale claims must recover before the next job is claimed",
  );

  const ordinaryRecovery = service.slice(
    service.indexOf("export async function recoverStaleEarthJobs"),
    service.indexOf("async function claimPendingImageryRefresh"),
  );
  assert.match(ordinaryRecovery, /job\.status='running'/);
  assert.match(ordinaryRecovery, /required_worker_policy' IS DISTINCT FROM/);
  assert.match(ordinaryRecovery, /dead_letter/);
  assert.match(ordinaryRecovery, /status='processing'/);

  const render = service.slice(
    service.indexOf("async function processRender"),
    service.indexOf("async function enqueueVisionEnrichment"),
  );
  assert.match(render, /contentAddressedObservationObject/);
  assert.match(render, /ifGenerationMatch:\s*0/);
  assert.match(render, /file\.getMetadata\(\)/);
  assert.match(render, /EARTH_ASSET_BUCKET_LIFECYCLE_DAYS/);
  assert.doesNotMatch(render, /\.delete\(/);
  assert.match(render, /bucket's bounded lifecycle removes old and/);
  assert.match(render, /UPDATE earth_processing_job SET status='success'/);

  const failure = service.slice(
    service.indexOf("async function failEarthJob"),
    service.indexOf("async function runEarthWorkerCycle"),
  );
  assert.match(failure, /earth_render_failure_reconciled_after_commit/);
  assert.match(failure, /render_job\.status='success'/);
});
