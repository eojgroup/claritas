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

variable "finnhub_api_key" {
  description = "Finnhub API key for market quote ingestion."
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
# Postal mail delivery
############################################

variable "postal_enabled" {
  description = "Provision the dedicated Postal mail server, DNS zone, and GKE SMTP configuration."
  type        = bool
  default     = false
}

variable "postal_domain" {
  description = "Delegated sending subdomain managed by Cloud DNS. Do not use the existing root mail domain."
  type        = string
  default     = "briefings.claritas.info"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.postal_domain))
    error_message = "postal_domain must be a lowercase fully-qualified domain without a trailing dot."
  }
}

variable "postal_machine_type" {
  description = "Compute Engine machine type for Postal. The default meets Postal's 2 vCPU / 4 GB minimum."
  type        = string
  default     = "e2-standard-2"
}

variable "postal_boot_disk_size_gb" {
  description = "Postal VM boot disk size in GB."
  type        = number
  default     = 20
}

variable "postal_data_disk_size_gb" {
  description = "Persistent disk size in GB for MariaDB and Caddy data."
  type        = number
  default     = 50
}

variable "postal_image_version" {
  description = "Pinned Postal container version."
  type        = string
  default     = "3.3.6"
}

variable "postal_mariadb_image_version" {
  description = "Pinned MariaDB LTS container version."
  type        = string
  default     = "11.4.12"
}

variable "postal_caddy_image_version" {
  description = "Pinned Caddy container version used for Postal HTTPS."
  type        = string
  default     = "2.11.4"
}

variable "postal_web_allowed_cidrs" {
  description = "CIDRs allowed to reach the Postal HTTPS administration UI. Port 80 remains public for ACME."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "postal_internal_smtp_cidrs" {
  description = "VPC ranges allowed to submit authenticated mail to Postal on TCP 2525."
  type        = list(string)
  default = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
  ]
}

variable "postal_enable_public_ptr" {
  description = "Set the VM external IP PTR to smtp.<postal_domain>. Enable only after Google has verified domain ownership."
  type        = bool
  default     = false
}

variable "postal_deletion_protection" {
  description = "Prevent accidental deletion of the Postal VM. Disable deliberately before destroying it."
  type        = bool
  default     = true
}

variable "postal_smtp_username" {
  description = "SMTP LOGIN username used by Claritas. Postal accepts any username for LOGIN credentials."
  type        = string
  default     = "claritas"
}

variable "postal_smtp_credential" {
  description = "Optional fixed SMTP credential. Leave blank to let Terraform generate and store one."
  type        = string
  default     = ""
  sensitive   = true
}

variable "postal_email_delivery_enabled" {
  description = "Enable the personalised briefing email worker after Postal's DNS, PTR, health, and port-25 gates pass."
  type        = bool
  default     = false
}

variable "postal_admin_email" {
  description = "Email address for the Terraform-bootstrapped Postal administrator."
  type        = string
  default     = "admin@claritas.info"

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.postal_admin_email))
    error_message = "postal_admin_email must be a valid email address."
  }
}

variable "postal_admin_first_name" {
  description = "First name for the Terraform-bootstrapped Postal administrator."
  type        = string
  default     = "Claritas"
}

variable "postal_admin_last_name" {
  description = "Last name for the Terraform-bootstrapped Postal administrator."
  type        = string
  default     = "Administrator"
}

variable "postal_sender_address" {
  description = "From address for personalised briefings. Its domain must be owned by the Postal organization/server."
  type        = string
  default     = "daily@briefings.claritas.info"
}

variable "postal_sender_name" {
  description = "Display name used for personalised briefing email."
  type        = string
  default     = "Claritas"
}

variable "postal_reply_to" {
  description = "Optional reply-to address for personalised briefings."
  type        = string
  default     = ""
}

variable "postal_email_public_base_url" {
  description = "Public Claritas URL linked from briefing emails."
  type        = string
  default     = "https://app.claritas.info"
}

variable "postal_dmarc_policy" {
  description = "DMARC policy for the delegated sending domain. Start with none, then tighten after monitoring."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.postal_dmarc_policy)
    error_message = "postal_dmarc_policy must be one of none, quarantine, or reject."
  }
}
