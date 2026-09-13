import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildNativeHandoffRedirect,
  deriveS256CodeChallenge,
  isValidNativeCodeChallenge,
  isValidNativeCodeVerifier,
  resolveAllowedAuthRedirect,
} from "./auth-security";

test("web redirects use parsed exact-origin allowlisting", () => {
  const fallback = "https://app.claritas.info/auth/success";
  const allowlist = ["https://app.claritas.info", "http://localhost:5173"];

  assert.deepEqual(
    resolveAllowedAuthRedirect("https://app.claritas.info/map?country=SG", fallback, allowlist),
    { url: "https://app.claritas.info/map?country=SG", kind: "web" },
  );
  assert.deepEqual(
    resolveAllowedAuthRedirect("/news#latest", fallback, allowlist),
    { url: "https://app.claritas.info/news#latest", kind: "web" },
  );
  assert.equal(
    resolveAllowedAuthRedirect("https://app.claritas.info.evil.example/steal", fallback, allowlist)?.url,
    fallback,
  );
  assert.equal(
    resolveAllowedAuthRedirect("https://app.claritas.info@evil.example/steal", fallback, allowlist)?.url,
    fallback,
  );
  assert.equal(
    resolveAllowedAuthRedirect(undefined, "https://unlisted.example/success", allowlist),
    undefined,
  );
});

test("native redirects require an exact explicit scheme, host, and path", () => {
  const fallback = "https://app.claritas.info/auth/success";
  const allowlist = ["https://app.claritas.info", "claritas://auth/callback"];

  assert.deepEqual(
    resolveAllowedAuthRedirect("claritas://auth/callback?untrusted=1#fragment", fallback, allowlist),
    { url: "claritas://auth/callback", kind: "native" },
  );
  assert.equal(
    resolveAllowedAuthRedirect("claritas://evil/callback", fallback, allowlist)?.url,
    fallback,
  );
  assert.equal(
    resolveAllowedAuthRedirect("claritas://auth/other", fallback, allowlist)?.url,
    fallback,
  );
  assert.equal(
    resolveAllowedAuthRedirect("claritas://auth/callback", fallback, ["https://app.claritas.info", "claritas://"])?.url,
    fallback,
  );
  assert.equal(
    resolveAllowedAuthRedirect(
      "javascript://auth/callback",
      fallback,
      ["https://app.claritas.info", "javascript://auth/callback"],
    )?.url,
    fallback,
  );
});

test("native PKCE uses RFC 7636 S256 syntax and known derivation", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(isValidNativeCodeVerifier(verifier), true);
  assert.equal(deriveS256CodeChallenge(verifier), challenge);
  assert.equal(isValidNativeCodeChallenge(challenge), true);
  assert.equal(isValidNativeCodeVerifier("short"), false);
  assert.equal(isValidNativeCodeChallenge(`${challenge}=`), false);
  assert.equal(
    buildNativeHandoffRedirect("claritas://auth/callback?discard=me#discard", "abc_123"),
    "claritas://auth/callback?code=abc_123#",
  );
});

test("native handoff explicitly clears inherited browser fragments", () => {
  for (const suffix of ["", "#", "#provider-fragment", "?token=discard#token=discard"]) {
    const location = buildNativeHandoffRedirect(`claritas://auth/callback${suffix}`, "one-time-code");
    assert.equal(location, "claritas://auth/callback?code=one-time-code#");
    // URL.hash is empty for both absent and empty fragments, so assert the
    // serialized Location too: only the trailing # prevents inheritance.
    assert.ok(location.endsWith("#"));
    assert.equal(new URL(location).searchParams.get("token"), null);
  }
});

test("auth implementation binds state and exchanges native codes without URL bearers", () => {
  const authSource = readFileSync(resolve(__dirname, "auth.ts"), "utf8");
  const migration = readFileSync(resolve(
    __dirname,
    "../../../infra/gcp/sql/V56__secure_native_auth_handoff.sql",
  ), "utf8");
  const verifyJob = readFileSync(resolve(
    __dirname,
    "../../../infra/k8s/migrations/db-verify-job.yaml",
  ), "utf8");
  const productionConfig = readFileSync(resolve(
    __dirname,
    "../../../infra/k8s/config/claritas-config.yaml",
  ), "utf8");
  const gkeWorkflow = readFileSync(resolve(
    __dirname,
    "../../../.github/workflows/gke-deploy.yml",
  ), "utf8");
  const terraformWorkflow = readFileSync(resolve(
    __dirname,
    "../../../.github/workflows/terraform-deploy.yml",
  ), "utf8");

  assert.match(
    authSource,
    /DELETE FROM auth_state[\s\S]*provider = \$1[\s\S]*state = \$2[\s\S]*browser_binding_hash = \$3/,
  );
  assert.match(authSource, /consumeAuthState\(provider, stateParam, hashToken\(browserBinding\)\)/);
  assert.match(authSource, /httpOnly: true,[\s\S]*sameSite: "lax"/);
  assert.match(authSource, /if \(optionalEnv\("NODE_ENV"\) === "production"\) return true/);
  assert.match(authSource, /prompt: "login"/);
  assert.match(authSource, /claims\.identity_provider !== authState\.provider/);
  assert.match(authSource, /AUTH_MICROSOFT_MULTI_TENANT_ENABLED/);
  assert.match(authSource, /email && emailVerified && !microsoftMultiTenant/);
  assert.match(authSource, /const appUserEmail = microsoftMultiTenant \? null : email/);
  assert.match(authSource, /const appUserEmailVerified = microsoftMultiTenant \? false : emailVerified/);
  assert.match(authSource, /\[appUserEmail, appUserEmailVerified, displayName, avatarUrl\]/);
  assert.match(
    authSource,
    /\[userId, provider, providerSubject, email, emailVerified, displayName, avatarUrl, JSON\.stringify\(claims\)\]/,
  );
  assert.match(authSource, /resolveAllowedAuthRedirect\([\s\S]*AUTH_FAILURE_REDIRECT_URL/);
  assert.match(authSource, /DELETE FROM auth_native_handoff[\s\S]*code_hash = \$1[\s\S]*code_challenge = \$2/);
  assert.match(authSource, /authRouter\.post\("\/handoff"/);
  assert.doesNotMatch(authSource, /searchParams\.set\("token"/);
  assert.doesNotMatch(authSource, /searchParams\.set\("expires_at"/);

  assert.match(migration, /browser_binding_hash TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_native_handoff/);
  assert.match(verifyJob, /'auth_native_handoff'/);
  assert.match(verifyJob, /'auth_state', 'browser_binding_hash'/);
  assert.match(productionConfig, /AUTH_ALLOWED_REDIRECTS: "https:\/\/app\.claritas\.info,claritas:\/\/auth\/callback"/);
  assert.match(gkeWorkflow, /claritas:\/\/auth\/callback/);
  assert.match(terraformWorkflow, /claritas:\/\/auth\/callback/);
  assert.doesNotMatch(`${authSource}\n${gkeWorkflow}\n${terraformWorkflow}`, /AUTH_ALLOWED_REDIRECT_SCHEMES/);
});
