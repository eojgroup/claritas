# DNS Configuration for Claritas Ingress

This document describes the DNS records required for the Claritas GKE Ingress.

## Domains

- Root: `claritas.info`
- Web/API host: `app.claritas.info`
- Auth host (Keycloak): `auth.claritas.info`

## Required DNS Records

Both hosts must resolve to the same external IP of the `claritas` Ingress.

| Record Type | Hostname | Value (Target) | Purpose |
|-------------|----------|----------------|---------|
| `A` | `app` | `<INGRESS_IP>` | Serves web app + API traffic |
| `A` | `auth` | `<INGRESS_IP>` | Serves Keycloak auth traffic |

Use the current Ingress IP:

```bash
kubectl -n claritas get ingress claritas -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

## TLS Certificates

Claritas uses two Google ManagedCertificates:

- `claritas-app-cert` for `app.claritas.info`
- `claritas-auth-cert` for `auth.claritas.info`

The split avoids an auth-domain DNS issue blocking TLS on the web domain.

Check certificate status:

```bash
kubectl -n claritas describe managedcertificate claritas-app-cert
kubectl -n claritas describe managedcertificate claritas-auth-cert
```

## Common Failure Mode

If `https://app.claritas.info` does not load but `http://app.claritas.info` does, check:

1. `app.claritas.info` and `auth.claritas.info` both resolve to the Ingress IP.
2. `claritas-app-cert` status is `Active`.
3. `claritas-auth-cert` is not required for app page load, but it must be `Active` for auth flows.
