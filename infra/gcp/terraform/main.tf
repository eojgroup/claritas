############################################
# APIs
############################################
resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    # keep others here only if you actually use them:
    # "firebase.googleapis.com",
    # "firestore.googleapis.com",
    # "pubsub.googleapis.com",
    # "aiplatform.googleapis.com",
  ])
  project             = var.project_id
  service             = each.value
  disable_on_destroy  = true
}

############################################
# Terraform state bucket
############################################
resource "google_storage_bucket" "terraform_state" {
  name                        = "claritas-tf-state"
  project                     = var.project_id
  location                    = var.region
  force_destroy               = true
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true

  versioning { enabled = true }

  labels = {
    environment = "dev"
    purpose     = "terraform-state"
  }
}

############################################
# Artifact Registry (Docker)
############################################
resource "google_artifact_registry_repository" "claritas_app" {
  project       = var.project_id
  repository_id = "claritas-app"
  location      = var.region
  format        = "DOCKER"

  labels = {
    environment = "dev"
    purpose     = "docker-images"
  }
}

############################################
# GKE Cluster (imported / managed)
############################################
resource "google_container_cluster" "primary" {
  name     = "claritas-cluster"
  project  = var.project_id
  location = var.region

  initial_node_count = 1

  node_config {
    machine_type    = "e2-small"
    preemptible     = true
    # This is the node SA (already in your project). Keep as-is.
    service_account = "terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"
  }

  lifecycle {
    prevent_destroy = true
  }
}

############################################
# Workload Identity for Cloud SQL Proxy
############################################
# 1) GCP service account used by workloads via WI
resource "google_service_account" "claritas_sql_gsa" {
  project      = var.project_id
  account_id   = "claritas-sql-gsa"
  display_name = "GSA for Cloud SQL access via Workload Identity"
}

# 2) Allow that GSA to connect to Cloud SQL
resource "google_project_iam_member" "gsa_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.claritas_sql_gsa.email}"
}

# 3) Permit KSA(s) to impersonate this GSA via WI
#    Add more entries if you have more namespaces/KSAs later.
locals {
  wi_bindings = [
    "serviceAccount:${var.project_id}.svc.id.goog[claritas/api-sa]",
    "serviceAccount:${var.project_id}.svc.id.goog[claritas/flyway-sa]",
  ]
}

resource "google_service_account_iam_binding" "gsa_wi_users" {
  service_account_id = google_service_account.claritas_sql_gsa.name
  role               = "roles/iam.workloadIdentityUser"
  members            = local.wi_bindings
}

############################################
# Cloud SQL (Postgres) - Private IP
############################################
# default VPC
data "google_compute_network" "vpc" {
  project = var.project_id
  name    = "default"
}

# PSA range
resource "google_compute_global_address" "sql_psa_range" {
  name          = "claritas-sql-psa-range"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.vpc.self_link
}

# Service Networking connection (peering)
resource "google_service_networking_connection" "vpc_connection" {
  network                 = data.google_compute_network.vpc.self_link
  service                 = "services/servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_psa_range.name]
}

# DB user password
resource "random_password" "db_password" {
  length  = 32
  special = false
}

# Instance
resource "google_sql_database_instance" "pg" {
  name                = "claritas-sql"
  project             = var.project_id
  region              = var.region
  database_version    = "POSTGRES_15"
  deletion_protection = true

  depends_on = [google_service_networking_connection.vpc_connection]

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

# Database
resource "google_sql_database" "db" {
  name     = "claritas"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
}

# App user
resource "google_sql_user" "app" {
  name     = "claritas_app"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  password = random_password.db_password.result
}

############################################
# Outputs
############################################
output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}

output "artifact_registry_repo_name" {
  value = google_artifact_registry_repository.claritas_app.name
}

output "instance_connection_name" {
  value = google_sql_database_instance.pg.connection_name
}

output "private_ip_address" {
  value = google_sql_database_instance.pg.private_ip_address
}

output "db_name" {
  value = google_sql_database.db.name
}

output "db_user" {
  value = google_sql_user.app.name
}

output "db_pass" {
  value     = random_password.db_password.result
  sensitive = true
}

output "claritas_sql_gsa_email" {
  value = google_service_account.claritas_sql_gsa.email
}

resource "google_container_cluster" "primary" {
  name     = "claritas-cluster"
  project  = var.project_id
  location = var.region

  initial_node_count = 1

  node_config {
    machine_type    = "e2-small"
    preemptible     = true
    service_account = "terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  # ✅ enable Workload Identity on the cluster
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  lifecycle { prevent_destroy = true }

  # Ensure the Container API is enabled before creating/updating the cluster
  depends_on = [
    google_project_service.enabled_services["container.googleapis.com"]
  ]
}

# Artifact Registry
resource "google_artifact_registry_repository" "claritas_app" {
  # ...existing...
  depends_on = [
    google_project_service.enabled_services["artifactregistry.googleapis.com"]
  ]
}

# PSA connection
resource "google_service_networking_connection" "vpc_connection" {
  # ...existing...
  depends_on = [
    google_project_service.enabled_services["servicenetworking.googleapis.com"]
  ]
}

# Cloud SQL instance
resource "google_sql_database_instance" "pg" {
  # ...existing...
  depends_on = [
    google_service_networking_connection.vpc_connection,
    google_project_service.enabled_services["sqladmin.googleapis.com"]
  ]
}

# State bucket just to be safe (not strictly necessary)
resource "google_storage_bucket" "terraform_state" {
  # ...existing...
  depends_on = [
    google_project_service.enabled_services["storage.googleapis.com"]
  ]
}