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
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
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
  auth_secrets = {
    "claritas-auth-google-client-id"        = var.auth_google_client_id
    "claritas-auth-google-client-secret"    = var.auth_google_client_secret
    "claritas-auth-microsoft-client-id"     = var.auth_microsoft_client_id
    "claritas-auth-microsoft-client-secret" = var.auth_microsoft_client_secret
    "claritas-auth-microsoft-tenant-id"     = var.auth_microsoft_tenant_id
    "claritas-auth-apple-client-id"         = var.auth_apple_client_id
    "claritas-auth-apple-team-id"           = var.auth_apple_team_id
    "claritas-auth-apple-key-id"            = var.auth_apple_key_id
    "claritas-auth-apple-private-key"       = var.auth_apple_private_key
    "claritas-auth-keycloak-client-secret"  = var.auth_keycloak_client_secret
    "claritas-ingest-api-token"             = var.ingest_api_token
    "claritas-keycloak-admin-password"      = var.keycloak_admin_password
  }

  auth_secret_names = toset(keys(local.auth_secrets))
  auth_secret_version_names = toset(nonsensitive([
    for name, value in local.auth_secrets : name
    if try(trimspace(value), "") != ""
  ]))

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

resource "google_project_iam_member" "terraform_runner_monitoring_alerts" {
  project = var.project_id
  role    = "roles/monitoring.alertPolicyEditor"
  member  = "serviceAccount:${local.terraform_runner_sa}"

  depends_on = [
    google_project_service.enabled_services["monitoring.googleapis.com"]
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
  for_each    = local.auth_secret_version_names
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
    # Do not attempt to reconcile imported clusters; avoid replacements.
    ignore_changes = all
  }

  # minimal shape that matches your live cluster well enough
  initial_node_count = 1

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  node_config {
    machine_type    = "e2-small"
    preemptible     = true
    service_account = "terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
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

############################################
# Cloud SQL export access
############################################
# Starting August 1, 2026, Cloud SQL Viewer no longer includes
# cloudsql.instances.export. Keep export access additive and opt-in instead of
# granting the substantially broader roles/cloudsql.editor role.
resource "google_project_iam_custom_role" "cloud_sql_exporter" {
  count = length(var.cloud_sql_export_members) > 0 ? 1 : 0

  project     = var.project_id
  role_id     = "claritasCloudSqlExporter"
  title       = "Claritas Cloud SQL Exporter"
  description = "Allows explicitly approved operators to export Cloud SQL data."
  permissions = [
    "cloudsql.instances.export",
    "cloudsql.instances.get",
  ]
  stage = "GA"

  depends_on = [
    google_project_service.enabled_services["iam.googleapis.com"],
    google_project_service.enabled_services["sqladmin.googleapis.com"]
  ]
}

resource "google_project_iam_member" "cloud_sql_exporter" {
  for_each = var.cloud_sql_export_members

  project = var.project_id
  role    = google_project_iam_custom_role.cloud_sql_exporter[0].name
  member  = each.value
}

locals {
  wi_bindings = [
    "serviceAccount:${var.project_id}.svc.id.goog[claritas/api-sa]",
    "serviceAccount:${var.project_id}.svc.id.goog[claritas/flyway-sa]",
    "serviceAccount:${var.project_id}.svc.id.goog[claritas/keycloak-sa]",
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

resource "random_password" "keycloak_db_password" {
  length  = 32
  special = false
}

resource "random_password" "keycloak_admin_password" {
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
    tier              = var.cloud_sql_tier
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

resource "google_sql_database" "keycloak_db" {
  name     = "keycloak"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_user" "app" {
  name     = "claritas_app"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  password = random_password.db_password.result
}

resource "google_sql_user" "keycloak" {
  name     = "keycloak_app"
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  password = random_password.keycloak_db_password.result
}
