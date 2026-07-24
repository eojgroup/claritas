# Claritas BIMI

Claritas hosts its BIMI-ready logo at:

`https://app.claritas.info/.well-known/bimi/claritas.svg`

The asset is a square SVG Tiny PS 1.2 file with a solid background, no scripts,
no animation, and no linked resources. It reuses the three-circle Claritas mark
and the production web colour palette.

## DNS records

The DNS zone for `claritas.info` is managed outside this repository. Publish
the following record after the web deployment makes the SVG URL publicly
available:

| Host/name | Type | Value |
| --- | --- | --- |
| `default._bimi` | `TXT` | `v=BIMI1; l=https://app.claritas.info/.well-known/bimi/claritas.svg;` |

Use the `default` selector so Brevo can attach its account-level BIMI selector
without a support request.

The DMARC record must have host/name `_dmarc` and this value only:

`v=DMARC1; p=quarantine; pct=100; rua=mailto:rua@dmarc.brevo.com`

Do not include `_dmarc.claritas.info`, `TXT`, or surrounding quotation marks in
the DNS value field.

## Certificate support

The published SVG and BIMI record are enough for mailbox providers that accept
self-asserted BIMI. Gmail requires a Verified Mark Certificate (VMC) or Common
Mark Certificate (CMC). Once a certificate authority supplies the PEM bundle:

1. Add the PEM file beneath `apps/web/public/.well-known/bimi/`.
2. Verify that it is publicly available over HTTPS without redirects.
3. Replace the BIMI TXT record with the exact value supplied by the certificate
   authority. It will include an `a=https://...pem` authority URL.

Certificate authorities validate logo ownership and may require a registered
trademark for a VMC. A CMC can support an eligible prior-use logo without a
registered trademark, subject to the issuer and mailbox provider requirements.

## Verification

After deployment and DNS propagation:

```sh
curl -fsSI https://app.claritas.info/.well-known/bimi/claritas.svg
dig +short TXT _dmarc.claritas.info
dig +short TXT default._bimi.claritas.info
```

The SVG response must be `200`, use HTTPS, and have an SVG content type. DMARC,
SPF, and DKIM must all align with the visible From domain. Logo display remains
at the receiving mailbox provider's discretion.
