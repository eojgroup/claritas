variable "project_id" {
  type = string
}

variable "region" {
  description = "The region to deploy resources"
  type        = string
  default     = "europe-west1"  # Ensure the default region is Europe-West1
}

variable "zone" {
  description = "The zone to deploy resources"
  type        = string
  default     = "europe-west1-b"  # Adjust to a specific zone in West Europe (e.g., europe-west1-b)
}