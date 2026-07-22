# Daily briefing email verification

Claritas deliberately suppresses a daily-briefing email until the signed-in
user has a valid, **verified** email address. SMTP readiness only confirms
that the application can submit email to the configured SMTP provider; it does
not prove that the user owns the recipient address.

## Symptom

The Preferences page shows an address followed by:

```text
not verified · SMTP ready
```

and **Send preview** reports that delivery was suppressed.

This is an identity-verification state, not a Brevo/SMTP failure. Users can
select **Send verification email** in Preferences and open the one-hour link
sent to their signed-in account address. This is the normal self-service path.
The message identifies the expected `app.claritas.info` destination and also
shows the complete first-party URL as a copy/paste fallback. If an email client
or browser warns about a rewritten tracking or safety redirect, the user can
copy that displayed Claritas URL into the browser without following the
intermediate redirect.

Brevo account-security messages, including notifications that ask an operator
to authorize a new SMTP source IP, are not Claritas user-verification messages.
Operators should verify the source IP and authorize it from **Brevo → Settings
→ Security → Authorized IPs** instead of relying on an emailed redirect.

## Administrator recovery path

1. Sign in to the Keycloak admin console at `https://auth.claritas.info/admin`.
2. Select the deployed Claritas realm. Confirm its name without guessing:

   ```bash
   kubectl -n claritas get configmap claritas-config \
     -o jsonpath='{.data.KEYCLOAK_REALM}{"\n"}'
   ```

3. Open **Users**, find the account by its email address, and open its
   **Details** page.
4. Set **Email verified** to **On** and click **Save**.
5. In Claritas, use **Sign out**, then sign in again through the same identity
   provider. This new OIDC login copies Keycloak's verified state into
   Claritas's `app_user.email_verified` value.

Do not directly update `app_user.email_verified` in PostgreSQL. Use this only
when the user cannot access the verification mailbox.

## Confirm before sending

After opening the verification link (or signing in again after administrator
recovery), run this in the browser console:

```js
fetch("/api/briefings/daily/email/status", { credentials: "include" })
  .then((response) => response.json())
  .then(console.log);
```

The response must include both of these values before a preview can be sent:

```json
{
  "email": {
    "configured": true,
    "recipient_verified": true
  }
}
```

Then select **Email this briefing to me**, save the schedule, and select
**Send preview**. A successful preview has `delivery_status: "sent"`.

## Microsoft-brokered sign-in

The Keycloak bootstrap config treats Microsoft as a trusted email provider and
uses forced profile synchronization. If the account returns to `not verified`
after a fresh Microsoft sign-in, inspect the Keycloak Microsoft identity
provider configuration and the Keycloak user's **Email verified** field; do
not weaken Claritas's verified-recipient guard.
