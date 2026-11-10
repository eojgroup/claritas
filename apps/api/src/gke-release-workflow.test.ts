import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(resolve(
  __dirname,
  "../../../.github/workflows/gke-deploy.yml",
), "utf8");
const terraformWorkflow = readFileSync(resolve(
  __dirname,
  "../../../.github/workflows/terraform-deploy.yml",
), "utf8");
const terraformAuthSecret = readFileSync(resolve(
  __dirname,
  "../../../infra/gcp/terraform/k8s-secrets.tf",
), "utf8");

test("migration scripts avoid duplicating their SQL in a client-side apply annotation", () => {
  const start = workflow.indexOf('scripts="flyway-scripts-${GITHUB_RUN_ID}"');
  const config = workflow.slice(start, workflow.indexOf("# Use a unique Job name", start));
  assert.ok(start >= 0);
  assert.match(config, /--from-file=infra\/gcp\/sql\//);
  assert.match(config, /kubectl apply --server-side --field-manager=claritas-release -f -/);
});

test("Cloud SQL reconciliation retries busy operations without hiding permanent failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "claritas-cloud-sql-"));
  try {
    writeFileSync(join(directory, "gcloud"), `#!/usr/bin/env node
const fs = require("node:fs");
const file = process.env.COUNTER_FILE;
const count = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) + 1 : 1;
fs.writeFileSync(file, String(count));
if (process.env.SCENARIO === "recovers" && count === 2) process.exit(0);
const failure = process.env.SCENARIO === "permanent"
  ? "HTTPError 403: Permission denied"
  : "HTTPError 409: Operation failed because another operation was already in progress. Try your request after the current operation is complete.";
console.error(failure + " password=" + process.env.CLARITAS_SQL_PASSWORD);
process.exit(1);
`, { mode: 0o755 });
    for (const [scenario, expectedStatus, expectedAttempts] of [
      ["recovers", 0, 2], ["permanent", 1, 1], ["exhausted", 1, 3],
    ] as const) {
      const counter = join(directory, scenario);
      const result = spawnSync("bash", [
        resolve(__dirname, "../../../infra/scripts/reconcile-cloud-sql-password.sh"),
        "test-project", "test-instance", "test-user",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          COUNTER_FILE: counter,
          SCENARIO: scenario,
          CLARITAS_SQL_PASSWORD: "synthetic-secret-do-not-log",
          CLOUD_SQL_PASSWORD_ATTEMPTS: "3",
          CLOUD_SQL_PASSWORD_RETRY_SECONDS: "0",
        },
      });
      assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
      assert.equal(Number(readFileSync(counter, "utf8")), expectedAttempts);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-do-not-log/);
      if (expectedStatus !== 0) assert.match(result.stderr, /\[REDACTED\]/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GKE release gates provider liveness without gating instantaneous Singapore occupancy", () => {
  const transportGate = workflow.slice(
    workflow.indexOf("# Query every pod over its loopback interface"),
    workflow.indexOf("# Report the Singapore regression"),
  );
  const singaporeStart = workflow.indexOf("# Report the Singapore regression");
  const singaporeEnd = workflow.indexOf("\n      - name:", singaporeStart);
  assert.ok(singaporeStart >= 0 && singaporeEnd > singaporeStart,
    "Singapore diagnostics must be bounded by their containing workflow step");
  // The diagnostic is now executed on the ingestion worker. A container name
  // is not a reliable boundary: a missing match used to include every later
  // release gate and incorrectly reject its required `exit 1` statements.
  const singaporeDiagnostic = workflow.slice(singaporeStart, singaporeEnd);

  assert.match(transportGate, /No transport leader reported a current AISstream primary or an explicit current regional fallback/);
  assert.match(transportGate, /exit 1/);
  assert.match(singaporeDiagnostic, /internal\/transport\/singapore-health/);
  assert.match(singaporeDiagnostic, /Singapore maritime positions unavailable/);
  assert.match(singaporeDiagnostic, /external coverage diagnostic, not an application rollout failure/);
  assert.doesNotMatch(singaporeDiagnostic, /singapore_transport_ready/);
  assert.doesNotMatch(singaporeDiagnostic, /exit 1/);
  assert.doesNotMatch(singaporeDiagnostic, /seq 1 24/);
});

test("identity deploys use an immutable image and preserve omitted live auth keys", () => {
  assert.match(workflow, /keycloak_image: \$\{\{ steps\.resolve_keycloak_image\.outputs\.image \}\}/);
  assert.match(workflow, /bash infra\/scripts\/resolve-image-digest\.sh "\$ref"/);
  assert.match(workflow, /image="\$\{IMAGE_URI_KEYCLOAK\}@\$\{digest\}"/);
  assert.match(workflow, /KEYCLOAK_IMAGE: \$\{\{ needs\.build\.outputs\.keycloak_image \}\}/);
  assert.match(
    workflow,
    /kubectl set image -f \.\/infra\/k8s\/keycloak-deployment\.yaml[\s\S]*keycloak="\$KEYCLOAK_IMAGE" --local -o yaml \| kubectl apply -f -/,
  );
  assert.match(workflow, /kubectl -n "\$NS" patch secret claritas-auth --type merge/);
  assert.match(terraformWorkflow, /kubectl -n "\$ns" patch secret claritas-auth --type merge/);
  assert.match(terraformAuthSecret, /lifecycle \{[\s\S]*ignore_changes = \[data\][\s\S]*\}/);
});

test("production workflows recover only pods Kubernetes has already marked for deletion", () => {
  for (const releaseWorkflow of [workflow, terraformWorkflow]) {
    assert.match(releaseWorkflow, /select\(\.metadata\.deletionTimestamp != null\)/);
    assert.match(releaseWorkflow, /delete pod "\$pod" --force --grace-period=0 --wait=false/);
    assert.doesNotMatch(releaseWorkflow, /delete pods? -l .*--force/);
  }
});
