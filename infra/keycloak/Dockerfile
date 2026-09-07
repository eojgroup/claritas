# syntax=docker/dockerfile:1.7

# The Apple broker is a community Keycloak extension listed in Keycloak's
# extension catalogue. Fetch the exact release artifact and verify it before it
# can enter the identity-server image.
FROM alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1 AS apple-provider

ARG APPLE_IDP_VERSION=1.17.0
ARG APPLE_IDP_SHA512=04949c18bd2819f6134f7a8fdf446e471036241c537d451e7bf1c627d8eefb1f72374d238bf0037155e725531c587065cfabf1c3f0b7f0df86fb7138effd6bba

RUN wget -q \
      -O /tmp/apple-identity-provider.jar \
      "https://github.com/klausbetz/apple-identity-provider-keycloak/releases/download/${APPLE_IDP_VERSION}/apple-identity-provider-${APPLE_IDP_VERSION}.jar" \
    && echo "${APPLE_IDP_SHA512}  /tmp/apple-identity-provider.jar" | sha512sum -c -

# Pin both the human-readable release and the multi-platform manifest digest.
# Update them together after reviewing Keycloak's release and migration notes.
FROM quay.io/keycloak/keycloak:26.7.3@sha256:ff4257d0d64efbe99ed1ddfaf07765cc3c36dc7518bf8324d41961327f441c54 AS builder

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true

COPY --from=apple-provider --chown=keycloak:keycloak \
  /tmp/apple-identity-provider.jar /opt/keycloak/providers/apple-identity-provider.jar

RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.7.3@sha256:ff4257d0d64efbe99ed1ddfaf07765cc3c36dc7518bf8324d41961327f441c54

COPY --from=builder /opt/keycloak/ /opt/keycloak/

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
