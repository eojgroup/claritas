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

## Runtime design

The API scheduler inserts one idempotent job per user and local calendar date. API replicas claim
jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`, generate the briefing, persist its selected source
items, and create a durable delivery record. A second queue stage sends through SMTP and retries
failed deliveries up to three times.

Briefing generation uses the existing provider-neutral LLM adapter. If that adapter is unavailable,
the worker produces a deterministic extractive briefing so email delivery can continue.

Email uses the open-source [Nodemailer SMTP transport](https://nodemailer.com/smtp). The application
is not coupled to an email API: local development can use Mailpit, and production can use a
self-hosted relay such as [Postal](https://docs.postalserver.io/) or any authenticated SMTP relay.

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

The default Postal values are:

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `SMTP_HOST` | Yes | Postal VM private IP | SMTP relay address inside the VPC |
| `SMTP_PORT` | Yes | `2525` | Private authenticated submission listener |
| `SMTP_SECURE` | Yes | `false` | Submission remains inside the VPC; Postal authentication is still required |
| `SMTP_FROM` | Yes | `daily@briefings.claritas.info` | Envelope/from mailbox |
| `SMTP_FROM_NAME` | No | `Claritas` | Display name |
| `SMTP_REPLY_TO` | No | `support@example.com` | Reply mailbox |
| `EMAIL_PUBLIC_BASE_URL` | Recommended | `https://app.example.com` | Preferences link in email |
| `PERSONAL_BRIEFING_WORKER_ENABLED` | No | `true` | Disable only for maintenance |

Terraform generates the Postal SMTP credential, stores it in Secret Manager and Terraform state,
bootstraps the same value in Postal, and writes it to the Kubernetes Secret. Set
`POSTAL_EMAIL_DELIVERY_ENABLED=true` only after the delivery gates pass. See the
[Postal architecture and runbook](architecture/postal-email-delivery.md).

The API-to-Postal hop is not the same as Postal-to-recipient delivery. The first uses private VPC
port 2525. Direct delivery to recipient MX servers still requires external destination port 25,
which Google Cloud commonly blocks and Terraform cannot unblock. Ports 587/465 work only when an
upstream relay is used.

## Production deliverability actions

Before sending to real users:

1. Enable the Terraform-managed Postal infrastructure and delegate its Cloud DNS subdomain.
2. Verify Google Cloud external TCP/25 egress, then enable the Terraform-managed PTR record.
3. Confirm forward/reverse DNS, SPF, DKIM, and DMARC alignment.
4. Enable the email worker through the repository variable and deploy the API plus migration `V16`.
5. Send a profile preview to a verified account and confirm the delivery record becomes `sent`.
6. Monitor bounce/complaint handling and IP reputation before increasing volume. The MVP queue records SMTP failures,
   but automated bounce ingestion is a follow-up capability.

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
