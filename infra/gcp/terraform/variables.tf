variable "project_id" {
  type = string
}

variable "region" {
  description = "The region to deploy resources"
  type        = string
  default     = "europe-west1"  # Default to US if not specified
}

variable "zone" {
  description = "The zone to deploy resources"
  type        = string
  default     = "europe-west1"  # Default to a specific zone in US
}