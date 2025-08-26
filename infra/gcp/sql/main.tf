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
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "pg" {
  name             = var.db_instance_name
  database_version = "POSTGRES_15"
  region           = var.region

  depends_on = [google_service_networking_connection.private_vpc_connection]

  settings {
    tier = var.db_tier
    availability_type = var.availability_type  # "ZONAL" or "REGIONAL"

    ip_configuration {
      ipv4_enabled    = false         # prefer Private IP from GKE
      private_network = data.google_compute_network.vpc.self_link
      require_ssl     = true
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

# Helpful IAM so your CI/cluster can see the instance
resource "google_project_iam_member" "artifact_reader" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${var.project_id}.svc.id.goog[claritas/default]" # adjust if you use another SA/namespace
}