############################################
# Stable outbound egress for API and SMTP
############################################

resource "google_compute_address" "api_egress" {
  name         = "claritas-api-egress"
  project      = var.project_id
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"

  depends_on = [
    google_project_service.enabled_services["compute.googleapis.com"]
  ]
}

resource "google_compute_router" "api_egress" {
  name    = "claritas-api-egress-router"
  project = var.project_id
  region  = var.region
  network = data.google_compute_network.vpc.self_link

  depends_on = [
    google_project_service.enabled_services["compute.googleapis.com"]
  ]
}

resource "google_compute_router_nat" "api_egress" {
  name                               = "claritas-api-egress-nat"
  project                            = var.project_id
  region                             = var.region
  router                             = google_compute_router.api_egress.name
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.api_egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Public GKE nodes prefer their own external addresses over Cloud NAT. Keep the
# API (which owns every SMTP connection) on private nodes so all of its outbound
# traffic is translated through the single reserved address above.
resource "google_container_node_pool" "api_egress" {
  name           = "claritas-api-egress"
  project        = var.project_id
  location       = var.region
  cluster        = google_container_cluster.primary.name
  node_locations = var.api_egress_node_locations
  node_count     = 1

  network_config {
    enable_private_nodes = true
  }

  node_config {
    machine_type    = "e2-small"
    spot            = true
    service_account = "terraform-github-oidc@${var.project_id}.iam.gserviceaccount.com"

    labels = {
      claritas-egress = "static"
    }

    taint {
      key    = "dedicated"
      value  = "claritas-api"
      effect = "NO_SCHEDULE"
    }

    metadata = {
      disable-legacy-endpoints = "true"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  upgrade_settings {
    max_surge       = 1
    max_unavailable = 0
  }

  depends_on = [
    google_compute_router_nat.api_egress
  ]
}
