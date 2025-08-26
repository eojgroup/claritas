# Enable necessary APIs
resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",  # Ensure Artifact Registry API is enabled
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = true
}

# Storage bucket for Terraform state
resource "google_storage_bucket" "terraform_state" {
  name                        = "claritas-tf-state"
  location                    = var.region  # Ensure it's using the updated variable for region
  force_destroy               = true
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  labels = {
    environment = "dev"
    purpose     = "terraform-state"
  }
}

# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "claritas_app" {
  repository_id = "claritas-app"  # The name of the repository
  location      = var.region      # The region where the repository will be created
  format        = "DOCKER"        # The format of the repository, "DOCKER" in this case

  labels = {
    environment = "dev"
    purpose     = "docker-images"
  }
}

# GKE Cluster resource in europe-west2
resource "google_container_cluster" "primary" {
  name     = "claritas-cluster"
  location = "europe-west2"  # Correct region

  initial_node_count = 1

  node_config {
    machine_type    = "e2-small"
    preemptible     = true
    service_account = "terraform-github-oidc@claritas-457808.iam.gserviceaccount.com"
  }

  lifecycle {
    prevent_destroy = true  # Prevent destruction of the cluster
  }
}

# GitHub Actions Terraform SA needs to manage VPC peering & service networking
resource "google_project_iam_member" "tf_sa_network_admin" {
  project = var.project_id
  role    = "roles/compute.networkAdmin"
  member  = "serviceAccount:terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "tf_sa_servicenetworking_admin" {
  project = var.project_id
  role    = "roles/servicenetworking.admin"
  member  = "serviceAccount:terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"
}

# ---- Cloud SQL (Postgres) with Private IP ----

# Reference the default VPC
data "google_compute_network" "vpc" {
  project = var.project_id
  name    = "default"
}

# Reserve an internal IP range for Private Service Access (PSA)
resource "google_compute_global_address" "sql_psa_range" {
  name          = "claritas-sql-psa-range"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.vpc.self_link
}

# Establish the PSA connection between your VPC and Service Networking
resource "google_service_networking_connection" "vpc_connection" {
  network                 = data.google_compute_network.vpc.self_link
  service                 = "services/servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_psa_range.name]
}

# Strong password for the application DB user
resource "random_password" "db_password" {
  length  = 32
  special = false
}

# Cloud SQL instance (Postgres 15)
resource "google_sql_database_instance" "pg" {
  name             = "claritas-sql"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_15"
  deletion_protection = true

  depends_on = [
    google_service_networking_connection.vpc_connection
  ]

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_autoresize   = true
    activation_policy = "ALWAYS"
    edition           = "ENTERPRISE"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    insights_config {
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
      query_plans_per_minute  = 5
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = data.google_compute_network.vpc.self_link
      ssl_mode        = "ENCRYPTED_ONLY"
    }
  }
}

# Application database
resource "google_sql_database" "db" {
  name     = "claritas"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
}

# Application user
resource "google_sql_user" "app" {
  name     = "claritas_app"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  password = random_password.db_password.result
}

# ---- Outputs for Cloud SQL ----

# Outputs for cluster name and Artifact Registry repository name
output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}

output "artifact_registry_repo_name" {
  value = google_artifact_registry_repository.claritas_app.name
}