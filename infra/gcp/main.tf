terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "enabled_services" {
  for_each = toset([
    "container.googleapis.com",        # GKE
    "firebase.googleapis.com",         # Firebase
    "firestore.googleapis.com",        # Firestore
    "pubsub.googleapis.com",           # Pub/Sub
    "aiplatform.googleapis.com"        # Vertex AI
  ])
  service = each.value

  disable_on_destroy = true
}

resource "google_storage_bucket" "terraform_state" {
  name     = "claritas-tf-state"
  location = var.region
  force_destroy = true

  storage_class = "STANDARD"
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