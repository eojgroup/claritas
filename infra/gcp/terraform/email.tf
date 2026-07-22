############################################
# Provider-neutral SMTP configuration for the API
############################################

locals {
  smtp_config_data = {
    SMTP_HOST                        = var.smtp_host
    SMTP_PORT                        = tostring(var.smtp_port)
    SMTP_SECURE                      = tostring(var.smtp_secure)
    SMTP_FROM                        = var.smtp_from
    SMTP_FROM_NAME                   = var.smtp_from_name
    SMTP_REPLY_TO                    = var.smtp_reply_to
    EMAIL_PUBLIC_BASE_URL            = var.email_public_base_url
    PERSONAL_BRIEFING_WORKER_ENABLED = tostring(var.personal_briefing_email_enabled)
  }

  smtp_secret_data = {
    SMTP_USER     = var.smtp_username
    SMTP_PASSWORD = var.smtp_password
  }
}

resource "kubernetes_config_map" "claritas_smtp" {
  metadata {
    name      = "claritas-smtp"
    namespace = var.k8s_namespace
  }

  data       = local.smtp_config_data
  depends_on = [google_container_cluster.primary]
}

resource "kubernetes_secret" "claritas_smtp" {
  metadata {
    name      = "claritas-smtp"
    namespace = var.k8s_namespace
  }

  data       = local.smtp_secret_data
  type       = "Opaque"
  depends_on = [google_container_cluster.primary]
}
