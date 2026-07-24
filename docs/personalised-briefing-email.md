# Personalised briefing email

Claritas now creates a separate daily briefing for each user from saved:

- industries;
- followed company symbols;
- countries and regions;
- schedule, timezone, email opt-in, and maximum signal count.

The matching rule is:

1. a signal that mentions a followed company qualifies; or
2. a signal must satisfy every configured industry/geography dimension.

An empty set does not filter that dimension. With no interests selected, the briefing uses the
latest signals. Followed companies also contribute their latest available market snapshot.

Country and region preferences also select matching transport aggregates. Broad transport context
is included for transportation-sensitive industries and for an unfiltered briefing. It contributes
country relevance, a transport metric in the highest-relevance country profile, and a qualified
movement takeaway. AIS cargo/tanker departures are a vessel-movement proxy rather than measured
cargo tonnage; flight counts are bounded by Claritas polling areas and available ADS-B reception.

## Runtime design

The API scheduler inserts one idempotent job per user and local calendar date. API replicas claim
jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`, generate the briefing, persist its selected source
items, and create a durable delivery record. A second queue stage sends through SMTP and retries
failed deliveries up to three times.

Briefing generation uses the existing provider-neutral LLM adapter. If that adapter is unavailable,
the worker produces a deterministic extractive briefing so email delivery can continue.

Email uses the open-source [Nodemailer SMTP transport](https://nodemailer.com/smtp). The application
is not coupled to an email API: local development can use Mailpit, and production can use a
an authenticated SMTP provider or relay.

## Local MVP testing with Mailpit

[Mailpit](https://github.com/axllent/mailpit) captures messages; it does not deliver them to public
mailboxes. Run the pinned development version:

```bash
docker run --rm --name claritas-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.30.0
```

Configure the API:

```bash
export SMTP_HOST=127.0.0.1
export SMTP_PORT=1025
export SMTP_SECURE=false
export SMTP_FROM=briefings@claritas.local
export SMTP_FROM_NAME=Claritas
export EMAIL_PUBLIC_BASE_URL=http://localhost:5173
```

Open `http://localhost:8025`, enable email in Profile → Preferences, save interests, and select
**Send preview**.

For cluster-based development:

```bash
kubectl apply -f infra/k8s/dev/mailpit.yaml
kubectl -n claritas port-forward service/mailpit 8025:8025
```

Set `SMTP_HOST=mailpit` and `SMTP_PORT=1025` in `claritas-config`. The development manifest is
intentionally unauthenticated and must not be exposed through production ingress.

## Production SMTP configuration

Production uses the Terraform-managed `claritas-smtp` ConfigMap and Secret. The API manifest reads
all SMTP settings from those resources; do not patch them with `kubectl` because the next Terraform
apply will reconcile them.

Configure the provider through GitHub Actions repository variables and secrets:

| GitHub setting | Required | Example | Purpose |
| --- | --- | --- | --- |
| `SMTP_HOST` | Yes | `smtp.provider.example` | Authenticated SMTP provider hostname |
| `SMTP_PORT` | Yes | `587` | STARTTLS SMTP port |
| `SMTP_SECURE` | Yes | `false` | Use `false` for STARTTLS on 587; use `true` for implicit TLS on 465 |
| `SMTP_FROM` | Yes | `daily@example.com` | Provider-verified From mailbox |
| `SMTP_FROM_NAME` | No | `Claritas` | Display name |
| `SMTP_REPLY_TO` | No | `support@example.com` | Monitored reply mailbox |
| `SMTP_USERNAME` | Provider-dependent | provider username | GitHub Actions secret |
| `SMTP_PASSWORD` | Provider-dependent | provider password/token | GitHub Actions secret |
| `EMAIL_PUBLIC_BASE_URL` | Recommended | `https://app.claritas.info` | Preferences link in email |
| `PERSONAL_BRIEFING_EMAIL_ENABLED` | No | `true` | Enables the delivery worker only after provider verification |

The provider must verify the sending domain and supply its required SPF, DKIM, and DMARC records.
Use TLS SMTP submission on port 587 or 465; this avoids Google Cloud's external TCP/25 restriction.

## Production deliverability actions

Before sending to real users:

1. Create and verify the sender domain with the chosen SMTP provider.
2. Add the provider-issued SPF, DKIM, and DMARC DNS records.
3. Set the repository SMTP variables and secrets above, keeping `PERSONAL_BRIEFING_EMAIL_ENABLED=false`.
4. Run the Terraform deployment so it reconciles the API SMTP ConfigMap and Secret.
5. Send a profile preview to a verified account and confirm the delivery record becomes `sent`.
6. Enable `PERSONAL_BRIEFING_EMAIL_ENABLED=true` only after provider delivery and bounce handling are verified.

Email defaults to off for every account. The recipient must explicitly enable it, and Claritas
suppresses delivery if the authenticated account email is absent or unverified.

## Data model and endpoints

Migration `V16__personalised_briefing_email.sql` adds:

- interest arrays and email controls to `user_daily_briefing_schedule`;
- `personal_daily_briefing` plus source-item relevance records;
- `personal_daily_briefing_job` for generation retries;
- `briefing_email_delivery` for SMTP state, attempts, and message IDs.

User endpoints:

- `GET|PUT /api/briefings/daily/schedule`
- `GET /api/briefings/daily/preferences/options`
- `GET /api/briefings/daily/email/status`
- `GET /api/briefings/daily/personal/latest`
- `POST /api/briefings/daily/personal/preview`
- `GET /api/briefings/daily/personal/jobs/:id`

The schedule and delivery workers are safe to run in each API replica because database claims are
atomic and daily generation is unique on `(user_id, briefing_date)`.
