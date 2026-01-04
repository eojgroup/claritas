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
