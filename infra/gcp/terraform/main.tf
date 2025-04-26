# Enable necessary APIs
resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com"  # Ensure Artifact Registry API is enabled
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

# GKE Cluster resource in europe-west1
resource "google_container_cluster" "primary" {
  name     = "claritas-cluster"
  location = "europe-west1"  # Correct region

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

# Outputs for cluster name and Artifact Registry repository name
output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}

output "artifact_registry_repo_name" {
  value = google_artifact_registry_repository.claritas_app.name
}