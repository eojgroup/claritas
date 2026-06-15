# Claritas 🌍

Claritas is a unified data platform that brings clarity to global complexity by aggregating, enriching, and visualizing international datasets. This monorepo contains the web app, mobile app, API, and GCP infrastructure.

---

## 🧱 Monorepo Structure

```text
claritas/
│
├── apps/
│   ├── web/                # React + Vite web app
│   ├── mobile/             # Native iOS + watchOS apps (SwiftUI)
│   └── api/                # Node.js/Express API + ingestion endpoints
│
├── infra/
│   ├── gcp/                # Terraform + SQL migrations
│   ├── k8s/                # Kubernetes manifests
│   └── scripts/            # Deployment helpers
│
├── docs/
│   ├── architecture/       # C1/C2 and infra diagrams
│   └── ADRs/               # Architecture decision records
│
├── .github/                # GitHub workflows (CI/CD)
├── .devcontainer/          # Devcontainer definition (Codespaces)
└── README.md               # You are here
```

---

## 🏗️ Enterprise Architecture (Target)

Claritas targets an enterprise architecture on Google Cloud Platform with a shared API layer for web + mobile, federated identity, and a controlled data-ingestion path. We also want an explicit open source strategy, with Keycloak as the primary self-hosted IAM option.

### 1) Identity and Access

- Federated authentication providers to support:
  - Google
  - Microsoft
  - Apple
- Preferred open source model:
  - Keycloak (self-hosted on GKE) as the identity control plane
  - Identity brokering from Keycloak to Google, Microsoft, and Apple
- API verifies JWTs server-side and enforces issuer/audience checks.
- App-level identity and authorization are persisted in Postgres:
  - `app_user` (user profile and active status)
  - `auth_identity` (provider subject links)
  - `auth_session` (session lifecycle + audit attributes)
  - `auth_role`, `auth_user_role` (RBAC)

### 2) Application and API Layer

- A single Node.js/Express API on GKE serves both clients:
  - React web app
  - iOS mobile app
- API responsibilities:
  - auth/session context
  - domain endpoints (news, weather, country stats)
  - ingestion endpoints for internal jobs
  - normalization and idempotent upsert of provider data
- API protection model:
  - domain/read endpoints require authenticated user context
  - ingestion endpoints require `admin` role OR shared `x-ingest-token` for internal CronJobs

### 3) Data and Ingestion

- Primary operational data store: Cloud SQL for PostgreSQL.
- Schema supports source tracking, ingestion runs, cursors, normalized items, weather snapshots, and auth tables.
- External providers (for example NewsAPI/OpenWeather) are ingested by scheduled/manual jobs running inside cluster boundaries.
- Ingestion is designed to be repeatable and safe (dedupe hash + upsert patterns), and now uses an internal shared token path for machine-to-machine calls.

### 4) GCP Infrastructure

- GKE for API and web workloads.
- Cloud SQL (PostgreSQL) with private IP connectivity.
- Artifact Registry for container images.
- Ingress + managed certificate for external HTTPS traffic.
- Workload Identity for pod-to-GCP access without static long-lived keys.
- Terraform as infrastructure-as-code.
- GitHub Actions with OIDC for CI/CD.

### 5) Enterprise Non-Functional Requirements

- Least-privilege IAM and clear trust boundaries.
- Private DB path and managed secret handling.
- Repeatable migrations and deployment automation.
- Observability and auditability across auth, API, and ingestion.
- Operational controls (rate limits, API protection, and progressive hardening).

---

## 🧭 Open Source Strategy

- Prefer open standards and open source runtime components where feasible:
  - OpenID Connect / OAuth 2.1 for identity
  - Keycloak for IAM
  - PostgreSQL for application and identity-linked data
  - Kubernetes + Terraform for runtime and infra lifecycle
- Keep AI-assisted product features provider-neutral:
  - Daily briefing generation uses a Claritas-owned LLM adapter boundary.
  - OpenCode is supported as the first runtime LLM backend for local/open-provider deployments.
  - The browser never calls the LLM backend directly.
- Keep an abstraction boundary in the API auth layer so identity provider choice remains swappable.
- Avoid provider lock-in by storing app authorization in Claritas-owned tables, not only in IdP-specific claims.

---

## 🛠️ Keycloak Implementation Plan

### Phase 1: Foundation

1. Deploy Keycloak to GKE with hardened runtime settings (multi-replica, probes, anti-affinity, PDB).
2. Back Keycloak with a dedicated PostgreSQL database/schema.
3. Configure ingress/TLS and private admin access path.
4. Use a dedicated `keycloak-sa` service account with Workload Identity for Cloud SQL access.

### Phase 2: Identity Configuration

1. Create realm(s): `claritas-dev`, `claritas-prod`.
2. Configure clients:
   - `claritas-web` (public PKCE client)
   - `claritas-mobile` (public PKCE client)
   - `claritas-api` (bearer-only/confidential resource server)
3. Add identity providers in Keycloak:
   - Google
   - Microsoft
   - Apple
4. Map external claims to stable internal claims (`sub`, `email`, roles/groups).
5. Automate baseline realm/client/IdP setup through a Kubernetes bootstrap job.

### Phase 3: Application Integration

1. Implement OIDC client auth flow against Keycloak for web and mobile.
2. Update API auth middleware to validate Keycloak JWTs via realm JWKS.
3. Keep app authorization in Postgres (`auth_role`, `auth_user_role`) and merge with token context.
4. Implement login/session rollout behind feature flags per client.
5. Use provider metadata endpoint (`/api/auth/providers`) to drive frontend provider UX.

### Phase 4: Security and Operations

1. Enforce short token TTL + refresh token rotation policies.
2. Add Keycloak audit/event forwarding into centralized logging.
3. Configure backup/restore and disaster recovery for Keycloak DB.
4. Add synthetic login checks and SLO alerting.
5. Rotate `INGEST_API_TOKEN` and Keycloak client secrets on a regular cadence.

### Phase 5: Cutover

1. Run canary rollout for web first, then mobile.
2. Monitor auth error rate, token validation failures, and login latency.
3. Remove legacy auth paths once Keycloak is stable in production.

---

## 🔐 Hardening Baseline (Implemented)

- Keycloak on GKE now runs as a hardened deployment (`infra/k8s/keycloak-deployment.yaml`):
  - 1 replica by default on the current small dev cluster (scale to 2+ for production)
  - startup/readiness/liveness probes
  - anti-affinity + pod disruption budget
  - dedicated service account (`keycloak-sa`) with Workload Identity
- Keycloak bootstrap is automated with a post-deploy job:
  - `infra/k8s/keycloak-bootstrap-configmap.yaml`
  - `infra/k8s/keycloak-bootstrap-job.yaml`
  - creates/updates realm + clients (`claritas-web`, `claritas-mobile`, `claritas-api`)
  - applies Google/Microsoft/Apple IdP configuration when credentials are provided
- API endpoint hardening:
  - `/api/news`, `/api/news/country-stats`, `/api/weather/country-latest`, `/api/proxy-image` require auth
  - ingestion endpoints require `admin` role OR `x-ingest-token`
- CI/CD hardening:
  - deploy workflow applies Keycloak SA/PDB/bootstrap manifests
  - runs a Keycloak bootstrap job during deployment
  - supports Keycloak + provider credentials + ingest token secret upsert

## 🎨 Frontend Auth UX

- Web login page includes provider-branded buttons/icons for Google, Microsoft, and Apple.
- iOS login flow includes matching provider-branded login buttons.
- Backend `/api/auth/providers` now returns provider metadata (`display_name`, `icon`, `start_path`) so UI can stay aligned with backend auth configuration.

---

## 🚀 Getting Started

### 1. Codespaces
Spin up an environment in-browser with GitHub Codespaces (preconfigured in `.devcontainer`).

### 2. Manual Dev Setup
Clone and use the workspace:
```bash
git clone https://github.com/your-org/claritas.git
cd claritas
npm install
npm run dev
```

### 3. Provider API Keys (News/Weather)

- API runtime environment variable names:
  - `NEWSAPI_API_KEY`
  - `THENEWSAPI_API_TOKEN`
  - `OPENWEATHER_API_KEY`
- TheNewsAPI integration notes:
  - Base API URL: `https://api.thenewsapi.com/v1`
  - `publishedAfter` (when provided in admin ingestion payload) must be `YYYY-MM-DD`
- Kubernetes deployment env wiring:
  - `infra/k8s/api-deployment.yaml`
- Recommended secret names/keys in cluster:
  - `claritas-newsapi` / `NEWSAPI_API_KEY`
  - `claritas-thenewsapi` / `THENEWSAPI_API_TOKEN`
  - `claritas-openweather` / `OPENWEATHER_API_KEY`
- Production secret source (recommended):
  - GitHub repository secret: `THENEWSAPI_API_TOKEN`
  - Used by deploy workflow: `.github/workflows/gke-deploy.yml` (`Ensure API provider secrets exist`)

### 4. Daily Briefing AI Backend

The daily briefing generator can use OpenCode as an internal LLM service:

- API env:
  - `BRIEFING_LLM_PROVIDER=opencode`
  - `OPENCODE_SERVER_URL`
  - `OPENCODE_MODEL` or `OPENCODE_PROVIDER_ID` + `OPENCODE_MODEL_ID`
  - `OPENCODE_SERVER_USERNAME`
  - `OPENCODE_SERVER_PASSWORD`
  - `OPENCODE_DISABLE_TOOLS=true` for text-only briefing generation
- Trigger endpoint:
  - `POST /api/ingest/briefings/daily/:date/generate`
  - `POST /api/admin/briefings/daily/:date/generate`
- Full setup guide:
  - [`docs/daily-briefing-opencode.md`](./docs/daily-briefing-opencode.md)

---

## 📚 Documentation

- **Architecture Diagrams**: [`docs/architecture`](./docs/architecture)
- **ADR Records**: [`docs/ADRs`](./docs/ADRs)
- **GCP Setup Guide**: [`infra/gcp`](./infra/gcp)

---

## 🛡️ License

MIT
