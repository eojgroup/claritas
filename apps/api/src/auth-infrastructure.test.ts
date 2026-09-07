import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

function runMapperBootstrap(options: { listFailure?: boolean; duplicate?: boolean } = {}) {
  const script = embeddedBootstrapScript();
  const start = script.indexOf("client_internal_id() {");
  const end = script.indexOf("upsert_idp() {", start);
  assert.ok(start >= 0 && end > start);
  const directory = mkdtempSync(resolve(tmpdir(), "claritas-keycloak-mapper-"));
  try {
    // This fixture models the pinned Keycloak CLI's -f / -s behavior and the
    // mapper PUT contract: its representation id must match the existing model.
    const result = spawnSync("bash", [], {
      input: `set -euo pipefail
KCADM=fixture
KEYCLOAK_REALM=claritas
log() { echo "$*"; }
trim() { echo "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
fixture() {
  local action="$1" resource="$2" payload="" supplied_id=""
  shift 2
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f) payload="$2"; shift 2 ;;
      -s) supplied_id="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "$action $resource" in
    'get clients') echo '[{ "id" : "client-123" }]' ;;
    'get clients/client-123/protocol-mappers/models')
      if [ "$FIXTURE_LIST_FAILURE" = true ]; then
        echo 'mapper listing failed' >&2
        return 42
      fi
      if [ -f "$FIXTURE_DIRECTORY/mapper.json" ]; then
        echo 'mapper-123,claritas-identity-provider'
      fi
      if [ "$FIXTURE_DUPLICATE" = true ]; then
        echo 'mapper-duplicate-1,claritas-identity-provider'
        echo 'mapper-duplicate-2,claritas-identity-provider'
      fi
      ;;
    'create clients/client-123/protocol-mappers/models')
      cp "$payload" "$FIXTURE_DIRECTORY/mapper.json"
      echo create >> "$FIXTURE_DIRECTORY/mutations"
      ;;
    'update clients/client-123/protocol-mappers/models/mapper-123')
      if [ "$supplied_id" != 'id=mapper-123' ]; then
        echo 'mapping with id null does not exist' >&2
        return 1
      fi
      cp "$payload" "$FIXTURE_DIRECTORY/mapper.json"
      echo update >> "$FIXTURE_DIRECTORY/mutations"
      ;;
    'get clients/client-123/protocol-mappers/models/mapper-123')
      sed 's/": /" : /g' "$FIXTURE_DIRECTORY/mapper.json"
      ;;
    *) echo "Unexpected fixture command: $action $resource" >&2; return 1 ;;
  esac
}
${script.slice(start, end)}
configure_identity_provider_claim_mapper claritas-api
configure_identity_provider_claim_mapper claritas-api
`,
      encoding: "utf8",
      env: {
        ...process.env,
        FIXTURE_DIRECTORY: directory,
        FIXTURE_LIST_FAILURE: String(options.listFailure ?? false),
        FIXTURE_DUPLICATE: String(options.duplicate ?? false),
      },
    });
    return {
      ...result,
      mutations: existsSync(resolve(directory, "mutations"))
        ? readFileSync(resolve(directory, "mutations"), "utf8").trim().split("\n")
        : [],
      mapper: existsSync(resolve(directory, "mapper.json"))
        ? JSON.parse(readFileSync(resolve(directory, "mapper.json"), "utf8"))
        : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("identity-provider mapper bootstrap creates once and updates the same mapper on repeat", () => {
  const result = runMapperBootstrap();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.mutations, ["create", "update"]);
  assert.equal(result.mapper.protocolMapper, "oidc-usersessionmodel-note-mapper");
  assert.equal(result.mapper.config["user.session.note"], "identity_provider");
  assert.equal(result.mapper.config["id.token.claim"], "true");
  assert.equal(result.mapper.config["access.token.claim"], "false");
});

test("identity-provider mapper bootstrap stops on lookup failure without creating a duplicate", () => {
  const result = runMapperBootstrap({ listFailure: true });
  assert.equal(result.status, 42, result.stderr || result.stdout);
  assert.deepEqual(result.mutations, []);
  assert.match(result.stderr, /mapper listing failed/);
});

test("identity-provider mapper bootstrap rejects duplicate existing mappers", () => {
  const result = runMapperBootstrap({ duplicate: true });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.deepEqual(result.mutations, []);
  assert.match(result.stdout, /duplicate claritas-identity-provider protocol mappers/);
});

test("Keycloak server checks accept large valid responses and reject missing requirements", () => {
  const script = embeddedBootstrapScript();
  const start = script.indexOf('server_info="$("$KCADM" get serverinfo)"');
  const end = script.indexOf('if "$KCADM" get "realms/', start);
  assert.ok(start >= 0 && end > start);
  const checks = script.slice(start, end);
  const padding = `${"x".repeat(200)}\n`.repeat(10_000);

  for (const [header, expectedStatus, expectedMessage] of [
    ['{"version" : "26.7.3", "id" : "apple"}', 0, "verified"],
    ['{"version" : "26.6.0", "id" : "apple"}', 1, "not the reviewed"],
    ['{"version" : "26.7.3", "id" : "google"}', 1, "extension is not loaded"],
  ] as const) {
    // Execute the production checks with a response larger than a pipe buffer.
    // The original printf | grep -q pipeline rejected the valid first fixture.
    const fixtureResult = spawnSync("bash", [], {
      input: `set -euo pipefail
log() { echo "$*"; }
KCADM=fixture
fixture() { command cat <<'KEYCLOAK_FIXTURE'
${header}
${padding}
KEYCLOAK_FIXTURE
}
${checks}
echo verified
`,
      encoding: "utf8",
    });
    assert.equal(fixtureResult.status, expectedStatus, fixtureResult.stderr || fixtureResult.stdout);
    assert.ok(fixtureResult.stdout.includes(expectedMessage), fixtureResult.stdout);
  }
});

test("Keycloak bootstrap retains failed attempts and stops waiting when the job fails", () => {
  assert.match(bootstrapJob, /restartPolicy: Never/);
  assert.match(bootstrapJob, /activeDeadlineSeconds: 540/);
  const start = releaseWorkflow.indexOf("- name: 🔑 Bootstrap Keycloak realm and IdPs");
  const end = releaseWorkflow.indexOf("- name: 🧩 Run DB migrations", start);
  const step = releaseWorkflow.slice(start, end);
  assert.match(step, /wait-for-k8s-job\.sh "\$NS" "\$job" 600/);
  assert.match(step, /logs "\$pod" -c bootstrap --tail=200/);
  assert.doesNotMatch(step, /wait --for=condition=complete/);
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
