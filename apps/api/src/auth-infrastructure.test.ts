import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function repositoryFile(path: string): string {
  return readFileSync(resolve(__dirname, "../../..", path), "utf8");
}

const bootstrapConfig = repositoryFile("infra/k8s/keycloak-bootstrap-configmap.yaml");
const bootstrapJob = repositoryFile("infra/k8s/keycloak-bootstrap-job.yaml");
const applicationConfig = repositoryFile("infra/k8s/config/claritas-config.yaml");
const exampleApplicationConfig = repositoryFile("infra/k8s/config/db-config.yaml");
const apiDeployment = repositoryFile("infra/k8s/api-deployment.yaml");
const ingress = repositoryFile("infra/k8s/ingress.yaml");
const frontendConfig = repositoryFile("infra/k8s/frontendconfig.yaml");
const apiBackendConfig = repositoryFile("infra/k8s/api-backendconfig.yaml");
const keycloakBackendConfig = repositoryFile("infra/k8s/keycloak-backendconfig.yaml");
const webDockerfile = repositoryFile("apps/web/Dockerfile");
const releaseWorkflow = repositoryFile(".github/workflows/gke-deploy.yml");
const authGuide = repositoryFile("docs/configuration/apple-and-microsoft-sign-in.md");

function embeddedBootstrapScript(): string {
  const marker = "  bootstrap.sh: |\n";
  const markerIndex = bootstrapConfig.indexOf(marker);
  assert.notEqual(markerIndex, -1, "bootstrap ConfigMap must contain an embedded script");
  return bootstrapConfig
    .slice(markerIndex + marker.length)
    .split("\n")
    .map((line) => line.startsWith("    ") ? line.slice(4) : line)
    .join("\n");
}

test("Keycloak bootstrap script is valid Bash", () => {
  const result = spawnSync("bash", ["-n"], {
    input: embeddedBootstrapScript(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("advertised identity providers fail closed during bootstrap", () => {
  assert.match(bootstrapJob, /- name: AUTH_PROVIDERS\s+valueFrom: \{ configMapKeyRef: \{ name: claritas-config, key: AUTH_PROVIDERS \} \}/);
  assert.match(bootstrapConfig, /Google is advertised by AUTH_PROVIDERS but its credentials are absent/);
  assert.match(bootstrapConfig, /Microsoft is advertised by AUTH_PROVIDERS but its credentials are absent/);
  assert.match(bootstrapConfig, /Apple is advertised by AUTH_PROVIDERS but its credentials are absent/);
  assert.match(bootstrapConfig, /upsert_idp "microsoft" "\$payload" "microsoft" "clientId,clientSecret,tenantId"/);
  assert.match(bootstrapConfig, /upsert_idp "apple" "\$payload" "apple" "clientId,clientSecret,teamId,keyId"/);
  assert.match(bootstrapConfig, /Identity provider \$\{alias\} is missing required config/);
});

test("Microsoft is single-tenant by default and multi-tenant mode disables email linking", () => {
  assert.match(applicationConfig, /AUTH_MICROSOFT_MULTI_TENANT_ENABLED: "false"/);
  assert.match(exampleApplicationConfig, /AUTH_MICROSOFT_MULTI_TENANT_ENABLED: "false"/);
  assert.match(bootstrapJob, /- name: AUTH_MICROSOFT_MULTI_TENANT_ENABLED/);
  assert.match(apiDeployment, /- name: AUTH_MICROSOFT_MULTI_TENANT_ENABLED/);
  assert.doesNotMatch(bootstrapConfig, /KC_IDP_MICROSOFT_TENANT:-common/);
  assert.match(
    bootstrapConfig,
    /if \[ -z "\$\{KC_IDP_MICROSOFT_CLIENT_ID:-\}" \] && \[ -z "\$\{KC_IDP_MICROSOFT_CLIENT_SECRET:-\}" \]; then/,
  );
  assert.match(bootstrapConfig, /Microsoft multi-tenant alias \$\{tenant\} requires AUTH_MICROSOFT_MULTI_TENANT_ENABLED=true/);
  assert.match(authGuide, /deliberately disables\s+automatic application-account linking by email/);
});

test("API client receives broker provenance and local account entry points stay disabled", () => {
  assert.match(bootstrapConfig, /KEYCLOAK_MOBILE_REDIRECT_URIS="\$\{KEYCLOAK_MOBILE_REDIRECT_URIS:-claritas:\/\/auth\/callback\}"/);
  assert.doesNotMatch(bootstrapConfig, /claritas:\/\/auth\/\*/);
  assert.match(bootstrapConfig, /"protocolMapper": "oidc-usersessionmodel-note-mapper"/);
  assert.match(bootstrapConfig, /"user\.session\.note": "identity_provider"/);
  assert.match(bootstrapConfig, /"claim\.name": "identity_provider"/);
  assert.match(bootstrapConfig, /"id\.token\.claim": "true"/);
  assert.match(bootstrapConfig, /registrationAllowed=false/);
  assert.match(bootstrapConfig, /resetPasswordAllowed=false/);
  assert.doesNotMatch(bootstrapConfig, /registrationAllowed=true/);
  assert.match(bootstrapConfig, /directAccessGrantsEnabled\\": false/);
});

test("the rolling release keeps the legacy redirect key without weakening the current API", () => {
  assert.match(applicationConfig, /AUTH_ALLOWED_REDIRECT_SCHEMES: "claritas"/);
  assert.doesNotMatch(apiDeployment, /- name: AUTH_ALLOWED_REDIRECT_SCHEMES/);
  assert.match(applicationConfig, /current API ignores it and validates exact parsed/);
});

test("GKE redirects HTTP at the edge and returns HSTS from every HTTPS backend", () => {
  assert.match(frontendConfig, /apiVersion: networking\.gke\.io\/v1beta1/);
  assert.match(frontendConfig, /redirectToHttps:\s+enabled: true\s+responseCodeName: PERMANENT_REDIRECT/);
  assert.match(ingress, /networking\.gke\.io\/v1beta1\.FrontendConfig: "claritas-frontendconfig"/);
  assert.match(ingress, /kubernetes\.io\/ingress\.allow-http: "true"/);
  assert.match(apiBackendConfig, /Strict-Transport-Security: max-age=31536000/);
  assert.match(keycloakBackendConfig, /Strict-Transport-Security: max-age=31536000/);
  assert.match(webDockerfile, /add_header Strict-Transport-Security "max-age=31536000" always;/);

  const frontendApply = releaseWorkflow.indexOf("kubectl apply -f ./infra/k8s/frontendconfig.yaml");
  const ingressApply = releaseWorkflow.indexOf("kubectl apply -f ./infra/k8s/ingress.yaml");
  assert.ok(frontendApply >= 0, "release must apply FrontendConfig");
  assert.ok(ingressApply > frontendApply, "release must apply FrontendConfig before Ingress");
});

test("operations guide covers private relay and forward-only maintenance", () => {
  assert.match(authGuide, /Private Email\s+Relay/);
  assert.match(authGuide, /privaterelay\.appleid\.com/);
  assert.match(authGuide, /scheduled authentication\s+maintenance\s+window/);
  assert.match(authGuide, /HTTP 308 redirect/);
});
