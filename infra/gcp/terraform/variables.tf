variable "project_id" {
  type = string
}

variable "region" {
  description = "The region to deploy resources"
  type        = string
  default     = "europe-west2" # Ensure the default region is Europe-West2
}

variable "zone" {
  description = "The zone to deploy resources"
  type        = string
  default     = "europe-west2-b" # Adjust to a specific zone in West Europe (e.g., europe-west2-b)
}

variable "cloud_sql_tier" {
  description = "Dedicated-core Cloud SQL machine tier used by the production PostgreSQL instance."
  type        = string
  default     = "db-custom-2-7680"

  validation {
    condition     = can(regex("^db-custom-[1-9][0-9]*-[1-9][0-9]*$", var.cloud_sql_tier))
    error_message = "cloud_sql_tier must be a dedicated-core custom tier such as db-custom-2-7680."
  }
}

variable "cloud_sql_connection_alert_threshold" {
  description = "Backend connection count that triggers the Cloud SQL connection-pressure alert."
  type        = number
  default     = 250

  validation {
    condition     = var.cloud_sql_connection_alert_threshold >= 10
    error_message = "cloud_sql_connection_alert_threshold must be at least 10."
  }
}

variable "api_egress_node_locations" {
  description = "Zones used by the private API node pool. One node is created in each zone for availability."
  type        = list(string)
  default     = ["europe-west2-b", "europe-west2-c"]

  validation {
    condition     = length(var.api_egress_node_locations) >= 2
    error_message = "api_egress_node_locations must contain at least two zones."
  }
}

variable "auth_google_client_id" {
  description = "OAuth client ID for Google"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_google_client_secret" {
  description = "OAuth client secret for Google"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_microsoft_client_id" {
  description = "OAuth client ID for Microsoft"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_microsoft_client_secret" {
  description = "OAuth client secret for Microsoft"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_microsoft_tenant_id" {
  description = "OAuth tenant ID for Microsoft (common for multi-tenant)"
  type        = string
  default     = "common"
}

variable "auth_apple_client_id" {
  description = "Apple Services ID (client ID)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_apple_team_id" {
  description = "Apple Team ID"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_apple_key_id" {
  description = "Apple Key ID"
  type        = string
  default     = ""
  sensitive   = true
}

variable "auth_apple_private_key" {
  description = "Apple private key (p8 PEM)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "terraform_runner_service_account" {
  description = "Service account email used by Terraform (for IAM grants). Leave empty to use terraform-github-oidc@<project_id>."
  type        = string
  default     = ""
}

variable "cloud_sql_export_members" {
  description = "IAM members allowed to inspect and export Cloud SQL data using the least-privilege Claritas exporter role."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([
      for member in var.cloud_sql_export_members :
      can(regex("^(user|group|serviceAccount):[^[:space:]]+$", member))
    ])
    error_message = "Each Cloud SQL export member must use user:, group:, or serviceAccount: IAM member syntax."
  }
}

variable "k8s_namespace" {
  description = "Kubernetes namespace where Claritas workloads run."
  type        = string
  default     = "claritas"
}

variable "auth_keycloak_client_secret" {
  description = "Client secret for the API's Keycloak confidential client."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ingest_api_token" {
  description = "Shared token used by internal ingestion jobs when calling ingest endpoints."
  type        = string
  default     = ""
  sensitive   = true
}

variable "keycloak_admin" {
  description = "Keycloak initial admin username."
  type        = string
  default     = "admin"
}

variable "keycloak_admin_password" {
  description = "Keycloak initial admin password."
  type        = string
  default     = ""
  sensitive   = true
}

############################################
# Provider-neutral SMTP delivery
############################################

variable "smtp_host" {
  description = "SMTP relay hostname. Leave empty to keep personalised briefing email delivery disabled."
  type        = string
  default     = ""
}

variable "smtp_port" {
  description = "SMTP relay port, normally 587 for STARTTLS or 465 for implicit TLS."
  type        = number
  default     = 587

  validation {
    condition     = var.smtp_port > 0 && var.smtp_port < 65536
    error_message = "smtp_port must be between 1 and 65535."
  }
}

variable "smtp_secure" {
  description = "Use implicit TLS for the SMTP connection. Use false for STARTTLS on port 587."
  type        = bool
  default     = false
}

variable "smtp_from" {
  description = "Verified sender address configured with the SMTP provider."
  type        = string
  default     = ""
}

variable "smtp_from_name" {
  description = "Display name for briefing email."
  type        = string
  default     = "Claritas"
}

variable "smtp_reply_to" {
  description = "Optional monitored reply-to mailbox."
  type        = string
  default     = ""
}

variable "smtp_username" {
  description = "SMTP provider username."
  type        = string
  default     = ""
  sensitive   = true
}

variable "smtp_password" {
  description = "SMTP provider password or API token."
  type        = string
  default     = ""
  sensitive   = true
}

variable "email_public_base_url" {
  description = "Public Claritas URL linked from briefing emails."
  type        = string
  default     = "https://app.claritas.info"
}

variable "personal_briefing_email_enabled" {
  description = "Enable personalised briefing email delivery after an SMTP provider has been configured and verified."
  type        = bool
  default     = false
}
