terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.39"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.39"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Ensure required Google APIs are enabled
resource "google_project_service" "required" {
  for_each           = toset([
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# If you’re on the default VPC you can pass "default" as name; otherwise use the self_link.

data "google_compute_network" "vpc" {
  name = var.network
}

# Reserve an internal range for Private Service Access (required for Private IP Cloud SQL)
resource "google_compute_global_address" "private_ip_alloc" {
  name          = "claritas-sql-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.vpc.self_link
}

# Establish VPC peering for Service Networking (Cloud SQL Private IP)
resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = data.google_compute_network.vpc.self_link
  service                 = "services/servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]

  depends_on = [
    google_project_service.required["servicenetworking.googleapis.com"],
  ]
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "pg" {
  name             = var.db_instance_name
  database_version = "POSTGRES_15"
  region           = var.region

  depends_on = [
    google_service_networking_connection.private_vpc_connection,
    google_project_service.required["sqladmin.googleapis.com"],
  ]

  settings {
    tier = var.db_tier
    availability_type = var.availability_type  # "ZONAL" or "REGIONAL"

    ip_configuration {
      ipv4_enabled    = false         # prefer Private IP from GKE
      private_network = data.google_compute_network.vpc.self_link
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    insights_config {
      query_plans_per_minute = 5
      query_string_length    = 1024
      record_application_tags = true
      record_client_address   = true
    }
  }

  deletion_protection = true
}

resource "google_sql_database" "db" {
  name     = var.db_name
  instance = google_sql_database_instance.pg.name
}

# App user (simple for MVP). We’ll store creds in a K8s Secret.
resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.pg.name
  password = random_password.db_password.result
}

# Optional: grant Cloud SQL Client to a GKE Workload Identity principal.
# Enable via -var=enable_runtime_iam=true once WI is configured.
resource "google_project_iam_member" "artifact_reader" {
  count   = var.enable_runtime_iam ? 1 : 0
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${var.project_id}.svc.id.goog[claritas/default]" # adjust when enabling WI
}