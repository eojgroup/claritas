provider "google" {
  project     = var.project_id
  region      = var.region  # Updated to use the region variable for consistency
  zone        = var.zone    # Use zone as required, will default to "us-central1-a"
}

provider "kubernetes" {
  host                   = google_container_cluster.primary.endpoint
  cluster_ca_certificate = base64decode(google_container_cluster.primary.cluster_ca_certificate)
  token                  = data.google_client_config.default.access_token
}

data "google_client_config" "default" {}