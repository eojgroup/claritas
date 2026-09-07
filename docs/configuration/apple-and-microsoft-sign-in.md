# Apple and Microsoft sign-in

Claritas uses Keycloak as an identity broker. The browser never sends a
Microsoft or Apple credential to the Claritas API. It moves through this path:

```text
Claritas web or iOS app → Claritas API → Keycloak → Microsoft / Apple
Microsoft / Apple → Keycloak broker callback → Claritas API → Claritas session
```

This keeps one application session model and one authorization database while
letting people use an account their organization already trusts.

## Values to register with the providers

These are the external-provider callback URLs. They must point to Keycloak,
not to `app.claritas.info` or the API callback.

| Provider | Production redirect / return URL | Value saved in Claritas |
| --- | --- | --- |
| Microsoft | `https://auth.claritas.info/realms/claritas/broker/microsoft/endpoint` | client ID, client secret, tenant ID |
| Apple | `https://auth.claritas.info/realms/claritas/broker/apple/endpoint` | Services ID, Team ID, Key ID, `.p8` private key |

The API uses a separate client callback after the broker returns:
`https://app.claritas.info/api/auth/microsoft/callback` and
`https://app.claritas.info/api/auth/apple/callback`. Those values are already
configured in `KEYCLOAK_API_REDIRECT_URIS`; do not add them to the Microsoft or
Apple application registrations.

## Microsoft Entra ID — outside the repository

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/)
   in the tenant that should own the application.
2. Go to **Entra ID → App registrations → New registration** and name it
   `Claritas production`.
3. For the production default, choose **Accounts in this organizational
   directory only**. Claritas requires the resulting Directory (tenant) ID and
   rejects an omitted tenant instead of silently falling back to Microsoft's
   multi-tenant `common` endpoint.
4. Under **Redirect URI**, choose **Web** and enter:

   ```text
   https://auth.claritas.info/realms/claritas/broker/microsoft/endpoint
   ```

5. Create the registration and copy its **Application (client) ID** and
   **Directory (tenant) ID** from Overview.
6. Under **Certificates & secrets**, create a client secret. Copy its
   **Value** immediately; Microsoft displays it only once. Set an expiry
   reminder before the chosen lifetime ends.
7. Under **API permissions**, add the Microsoft Graph delegated permission
   **User.Read** (not an application permission). Keycloak's Microsoft broker
   requests this permission and reads the signed-in profile from
   `https://graph.microsoft.com/v1.0/me`. Grant tenant admin consent when your
   organization requires it. Do not add broader Graph permissions for login.
8. If your tenant requires user assignment, assign the test users or groups
   before testing.

Multi-tenant Microsoft login is an explicit exception, not a fallback. If the
product requirement genuinely includes accounts outside the owning tenant,
choose the matching audience in Entra, set `KC_IDP_MICROSOFT_TENANT` to
`common`, `organizations`, or `consumers`, and change
`AUTH_MICROSOFT_MULTI_TENANT_ENABLED` to `"true"` in
`infra/k8s/config/claritas-config.yaml`. Bootstrap rejects those aliases while
the flag is false. In multi-tenant mode Claritas deliberately disables
automatic application-account linking by email: Microsoft Graph `mail` and UPN
values are profile attributes, not cross-tenant identity proofs. A Microsoft
identity that is not already linked therefore receives a separate Claritas
account; self-service account merging is not currently supported.

Microsoft requires the redirect URI to exactly match the registration, and
recommends keeping the list short and HTTPS-only. See Microsoft’s
[app-registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
[redirect-URI guidance](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url),
and [credential guidance](https://learn.microsoft.com/en-us/entra/msidweb/authentication/client-secrets).

## Apple — outside the repository

1. Use an Apple Developer account with the **Account Holder** or **Admin**
   role and an active Apple Developer Program membership.
2. In **Certificates, Identifiers & Profiles → Identifiers**, enable
   **Sign in with Apple** on the primary App ID that will be associated with
   Claritas. This can be the existing iOS App ID.
3. Create a **Services ID**, for example `info.claritas.web`. This exact ID is
   the Apple client ID used by Keycloak.
4. Open the Services ID, enable **Sign in with Apple**, and associate it with
   the primary App ID from step 2.
5. In the web configuration, register:

   ```text
   Domain:     auth.claritas.info
   Return URL: https://auth.claritas.info/realms/claritas/broker/apple/endpoint
   ```

6. Under **Keys**, create a new key with **Sign in with Apple** enabled and
   download its `.p8` file. Record its Key ID. The file is downloadable once;
   store it in your approved secret manager.
7. Record your Apple Developer **Team ID** from the membership page.
8. Configure [**Sign in with Apple for Email Communication / Private Email
   Relay**](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/)
   in the Apple Developer portal. Register and verify the real outbound
   email address or domain used by Claritas (`SMTP_FROM`) and satisfy Apple's
   SPF requirements. This is required for users who choose **Hide My Email** to
   receive Claritas verification and briefing messages. If the SMTP envelope
   sender uses a different domain, register that approved sending source too.

Apple requires a Services ID that is associated with a Sign in with
Apple-enabled primary App ID, and it requires an absolute HTTPS return URL.
See Apple’s [web configuration guide](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
and [environment documentation](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple).

## Claritas repository and deployment setup

The repository already has the provider integration. Do not commit any of the
following values to Git. Add these GitHub Actions secrets instead:

| GitHub Actions secret | Value |
| --- | --- |
| `KC_IDP_MICROSOFT_CLIENT_ID` | Microsoft Application (client) ID |
| `KC_IDP_MICROSOFT_CLIENT_SECRET` | Microsoft client-secret **value** |
| `KC_IDP_MICROSOFT_TENANT` | Required Directory (tenant) ID UUID; a multi-tenant alias is accepted only with the explicit repository flag described above |
| `KC_IDP_APPLE_CLIENT_ID` | Apple Services ID, for example `info.claritas.web` |
| `KC_IDP_APPLE_TEAM_ID` | Apple Developer Team ID |
| `KC_IDP_APPLE_KEY_ID` | Apple Sign in with Apple key ID |
| `KC_IDP_APPLE_PRIVATE_KEY` | Complete `.p8` file contents, including the `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines |

From a shell authenticated with GitHub CLI, the non-secret identifiers can be
entered directly and the two sensitive values can be read without echoing
them. Replace the example identifiers first:

```bash
gh secret set KC_IDP_MICROSOFT_CLIENT_ID --repo eojgroup/claritas --body '<application-client-id>'
gh secret set KC_IDP_MICROSOFT_TENANT --repo eojgroup/claritas --body '<directory-tenant-id>'
gh secret set KC_IDP_MICROSOFT_CLIENT_SECRET --repo eojgroup/claritas

gh secret set KC_IDP_APPLE_CLIENT_ID --repo eojgroup/claritas --body '<services-id>'
gh secret set KC_IDP_APPLE_TEAM_ID --repo eojgroup/claritas --body '<team-id>'
gh secret set KC_IDP_APPLE_KEY_ID --repo eojgroup/claritas --body '<key-id>'
gh secret set KC_IDP_APPLE_PRIVATE_KEY --repo eojgroup/claritas < AuthKey_<key-id>.p8
```

The commands without `--body` prompt on standard input, so those secrets do
not enter shell history. The Apple `.p8` file should be removed from the local
working directory after it is stored in the organization's approved secret
manager and GitHub.

On deployment, both repository workflows merge non-empty GitHub values into the
`claritas-auth` Kubernetes Secret. They do not replace its complete data map:
an omitted GitHub value preserves the corresponding live key. Terraform creates
the Secret for a new environment but ignores subsequent `data` drift, and its
post-apply step performs the same merge as the GKE release. The Keycloak
bootstrap job then creates or updates the `microsoft` and `apple` identity
providers. The aliases must remain exactly `microsoft` and `apple` because the
API uses them as Keycloak identity-provider hints.

`AUTH_PROVIDERS` is also supplied to the bootstrap job. Every advertised broker
must have a complete credential set and must persist as an enabled instance
with its expected provider factory and required configuration; otherwise the
release stops before a new API pod can advertise it. Credentials for an
unadvertised provider may be staged, while a completely absent unadvertised
provider is left unchanged.

Terraform manages the Google Secret Manager containers, but it deliberately no
longer manages their payload versions. On the first apply after this change,
versions tracked by an older Terraform revision are removed from Terraform
state with `destroy = false`, so their live versions remain enabled. If Secret
Manager is used as a secondary store, operators must add, rotate, disable, and
destroy its payload versions explicitly; the release path reads credentials
from GitHub and merges only supplied values into the Kubernetes Secret.

Removing a GitHub secret is therefore not credential revocation. To retire a
provider, first remove it from `AUTH_PROVIDERS`, disable or delete its Keycloak
identity provider, revoke the credential at Apple or Microsoft, and explicitly
remove its `KC_IDP_*` keys from the Kubernetes Secret. Restart/bootstrap only
after those coordinated changes; do not rely on an empty workflow input to
delete production credentials.

Apple is not a built-in Keycloak social provider. Claritas therefore builds a
dedicated identity image from Keycloak 26.7.3 and the Apple provider extension
1.17.0. Both Keycloak's multi-platform image digest and the extension's SHA-512
checksum are pinned in the repository. The release additionally resolves the
pushed per-commit image in Artifact Registry and applies that exact digest,
rather than deploying a mutable tag. The extension accepts the raw `.p8`
key and creates Apple's required ES256 client-secret JWT at token-exchange
time, so there is no static six-month JWT to rotate. The bootstrap fails
closed if the reviewed Keycloak version, Apple provider factory, complete
credentials, or persisted enabled provider cannot be verified.

The bootstrap also installs an OIDC **User Session Note** mapper on the
`claritas-api` client. It maps Keycloak's `identity_provider` session note to an
ID-token claim of the same name. The API requires that claim to exactly match
the provider stored in its one-time authorization state; `kc_idp_hint` alone is
only a routing hint and is never accepted as identity proof. Realm
self-registration and password-reset entry points are disabled, all Claritas
clients have Direct Access Grants disabled, and an authorization completed as
a local Keycloak password user has no broker claim and is rejected by the API.

The involved repository files are:

- [`infra/k8s/config/claritas-config.yaml`](../../infra/k8s/config/claritas-config.yaml): issuer, permitted redirect paths, and provider hints.
- [`infra/k8s/keycloak-bootstrap-job.yaml`](../../infra/k8s/keycloak-bootstrap-job.yaml): injects the provider secrets into the bootstrap job.
- [`infra/k8s/keycloak-bootstrap-configmap.yaml`](../../infra/k8s/keycloak-bootstrap-configmap.yaml): configures the two Keycloak providers.
- [`infra/keycloak/Dockerfile`](../../infra/keycloak/Dockerfile): builds the pinned Keycloak/Apple-provider image and verifies the downloaded JAR checksum.
- [`infra/k8s/keycloak-deployment.yaml`](../../infra/k8s/keycloak-deployment.yaml): runs the reviewed custom identity image.
- [`infra/k8s/frontendconfig.yaml`](../../infra/k8s/frontendconfig.yaml): permanently redirects the public HTTP forwarding rule to HTTPS at the GKE load balancer.
- [`infra/k8s/config/claritas-auth-secret.yaml`](../../infra/k8s/config/claritas-auth-secret.yaml): placeholder-only schema for a manual Kubernetes setup; never replace placeholders in source control.

After both providers’ secrets are available, change the same config file from:

```yaml
AUTH_PROVIDERS: "google"
```

to:

```yaml
AUTH_PROVIDERS: "google,microsoft,apple"
```

This prevents the login page from advertising a broker that has not yet been
configured. Deploy this configuration change together with the new secrets.

Commit the `AUTH_PROVIDERS` change to `main` after adding the secrets. The GKE
release builds and checksum-verifies the custom Keycloak image, updates the
Kubernetes Secret, rolls out Keycloak, and runs the fail-closed bootstrap job.
Do not enable the provider list in a separate earlier release: it would expose
a login button before its broker is ready. The iOS URL scheme remains
`claritas`, and its only permitted auth destination is the exact callback
`claritas://auth/callback`.

### Redirect, state, and native handoff security

`AUTH_ALLOWED_REDIRECTS` contains parsed destinations, not string prefixes.
HTTP and HTTPS destinations are accepted only when their origin exactly matches
an entry. A custom URL must independently match an explicitly listed scheme,
host, and path; listing a scheme alone does not authorize every URL using it.
Keep the production native entry exactly `claritas://auth/callback`.

Each login start creates an independent, random browser binding. Only its
SHA-256 hash is stored with `auth_state`; the raw value exists in a short-lived,
HttpOnly, SameSite=Lax cookie that is Secure in production. The callback
atomically consumes state only when the provider, state value, unexpired row,
and browser binding all match. Keycloak returns through a top-level GET, so the
Lax cookie is available. A cross-site form POST without that cookie fails
closed and cannot consume a valid browser's state.

Native clients must use an RFC 7636 S256 proof and exchange a one-time handoff:

1. Generate a 43–128 character `code_verifier`, retain it only in memory, and
   derive `base64url(SHA-256(ASCII(code_verifier)))`.
2. Start login with `redirect=claritas://auth/callback`,
   `native_code_challenge=<derived value>`, and
   `native_code_challenge_method=S256`.
3. The exact custom callback receives only `code=<random handoff code>`. It
   never receives a Claritas bearer token or expiry in the URL.
4. Immediately send `POST /api/auth/handoff` with JSON
   `{ "code": "...", "code_verifier": "..." }`. A successful, one-time
   exchange returns `{ "token": "...", "expires_at": "..." }`; store the
   bearer in the platform credential store. Handoff codes expire after 60
   seconds by default (configurable from 30–300 seconds with
   `AUTH_NATIVE_HANDOFF_TTL_SECONDS`).

Web login never receives a bearer in a redirect or response body. It continues
to use the HttpOnly Claritas session cookie only.

### HTTPS edge behavior

The GKE `FrontendConfig` returns an HTTP 308 redirect before plaintext requests
reach the web, API, or Keycloak backends. The Ingress annotation
`kubernetes.io/ingress.allow-http: "true"` must remain present: GKE needs that
HTTP forwarding rule in order to issue the redirect. It does not mean the
backends serve public application content over HTTP after the FrontendConfig is
reconciled.

HTTPS responses carry `Strict-Transport-Security: max-age=31536000`: nginx adds
it for the web application and the GKE BackendConfigs add it for API and
Keycloak responses. The policy intentionally omits `includeSubDomains` and
`preload`; do not enable either until every affected Claritas subdomain has an
independently verified permanent HTTPS deployment. After an edge change, test
both hosts explicitly rather than assuming the application-host check covers
the identity host.

### Manual Keycloak fallback

Use this only if the bootstrap job is unavailable. In Keycloak Admin Console,
open the `claritas` realm. Disable **User registration** and **Forgot password**
for this broker-only realm. Add the built-in **Microsoft** provider and the
extension-provided **Apple** provider; Apple does not exist in an unmodified
Keycloak image. Use aliases `microsoft` and `apple`, enable each provider, set
**Trust email** to on, **Store tokens** to off, **First login flow** to `first
broker login`, and **Sync mode** to `Force`. For Apple, put the raw `.p8`
contents in **Client secret**, then enter Team ID and Key ID. Keycloak publishes
the external callback URI from the alias, so a renamed alias changes the
redirect URI and breaks the setup.

On the `claritas-api` client's **Client scopes → Dedicated scope → Mappers**,
create a **User Session Note** mapper named `claritas-identity-provider`. Use
`identity_provider` for both the session-note name and token claim name, String
as the claim type, and include it in the ID token only. Keep Direct Access
Grants disabled. Without this mapper the API intentionally rejects broker
callbacks because it cannot prove which upstream provider authenticated them.

## Test and verify

1. Confirm the deployed API advertises the provider:

   ```bash
   curl -fsS https://app.claritas.info/api/auth/providers
   ```

   It should report the provider with `enabled: true` and its matching
   `start_path`.
2. In a private browser window, open the Claritas login page and choose
   Microsoft. Complete sign-in with a permitted account, then repeat for Apple.
3. Verify the browser returns to `https://app.claritas.info/` and that
   `GET /api/auth/me` succeeds with the Claritas session cookie.
4. Run the Apple model contract tests, then test Microsoft and Apple from both
   an iPhone and an iPad build:

   ```bash
   swift test --package-path apps/mobile/ios
   ```

   Each native flow must return only to the exact
   `claritas://auth/callback?code=...` endpoint, exchange that code with the
   in-memory PKCE verifier through `POST /api/auth/handoff`, and load the signed-in
   profile. A callback containing `token=...`, a different scheme/host/path, a
   duplicate code, an expired code, a replayed code, or a mismatched verifier
   must fail closed. Never print the callback code, verifier, or returned bearer
   while verifying the flow.
5. In Keycloak Admin Console, confirm each identity provider is enabled and
   inspect Events for any broker error. In **Server info**, confirm version
   `26.7.3` and the Apple social-provider factory are present.
6. Test a returning user as well as a first-time user. With Apple, verify the
   first login retains the account email; Apple only supplies the user name on
   the initial authorization, so do not rely on it being resent later.
7. Use an Apple test account that selects **Hide My Email**, then send both a
   verification message and a briefing to its `privaterelay.appleid.com`
   address. Receiving ordinary mail at a non-relay address does not prove the
   Apple relay setup.
8. Verify edge enforcement and HSTS for both public hosts:

   ```bash
   curl -sSI http://app.claritas.info/ | grep -Ei 'HTTP/|location:'
   curl -sSI http://auth.claritas.info/realms/claritas | grep -Ei 'HTTP/|location:'
   curl -sSI https://app.claritas.info/ | grep -i strict-transport-security
   curl -sSI https://auth.claritas.info/realms/claritas | grep -i strict-transport-security
   ```

   Both HTTP requests must return `308` with an `https://` location, and both
   HTTPS requests must return the one-year HSTS header.

If Microsoft reports `AADSTS50011`, compare the registered URI character for
character with the Microsoft callback URL above. If Apple rejects the request,
check that the Services ID, Team ID, Key ID, and full `.p8` contents came from
the same Apple Developer team, and that `auth.claritas.info` (not only
`app.claritas.info`) is registered as the domain.

## Operational checklist

- Separate development and production app registrations and callbacks.
- Rotate the Microsoft client secret before expiry and the Apple signing key
  under your normal key-rotation process. The Apple provider generates its
  short-lived client-secret JWT automatically from that key.
- Review Keycloak release/security notes regularly. Updating Keycloak or the
  Apple extension requires updating the paired versions, image tag, digest and
  checksum and then testing both first-time and returning login. Confirm a
  recent Cloud SQL backup/PITR point first; Keycloak schema upgrades are
  forward-only and the release workflow deliberately never rolls the identity
  server back to an older binary after migration.
- Treat every Keycloak binary change as a scheduled authentication maintenance
  window. The production manifest deliberately runs one replica with
  `maxSurge: 0`; the sole identity pod stops before the upgraded pod becomes
  ready. Existing Claritas application sessions continue, but new sign-ins are
  unavailable during that interval. Notify users, confirm Cloud SQL PITR/backup
  readiness immediately beforehand, monitor the rollout and bootstrap job, and
  recover by fixing forward. Do not start the old Keycloak binary against a
  schema upgraded by the new release.
- Keep GitHub secrets and the Kubernetes Secret as delivery mechanisms only;
  retain the source credentials in your approved secret manager.
- Review Keycloak broker events and application sign-in failures after release.
- Remove a provider from `AUTH_PROVIDERS` only when intentionally disabling it;
  otherwise the login page will continue to advertise it.
