############################################
# Kubernetes secrets for API auth + DB
############################################
locals {
  k8s_auth_plain = {
    AUTH_GOOGLE_CLIENT_ID       = var.auth_google_client_id
    AUTH_GOOGLE_CLIENT_SECRET   = var.auth_google_client_secret
    AUTH_MICROSOFT_CLIENT_ID    = var.auth_microsoft_client_id
    AUTH_MICROSOFT_CLIENT_SECRET = var.auth_microsoft_client_secret
    AUTH_MICROSOFT_TENANT_ID    = var.auth_microsoft_tenant_id
    AUTH_APPLE_CLIENT_ID        = var.auth_apple_client_id
    AUTH_APPLE_TEAM_ID          = var.auth_apple_team_id
    AUTH_APPLE_KEY_ID           = var.auth_apple_key_id
    AUTH_APPLE_PRIVATE_KEY      = var.auth_apple_private_key
  }

  k8s_auth_data = {
    for key, value in local.k8s_auth_plain :
    key => value
    if try(trimspace(value), "") != ""
  }
}

resource "kubernetes_secret" "claritas_auth" {
  metadata {
    name      = "claritas-auth"
    namespace = var.k8s_namespace
  }
  data = local.k8s_auth_data
  type = "Opaque"
  depends_on = [google_container_cluster.primary]
}

resource "kubernetes_secret" "claritas_db" {
  metadata {
    name      = "claritas-db"
    namespace = var.k8s_namespace
  }
  data = {
    DB_PASSWORD = random_password.db_password.result
  }
  type = "Opaque"
  depends_on = [google_container_cluster.primary]
}
