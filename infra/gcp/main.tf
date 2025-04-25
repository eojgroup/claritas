resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",        # GKE
    "firebase.googleapis.com",         # Firebase
    "firestore.googleapis.com",        # Firestore
    "pubsub.googleapis.com",           # Pub/Sub
    "aiplatform.googleapis.com"        # Vertex AI
  ])
  service = each.value
}

resource "google_storage_bucket" "terraform_state" {
  name     = "claritas-tf-state"
  location = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }
}