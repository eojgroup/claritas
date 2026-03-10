############################################
# Kubernetes secrets for API auth (optional)
############################################
locals {
  keycloak_admin_password_effective = try(trimspace(var.keycloak_admin_password), "") != "" ? var.keycloak_admin_password : random_password.keycloak_admin_password.result

  # Keep optional values plan-time deterministic by deriving them from input vars only.
  k8s_auth_optional_plain = {
    AUTH_KEYCLOAK_CLIENT_SECRET    = var.auth_keycloak_client_secret
    INGEST_API_TOKEN               = var.ingest_api_token
    FINNHUB_API_KEY                = var.finnhub_api_key
    KEYCLOAK_ADMIN                 = var.keycloak_admin
    KC_IDP_GOOGLE_CLIENT_ID        = var.auth_google_client_id
    KC_IDP_GOOGLE_CLIENT_SECRET    = var.auth_google_client_secret
    KC_IDP_MICROSOFT_CLIENT_ID     = var.auth_microsoft_client_id
    KC_IDP_MICROSOFT_CLIENT_SECRET = var.auth_microsoft_client_secret
    KC_IDP_MICROSOFT_TENANT        = var.auth_microsoft_tenant_id
    KC_IDP_APPLE_CLIENT_ID         = var.auth_apple_client_id
    KC_IDP_APPLE_TEAM_ID           = var.auth_apple_team_id
    KC_IDP_APPLE_KEY_ID            = var.auth_apple_key_id
    KC_IDP_APPLE_PRIVATE_KEY       = var.auth_apple_private_key
  }

  k8s_auth_optional_data = {
    for key, value in local.k8s_auth_optional_plain :
    key => value
    if try(trimspace(value), "") != ""
  }

  # Required generated value is merged in, but no longer controls count.
  k8s_auth_data = merge(
    local.k8s_auth_optional_data,
    {
      KEYCLOAK_DB_PASSWORD     = random_password.keycloak_db_password.result
      KEYCLOAK_ADMIN_PASSWORD  = local.keycloak_admin_password_effective
    }
  )
}

resource "kubernetes_secret" "claritas_auth" {
  # Deterministic count avoids plan-time unknown failures.
  count = 1
  metadata {
    name      = "claritas-auth"
    namespace = var.k8s_namespace
  }
  data = local.k8s_auth_data
  type = "Opaque"
  depends_on = [google_container_cluster.primary]
}
