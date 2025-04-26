variable "project_id" {
  type = string
}

variable "region" {
  description = "The region to deploy resources"
  type        = string
  default     = "europe-west2"  # Ensure the default region is Europe-West2
}

variable "zone" {
  description = "The zone to deploy resources"
  type        = string
  default     = "europe-west2-b"  # Adjust to a specific zone in West Europe (e.g., europe-west2-b)
}