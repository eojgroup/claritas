provider "google" {
  project     = var.project_id
  region      = var.region
  zone        = var.zone
}

provider "kubernetes" {
  host                   = google_container_cluster.primary.endpoint
  cluster_ca_certificate = base64decode(google_container_cluster.primary.cluster_ca_certificate)
  token                  = data.google_client_config.default.access_token
}

data "google_client_config" "default" {}

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