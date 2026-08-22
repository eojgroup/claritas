import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(
  __dirname,
  "../../../.github/workflows/gke-deploy.yml",
), "utf8");

test("GKE release gates provider liveness without gating instantaneous Singapore occupancy", () => {
  const transportGate = workflow.slice(
    workflow.indexOf("# Query every pod over its loopback interface"),
    workflow.indexOf("# Report the Singapore regression"),
  );
  const singaporeDiagnostic = workflow.slice(
    workflow.indexOf("# Report the Singapore regression"),
    workflow.indexOf("kubectl -n \"${NAMESPACE}\" logs deployment/claritas-api", workflow.indexOf("# Report the Singapore regression")),
  );

  assert.match(transportGate, /No transport leader reported a current AISstream primary or an explicit current regional fallback/);
  assert.match(transportGate, /exit 1/);
  assert.match(singaporeDiagnostic, /internal\/transport\/singapore-health/);
  assert.match(singaporeDiagnostic, /Singapore maritime positions unavailable/);
  assert.match(singaporeDiagnostic, /external coverage diagnostic, not an application rollout failure/);
  assert.doesNotMatch(singaporeDiagnostic, /singapore_transport_ready/);
  assert.doesNotMatch(singaporeDiagnostic, /exit 1/);
  assert.doesNotMatch(singaporeDiagnostic, /seq 1 24/);
});
