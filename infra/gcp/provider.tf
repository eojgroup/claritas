provider "google" {
  project     = var.project_id
  region      = var.region
  zone        = var.zone
}

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "claritas-tf-state"
    prefix = "terraform/state"
  }
}