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

Set these `claritas-config` keys:

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `SMTP_HOST` | Yes | `postal.example.com` | SMTP relay hostname |
| `SMTP_PORT` | Yes | `587` | Submission port; use 587 or 465 on Google Cloud |
| `SMTP_SECURE` | Yes | `false` | `true` for implicit TLS on port 465; `false` for STARTTLS on 587 |
| `SMTP_FROM` | Yes | `briefings@example.com` | Envelope/from mailbox |
| `SMTP_FROM_NAME` | No | `Claritas` | Display name |
| `SMTP_REPLY_TO` | No | `support@example.com` | Reply mailbox |
| `EMAIL_PUBLIC_BASE_URL` | Recommended | `https://app.example.com` | Preferences link in email |
| `PERSONAL_BRIEFING_WORKER_ENABLED` | No | `true` | Disable only for maintenance |

Store credentials in the `claritas-smtp` secret:

```bash
kubectl -n claritas create secret generic claritas-smtp \
  --from-literal=SMTP_USER='replace-me' \
  --from-literal=SMTP_PASSWORD='replace-me' \
  --dry-run=client -o yaml | kubectl apply -f -
```

`SMTP_USER` and `SMTP_PASSWORD` can both be omitted for a trusted internal relay. If `SMTP_USER` is
set, the password is mandatory.

Google Cloud normally blocks external SMTP on port 25, while ports 587 and 465 are available for
submission. Use one of those TLS-capable ports for an external relay.

## Production deliverability actions

Before sending to real users:

1. Choose and operate an SMTP relay. Postal is the self-hosted open-source option, but a managed
   SMTP relay can be substituted without code changes.
2. Configure a sending subdomain and publish SPF, DKIM, and DMARC DNS records supplied by that
   relay.
3. Configure reverse DNS and a stable outbound IP if self-hosting internet delivery.
4. Add SMTP values/secrets above and deploy the API plus migration `V16`.
5. Send a profile preview to a verified account and confirm the delivery record becomes `sent`.
6. Monitor bounce/complaint handling before increasing volume. The MVP queue records SMTP failures,
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
