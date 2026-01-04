############################################
# APIs
############################################
resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "pubsub.googleapis.com",        
    "secretmanager.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
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

  depends_on = [
    google_project_service.enabled_services["artifactregistry.googleapis.com"]
  ]
}

############################################
# Secret Manager (OAuth credentials)
############################################
locals {
  auth_secret_names = toset([
    "claritas-auth-google-client-id",
    "claritas-auth-google-client-secret",
    "claritas-auth-microsoft-client-id",
    "claritas-auth-microsoft-client-secret",
    "claritas-auth-microsoft-tenant-id",
    "claritas-auth-apple-client-id",
    "claritas-auth-apple-team-id",
    "claritas-auth-apple-key-id",
    "claritas-auth-apple-private-key",
  ])

  auth_secrets = {
    "claritas-auth-google-client-id"       = var.auth_google_client_id
    "claritas-auth-google-client-secret"   = var.auth_google_client_secret
    "claritas-auth-microsoft-client-id"    = var.auth_microsoft_client_id
    "claritas-auth-microsoft-client-secret" = var.auth_microsoft_client_secret
    "claritas-auth-microsoft-tenant-id"    = var.auth_microsoft_tenant_id
    "claritas-auth-apple-client-id"        = var.auth_apple_client_id
    "claritas-auth-apple-team-id"          = var.auth_apple_team_id
    "claritas-auth-apple-key-id"           = var.auth_apple_key_id
    "claritas-auth-apple-private-key"      = var.auth_apple_private_key
  }

  terraform_runner_sa = var.terraform_runner_service_account != "" ? var.terraform_runner_service_account : "terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "terraform_runner_secretmanager" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${local.terraform_runner_sa}"

  depends_on = [
    google_project_service.enabled_services["secretmanager.googleapis.com"]
  ]
}

resource "google_secret_manager_secret" "auth" {
  for_each  = local.auth_secret_names
  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [
    google_project_service.enabled_services["secretmanager.googleapis.com"],
    google_project_iam_member.terraform_runner_secretmanager
  ]
}

resource "google_secret_manager_secret_version" "auth" {
  for_each    = local.auth_secret_names
  secret      = google_secret_manager_secret.auth[each.value].id
  secret_data = local.auth_secrets[each.value]
}


############################################
# GKE Cluster
############################################
resource "google_container_cluster" "primary" {
  name     = "claritas-cluster"
  project  = var.project_id
  location = var.region

  # keep the cluster you're already running; do NOT let TF recreate it
  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      # ignore fields that tend to drift on imported clusters
      node_config[0].oauth_scopes,
      logging_config,
      monitoring_config,
      network,
      subnetwork,
      node_pool,                 # since default-pool is managed by GKE
      release_channel,
      enable_autopilot,
      private_cluster_config,
    ]
  }

  # minimal shape that matches your live cluster well enough
  initial_node_count = 1

  node_config {
    machine_type    = "e2-small"
    preemptible     = true
    service_account = "terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"
  }
}

############################################
# Workload Identity (GSA and bindings)
############################################
resource "google_service_account" "claritas_sql_gsa" {
  project      = var.project_id
  account_id   = "claritas-sql-gsa"
  display_name = "GSA for Cloud SQL access via Workload Identity"
}

resource "google_project_iam_member" "gsa_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.claritas_sql_gsa.email}"
}

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
data "google_compute_network" "vpc" {
  project = var.project_id
  name    = "default"
}

resource "google_compute_global_address" "sql_psa_range" {
  name          = "claritas-sql-psa-range"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.vpc.self_link
}

resource "google_service_networking_connection" "vpc_connection" {
  network                 = data.google_compute_network.vpc.self_link
  service                 = "services/servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_psa_range.name]

  depends_on = [
    google_project_service.enabled_services["servicenetworking.googleapis.com"]
  ]
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "pg" {
  name                = "claritas-sql"
  project             = var.project_id
  region              = var.region
  database_version    = "POSTGRES_15"
  deletion_protection = true

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

  depends_on = [
    google_service_networking_connection.vpc_connection,
    google_project_service.enabled_services["sqladmin.googleapis.com"]
  ]
}

resource "google_sql_database" "db" {
  name     = "claritas"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_user" "app" {
  name     = "claritas_app"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  password = random_password.db_password.result
}
