############################################
# Kubernetes secrets for API auth (optional)
############################################
locals {
  k8s_auth_plain = {
    AUTH_KEYCLOAK_CLIENT_SECRET = var.auth_keycloak_client_secret
    INGEST_API_TOKEN            = var.ingest_api_token
    KEYCLOAK_DB_PASSWORD        = random_password.keycloak_db_password.result
    KEYCLOAK_ADMIN              = var.keycloak_admin
    KEYCLOAK_ADMIN_PASSWORD     = var.keycloak_admin_password
    KC_IDP_GOOGLE_CLIENT_ID     = var.auth_google_client_id
    KC_IDP_GOOGLE_CLIENT_SECRET = var.auth_google_client_secret
    KC_IDP_MICROSOFT_CLIENT_ID  = var.auth_microsoft_client_id
    KC_IDP_MICROSOFT_CLIENT_SECRET = var.auth_microsoft_client_secret
    KC_IDP_MICROSOFT_TENANT     = var.auth_microsoft_tenant_id
    KC_IDP_APPLE_CLIENT_ID      = var.auth_apple_client_id
    KC_IDP_APPLE_TEAM_ID        = var.auth_apple_team_id
    KC_IDP_APPLE_KEY_ID         = var.auth_apple_key_id
    KC_IDP_APPLE_PRIVATE_KEY    = var.auth_apple_private_key
  }

  k8s_auth_data = {
    for key, value in local.k8s_auth_plain :
    key => value
    if try(trimspace(value), "") != ""
  }
}

resource "kubernetes_secret" "claritas_auth" {
  count = length(local.k8s_auth_data) == 0 ? 0 : 1
  metadata {
    name      = "claritas-auth"
    namespace = var.k8s_namespace
  }
  data = local.k8s_auth_data
  type = "Opaque"
  depends_on = [google_container_cluster.primary]
}
