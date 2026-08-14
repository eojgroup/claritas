# Claritas 🌍

Claritas is a unified data platform that brings clarity to global complexity by aggregating, enriching, and visualizing international datasets. This monorepo contains the web app, mobile app, API, and GCP infrastructure.

---

## 🧱 Monorepo Structure

```text
claritas/
│
├── apps/
│   ├── web/                # React + Vite web app
│   ├── mobile/             # Native iPhone, iPadOS + watchOS apps (SwiftUI)
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

Architecture and product design references:

- [UI architecture and cross-device design](docs/architecture/cross-device-design.md): analytics-first hierarchy, data-domain roles, design tokens, page archetypes, and adaptive rules for web, iPhone, iPad, and Apple Watch.
- [Business capabilities](docs/architecture/capabilities.md): platform capability map.
- [Personalised briefing email](docs/personalised-briefing-email.md): preference matching, durable generation/delivery queues, Mailpit development setup, and production SMTP requirements.

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
  - ingestion endpoints require `admin` role OR shared `x-ingest-token` for approved internal jobs

### 3) Data and Ingestion

- Primary operational data store: Cloud SQL for PostgreSQL.
- Schema supports source tracking, ingestion runs, cursors, normalized items, weather snapshots, and auth tables.
- Reviewed providers are ingested by the elected in-process automation worker or explicit admin runs inside cluster boundaries.
- Ingestion is designed to be repeatable and safe (dedupe hash + upsert patterns), and now uses an internal shared token path for machine-to-machine calls.

### 4) GCP Infrastructure

- GKE for API and web workloads.
- Cloud SQL (PostgreSQL) with private IP connectivity.
- Artifact Registry for container images.
- Ingress + managed certificate for external HTTPS traffic.
- Workload Identity for pod-to-GCP access without static long-lived keys.
- Terraform as infrastructure-as-code.
- GitHub Actions with OIDC for CI/CD.
- Provider-neutral SMTP configuration for optional personalised briefing email delivery.

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
Clone the workspace, then install and run each application from its own package:
```bash
git clone https://github.com/your-org/claritas.git
cd claritas
(cd apps/api && npm ci && npm run dev)
# In a second terminal:
(cd apps/web && npm ci && npm run dev)
```

The API requires the database environment variables documented in
`apps/api/src/db.ts`. Native-app setup is documented in
[`apps/mobile/ios/README.md`](apps/mobile/ios/README.md).

### 3. Provider API Keys and Open Data

- API runtime environment variable names:
  - `OPENWEATHER_API_KEY`
  - `PODCASTINDEX_API_KEY`
  - `PODCASTINDEX_API_SECRET`
  - `AISSTREAM_API_KEY`
- Podcast discovery and intelligence:
  - Create a free developer account at `https://api.podcastindex.org` and generate an API key
    and secret. Keep both server-side.
  - Optionally configure discovery targets with `PODCAST_DISCOVERY_TERMS` (comma-separated)
    or `PODCAST_FEED_IDS` (comma-separated PodcastIndex feed IDs). When neither is set,
    the scheduler uses the built-in terms `geopolitics,security,technology,markets`.
  - Optional limits: `PODCAST_MAX_FEEDS` and `PODCAST_MAX_EPISODES_PER_FEED`.
  - Optional LLM extraction toggle: `PODCAST_INTELLIGENCE_EXTRACTION_ENABLED`. Metadata
    entity/topic signals remain available when LLM extraction is off.
  - Optional identification: `PODCASTINDEX_USER_AGENT`, for example
    `Claritas/1.0 (+https://app.claritas.info; engineering@claritas.info)`.
  - Podcast automation is disabled by default. Enable it in the admin ingestion panel only
    after credentials and discovery targets are configured.
  - The core Podcast Index is described by its operator as free for any use. Podcast metadata,
    artwork, audio, and transcripts remain third-party content; commercial deployments must
    follow the Podcast Index terms and the applicable publisher content rights.
- Country leadership uses the public Wikidata Query Service and requires no API key.
  - Optional: set `WIKIDATA_USER_AGENT` to identify your production deployment with a
    product URL and monitored contact address.
  - Example: `Claritas/1.0 (https://claritas.info; engineering@claritas.info)`
  - Structured Wikidata content is consumed under CC0.
- Open intelligence providers:
  - GDELT DOC/Event/GKG is keyless. Optional tuning: `GDELT_DOC_QUERY`,
    `GDELT_MAX_RAW_ROWS`, and an identifying `GDELT_USER_AGENT`. Scheduled
    ingestion polls every 15 minutes with at most 25 DOC headlines per run; if
    DOC is rate limited it records degraded coverage and uses a relevance-filtered
    25-link maximum from the official rolling GDELT Article List RSS feed.
    Event and GKG parsing is capped at 190 rows each per scheduled run so the
    15-minute cadence retains approximately the previous hourly raw-row budget.
  - GOV.UK Search is keyless and adds OGL-licensed primary-source `news_story`,
    `press_release` and `world_news_story` records. Optional bounded tuning:
    `GOVUK_NEWS_LOOKBACK_HOURS` (default 48) and `GOVUK_NEWS_MAX_RECORDS`
    (default 100, maximum 250).
  - Official institutional RSS is keyless. Claritas ingests European Commission,
    Federal Reserve, SEC, BLS employment/CPI/PPI/JOLTS, and ECB press/statistical
    releases while preserving the publishing institution, feed, attribution,
    licence URL and topics in every item. See
    [data-source governance](docs/data-source-governance.md) for the reviewed
    commercial-use decisions and exclusions.
  - SEC EDGAR submissions and company facts are keyless. Set
    `SEC_EDGAR_USER_AGENT` to an application name plus monitored contact email,
    and optionally set `SEC_EDGAR_SYMBOLS` (comma-separated equities). For the
    GitHub deployment workflows, create a repository **Actions variable** named
    `SEC_EDGAR_USER_AGENT`; an Actions secret with the same exact name is also
    accepted, although the value is identification rather than a credential. The
    exact spelling is `EDGAR`, not `EDGARE`.
  - ECB Data API FX and policy-rate series and OECD share-price indices are
    keyless. Source and series identifiers remain
    attached to market records and API responses.
  - Market benchmarks and commodities use a normalized `market_instrument`
    catalogue plus durable `market_indicator` observations. Every national
    benchmark has a primary ISO2 relationship; annual macro indicators use an
    economic-indicator ISO2 relationship; global commodities retain a separate
    source-jurisdiction relationship that is never treated as country performance.
  - World Bank World Development Indicators are keyless and add country-level
    GDP growth, inflation, unemployment and current-account context. The WDI
    dataset is listed in the World Bank Data Catalog under CC BY 4.0, with
    provider and dataset attribution stored on every observation.
  - FRED requires the free `FRED_API_KEY`, available from
    `https://fredaccount.stlouisfed.org/apikeys`. Claritas uses a strict allowlist:
    EIA WTI, Brent and Henry Hub spot prices plus BLS/Federal Reserve U.S. macro
    series. Third-party series such as proprietary indices and LBMA metals are
    intentionally excluded. The original public-institution publisher and the
    required FRED notice and API terms link are stored and shown alongside FRED
    provenance on web and iOS. Scheduled market ingestion includes FRED only
    when `FRED_API_KEY` is configured; keyless deployments continue with the
    remaining providers instead of failing the run.
  - Frankfurter is not added because it republishes the ECB reference rates
    already ingested directly. IMF data is not enabled: the IMF's current terms
    ask potential commercial reusers to request permission, which does not meet
    the repository's unconditional free-commercial-source policy.
  - OpenWeather Current Weather, 5 day / 3 hour Forecast and Air Pollution APIs
    supply global conditions, forecasts and air quality. Create
    `OPENWEATHER_API_KEY` at `https://home.openweathermap.org/users/sign_up`;
    no separate One Call subscription is required. Claritas targets the free
    plan allowance by default. The Free plan permits commercial derivative use
    under OpenWeather's open licence, including visible attribution and
    ShareAlike requirements; confirm that those terms fit the product's
    distribution model before launch.
  - NOAA/NWS alerts are keyless and cover the United States. Configure an
    identifying `NWS_USER_AGENT` as a GitHub Actions variable (or same-named
    secret), for example `Claritas engineering@claritas.info`.
  - Attribution is stored with provider records and returned by the relevant API
    responses; keep it visible in redistributed data and user-facing exports.
- Multilingual news and briefings:
  - Ingestion preserves the original publisher title, summary and language code.
    GDELT remains the aggregation provider while the publisher domain (for
    example `reuters.com`) is displayed separately when GDELT returns it.
  - Timestamp provenance is explicit. GDELT DOC uses a 15-minute provider
    first-seen batch time; the bounded GAL fallback cannot distinguish publisher
    time from provider discovery; official RSS uses publisher publication time;
    GOV.UK uses its public timestamp. Invalid GDELT timestamps are skipped rather
    than replaced with the current time.
  - Non-English headlines are translated automatically into the configured
    interface language after ingestion. A short summary is generated only when
    a user expands a story and only from the already-ingested headline/excerpt.
    Original source fields remain unchanged; AI text and provider/model
    provenance are stored separately. Claritas does not retrieve or translate
    full article bodies. See [lightweight news translation](docs/news-translation.md).
  - Daily and personalised briefings prefer valid cached translations while
    preserving original publisher evidence. Their prompts can still translate
    uncached evidence, and deterministic fallbacks identify any untranslated
    non-English title instead of silently transforming it.
- Transport intelligence combines AISstream maritime data with keyless adsb.lol
  flight positions and plausible routes. See
  [transport intelligence](docs/transport-intelligence.md) for sampling,
  country linkage, platform detail levels, and provider operating notes.
  - Create the AISstream credential as the GitHub repository secret
    `AISSTREAM_API_KEY`; the deployment writes it to Kubernetes secret
    `claritas-aisstream` under the same key.
  - adsb.lol requires no API key. Its published data is ODbL 1.0.
- Event-driven intelligence and Earth Observation:
  - `EVENT_CORRELATION_ENABLED`, `EARTH_OBSERVATION_ENABLED`,
    `COPERNICUS_ENABLED`, `NASA_FIRMS_ENABLED`, `NASA_GIBS_ENABLED`,
    `USGS_EARTHQUAKES_ENABLED`, `EVENT_ALERTS_ENABLED` and
    `EO_VISION_ENRICHMENT_ENABLED` are repository variables. The committed
    deployment enables this complete event-to-observation path; each provider
    still fails closed as `not_configured` when its required credential is
    absent. Core ingestion and the Signal Desk remain available when optional
    evidence cannot be produced.
  - Copernicus requires Actions secrets `COPERNICUS_CLIENT_ID` and
    `COPERNICUS_CLIENT_SECRET`. NASA FIRMS requires `NASA_FIRMS_MAP_KEY`.
    NASA GIBS and USGS do not require secrets.
  - Vision uses `EO_VISION_MODEL=openrouter/free`, has no paid fallback, and is
    locally capped at ten requests per UTC day. Cost/config variables include
    `EO_MAX_DAILY_PROCESSING_UNITS`, `EO_MAX_MONTHLY_PROCESSING_UNITS`,
    `EO_ESTIMATED_PROCESSING_UNITS_PER_RENDER`,
    `EO_RENDER_MAX_WIDTH`, `EO_RENDER_MAX_HEIGHT`,
    `EO_MAX_AOI_SQUARE_DEGREES`, `EO_DEFAULT_CLOUD_THRESHOLD`,
    `EO_ASSET_RETENTION_DAYS`, `EO_EVENT_RELEVANCE_THRESHOLD`,
    `FIRMS_LOCATIONS_PER_POLL`, `NASA_FIRMS_POLL_SECONDS` and
    `USGS_POLL_SECONDS`. Conservative Kubernetes defaults are committed.
  - Exact registration, rollout and verification steps are in
    [Earth Observation administrator setup](docs/operations/earth-observation-admin-setup.md).
- Native event alerts:
  - `APNS_DELIVERY_ENABLED=true` enables the bounded delivery worker, but its
    readiness remains `not_configured` until `APNS_PRIVATE_KEY`, `APNS_KEY_ID`
    and `APNS_TEAM_ID` are present and valid. Current environment-scoped keys
    can additionally use `APNS_SANDBOX_PRIVATE_KEY` and `APNS_SANDBOX_KEY_ID`
    for Debug devices. APNs acceptance is recorded
    separately from user acknowledgement.
- Kubernetes deployment env wiring:
  - `infra/k8s/api-deployment.yaml`
- Recommended secret names/keys in cluster:
  - `claritas-openweather` / `OPENWEATHER_API_KEY`
  - `claritas-fred` / `FRED_API_KEY`
  - `claritas-podcastindex` / `PODCASTINDEX_API_KEY`, `PODCASTINDEX_API_SECRET`
  - `claritas-aisstream` / `AISSTREAM_API_KEY`
  - `claritas-earth-observation` / `COPERNICUS_CLIENT_ID`,
    `COPERNICUS_CLIENT_SECRET`, `NASA_FIRMS_MAP_KEY` (only configured keys are written)
  - `claritas-apns` / `APNS_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and
    optional paired `APNS_SANDBOX_PRIVATE_KEY`, `APNS_SANDBOX_KEY_ID`
- Production secret source (recommended):
  - GitHub repository secrets: `OPENWEATHER_API_KEY`, `FRED_API_KEY`,
    `PODCASTINDEX_API_KEY`, `PODCASTINDEX_API_SECRET`, `AISSTREAM_API_KEY`,
    `COPERNICUS_CLIENT_ID`, `COPERNICUS_CLIENT_SECRET`, `NASA_FIRMS_MAP_KEY`,
    `APNS_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
    `APNS_SANDBOX_PRIVATE_KEY`, `APNS_SANDBOX_KEY_ID`
  - GitHub repository variables: `PODCAST_DISCOVERY_TERMS`, `PODCAST_FEED_IDS`,
    `PODCAST_MAX_FEEDS`, `PODCAST_MAX_EPISODES_PER_FEED`,
    `PODCAST_INTELLIGENCE_EXTRACTION_ENABLED`, `PODCASTINDEX_USER_AGENT`,
    `SEC_EDGAR_USER_AGENT`, `NWS_USER_AGENT`, `EVENT_CORRELATION_ENABLED`,
    `EVENT_ALERTS_ENABLED`, `EARTH_OBSERVATION_ENABLED`,
    `COPERNICUS_ENABLED`, `NASA_FIRMS_ENABLED`, `NASA_GIBS_ENABLED`,
    `USGS_EARTHQUAKES_ENABLED`, `EO_VISION_ENRICHMENT_ENABLED`,
    `EO_VISION_MODEL`, the bounded `EO_*` budget variables, and
    `APNS_DELIVERY_ENABLED`
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
- **Cloud SQL Export IAM Transition**: [`docs/cloud-sql-export-iam.md`](./docs/cloud-sql-export-iam.md)
- **Data-source governance**: [`docs/data-source-governance.md`](./docs/data-source-governance.md)
- **Lightweight news translation**: [`docs/news-translation.md`](./docs/news-translation.md)
- **Cost-optimized production baseline**: [`docs/operations/cost-baseline.md`](./docs/operations/cost-baseline.md)
- **Event intelligence and Earth Observation**: [`docs/architecture/event-earth-observation.md`](./docs/architecture/event-earth-observation.md)
- **Earth Observation administrator setup**: [`docs/operations/earth-observation-admin-setup.md`](./docs/operations/earth-observation-admin-setup.md)

---

## 🛡️ License

MIT
