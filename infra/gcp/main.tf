resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "aiplatform.googleapis.com"
  ])
  service = each.value
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

  lifecycle {
    prevent_destroy = true
  }

  labels = {
    environment = "dev"
    purpose     = "terraform-state"
  }
}