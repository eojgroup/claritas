import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

test("identity deploys use an immutable image and preserve omitted live auth keys", () => {
  assert.match(workflow, /keycloak_image: \$\{\{ steps\.resolve_keycloak_image\.outputs\.image \}\}/);
  assert.match(workflow, /docker buildx imagetools inspect "\$ref"/);
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
