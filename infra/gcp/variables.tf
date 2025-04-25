variable "project_id" {
  type = string
}

variable "google_credentials" {
  type        = string
  description = "Raw JSON for Terraform service account"
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "zone" {
  type    = string
  default = "europe-west1-b"
}