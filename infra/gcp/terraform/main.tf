resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "aiplatform.googleapis.com"
  ])
  service            = each.value
  disable_on_destroy = true
}

resource "google_storage_bucket" "terraform_state" {
  name                        = "claritas-tf-state"
  location                    = var.region
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

resource "google_container_cluster" "primary" {
  name     = "claritas-cluster"
  location = "us-central1-a"

  initial_node_count = 1

  node_config {
    machine_type = "e2-small"  # Cheapest option (adjust based on your needs)
    preemptible  = true         # Preemptible nodes save costs
    service_account = "terraform-github-oidc@claritas-457808.iam.gserviceaccount.com"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}