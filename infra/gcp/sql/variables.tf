variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "europe-west2"
}

variable "network" {
  type        = string
  description = "VPC self_link (or name if default)"
  default     = "default"
}

variable "db_instance_name" {
  type    = string
  default = "claritas-sql"
}

variable "db_name" {
  type    = string
  default = "claritas"
}

variable "db_user" {
  type    = string
  default = "claritas_app"
}

variable "db_tier" {
  type    = string
  default = "db-f1-micro"
}

variable "availability_type" {
  type    = string
  default = "ZONAL" # Use "REGIONAL" for HA
}