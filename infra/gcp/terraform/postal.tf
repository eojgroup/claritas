############################################
# Dedicated Postal mail delivery platform
############################################

locals {
  postal_web_hostname         = "postal.${var.postal_domain}"
  postal_smtp_hostname        = "smtp.${var.postal_domain}"
  postal_spf_hostname         = "spf.${var.postal_domain}"
  postal_return_path_hostname = "rp.${var.postal_domain}"
  postal_route_hostname       = "routes.${var.postal_domain}"
  postal_track_hostname       = "track.${var.postal_domain}"

  postal_default_dkim_value  = var.postal_enabled ? "v=DKIM1; t=s; h=sha256; p=${replace(replace(replace(tls_private_key.postal_signing[0].public_key_pem, "-----BEGIN PUBLIC KEY-----", ""), "-----END PUBLIC KEY-----", ""), "\n", "")};" : ""
  postal_default_dkim_rrdata = var.postal_enabled ? "\"${join("\" \"", regexall(".{1,200}", local.postal_default_dkim_value))}\"" : ""

  postal_sender_dkim_value  = var.postal_enabled ? "v=DKIM1; t=s; h=sha256; p=${replace(replace(replace(tls_private_key.postal_domain_dkim[0].public_key_pem, "-----BEGIN PUBLIC KEY-----", ""), "-----END PUBLIC KEY-----", ""), "\n", "")};" : ""
  postal_sender_dkim_rrdata = var.postal_enabled ? "\"${join("\" \"", regexall(".{1,200}", local.postal_sender_dkim_value))}\"" : ""

  postal_smtp_credential_effective = var.postal_enabled && trimspace(var.postal_smtp_credential) == "" ? random_password.postal_smtp_credential[0].result : var.postal_smtp_credential

  postal_startup_script = var.postal_enabled ? templatefile("${path.module}/templates/postal-startup.sh.tftpl", {
    project_id                = var.project_id
    postal_domain             = var.postal_domain
    web_hostname              = local.postal_web_hostname
    smtp_hostname             = local.postal_smtp_hostname
    spf_hostname              = local.postal_spf_hostname
    return_path_hostname      = local.postal_return_path_hostname
    route_hostname            = local.postal_route_hostname
    track_hostname            = local.postal_track_hostname
    postal_image_version      = var.postal_image_version
    mariadb_image_version     = var.postal_mariadb_image_version
    caddy_image_version       = var.postal_caddy_image_version
    mariadb_secret_id         = google_secret_manager_secret.postal_mariadb[0].secret_id
    rails_secret_id           = google_secret_manager_secret.postal_rails[0].secret_id
    signing_secret_id         = google_secret_manager_secret.postal_signing[0].secret_id
    domain_dkim_secret_id     = google_secret_manager_secret.postal_domain_dkim[0].secret_id
    admin_secret_id           = google_secret_manager_secret.postal_admin[0].secret_id
    smtp_credential_secret_id = google_secret_manager_secret.postal_smtp_credential[0].secret_id
    admin_email               = var.postal_admin_email
    admin_first_name          = var.postal_admin_first_name
    admin_last_name           = var.postal_admin_last_name
  }) : ""
}

resource "random_password" "postal_mariadb" {
  count   = var.postal_enabled ? 1 : 0
  length  = 48
  special = false
}

resource "random_password" "postal_rails" {
  count   = var.postal_enabled ? 1 : 0
  length  = 96
  special = false
}

resource "random_password" "postal_admin" {
  count   = var.postal_enabled ? 1 : 0
  length  = 32
  special = false
}

resource "random_password" "postal_smtp_credential" {
  count   = var.postal_enabled ? 1 : 0
  length  = 32
  special = false
}

resource "tls_private_key" "postal_signing" {
  count     = var.postal_enabled ? 1 : 0
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_private_key" "postal_domain_dkim" {
  count     = var.postal_enabled ? 1 : 0
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "google_secret_manager_secret" "postal_mariadb" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "claritas-postal-mariadb-root-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled_services["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postal_mariadb" {
  count       = var.postal_enabled ? 1 : 0
  secret      = google_secret_manager_secret.postal_mariadb[0].id
  secret_data = random_password.postal_mariadb[0].result
}

resource "google_secret_manager_secret" "postal_rails" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "claritas-postal-rails-secret-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled_services["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postal_rails" {
  count       = var.postal_enabled ? 1 : 0
  secret      = google_secret_manager_secret.postal_rails[0].id
  secret_data = random_password.postal_rails[0].result
}

resource "google_secret_manager_secret" "postal_signing" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "claritas-postal-signing-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled_services["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postal_signing" {
  count       = var.postal_enabled ? 1 : 0
  secret      = google_secret_manager_secret.postal_signing[0].id
  secret_data = tls_private_key.postal_signing[0].private_key_pem
}

resource "google_secret_manager_secret" "postal_domain_dkim" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "claritas-postal-domain-dkim-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled_services["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postal_domain_dkim" {
  count       = var.postal_enabled ? 1 : 0
  secret      = google_secret_manager_secret.postal_domain_dkim[0].id
  secret_data = tls_private_key.postal_domain_dkim[0].private_key_pem
}

resource "google_secret_manager_secret" "postal_admin" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "claritas-postal-admin-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled_services["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postal_admin" {
  count       = var.postal_enabled ? 1 : 0
  secret      = google_secret_manager_secret.postal_admin[0].id
  secret_data = random_password.postal_admin[0].result
}

resource "google_secret_manager_secret" "postal_smtp_credential" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "claritas-postal-smtp-credential"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled_services["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postal_smtp_credential" {
  count       = var.postal_enabled ? 1 : 0
  secret      = google_secret_manager_secret.postal_smtp_credential[0].id
  secret_data = local.postal_smtp_credential_effective
}

resource "google_service_account" "postal" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  account_id   = "claritas-postal"
  display_name = "Claritas Postal mail server"
}

resource "google_project_iam_member" "postal_logging" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_project_iam_member" "postal_monitoring" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_secret_manager_secret_iam_member" "postal_mariadb" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.postal_mariadb[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_secret_manager_secret_iam_member" "postal_rails" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.postal_rails[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_secret_manager_secret_iam_member" "postal_signing" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.postal_signing[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_secret_manager_secret_iam_member" "postal_domain_dkim" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.postal_domain_dkim[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_secret_manager_secret_iam_member" "postal_admin" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.postal_admin[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postal[0].email}"
}

resource "google_secret_manager_secret_iam_member" "postal_smtp_credential" {
  count     = var.postal_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.postal_smtp_credential[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postal[0].email}"
}

# GitHub Actions uses IAP + OS Login for post-apply health/readiness checks.
resource "google_project_iam_member" "postal_runner_os_admin" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/compute.osAdminLogin"
  member  = "serviceAccount:${local.terraform_runner_sa}"
}

resource "google_project_iam_member" "postal_runner_iap" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/iap.tunnelResourceAccessor"
  member  = "serviceAccount:${local.terraform_runner_sa}"
}

resource "google_service_account_iam_member" "postal_runner_act_as" {
  count              = var.postal_enabled ? 1 : 0
  service_account_id = google_service_account.postal[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.terraform_runner_sa}"
}

# The deployment identity creates and maintains the delegated Postal DNS zone.
# Keep this grant scoped to the opt-in Postal implementation so the standard
# application deployment does not receive additional DNS permissions.
resource "google_project_iam_member" "postal_runner_dns" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${local.terraform_runner_sa}"

  depends_on = [google_project_service.enabled_services["dns.googleapis.com"]]
}

resource "google_compute_address" "postal" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  name         = "claritas-postal-ip"
  description  = "Stable IPv4 address and mail reputation identity for Postal"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"

  depends_on = [google_project_service.enabled_services["compute.googleapis.com"]]
}

############################################
# Delegated Cloud DNS zone and mail records
############################################

resource "google_dns_managed_zone" "postal" {
  count       = var.postal_enabled ? 1 : 0
  project     = var.project_id
  name        = "claritas-postal"
  dns_name    = "${var.postal_domain}."
  description = "Delegated zone for Claritas Postal mail delivery"

  dnssec_config {
    state = "off"
  }

  depends_on = [
    google_project_service.enabled_services["dns.googleapis.com"],
    google_project_iam_member.postal_runner_dns,
  ]
}

resource "google_dns_record_set" "postal_a" {
  for_each = var.postal_enabled ? toset([
    local.postal_web_hostname,
    local.postal_smtp_hostname,
    local.postal_return_path_hostname,
    local.postal_track_hostname,
  ]) : toset([])

  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${each.value}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_address.postal[0].address]
}

resource "google_dns_record_set" "postal_apex_mx" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${var.postal_domain}."
  type         = "MX"
  ttl          = 300
  rrdatas      = ["10 ${local.postal_smtp_hostname}."]
}

resource "google_dns_record_set" "postal_return_path_mx" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${local.postal_return_path_hostname}."
  type         = "MX"
  ttl          = 300
  rrdatas      = ["10 ${local.postal_smtp_hostname}."]
}

resource "google_dns_record_set" "postal_route_mx" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${local.postal_route_hostname}."
  type         = "MX"
  ttl          = 300
  rrdatas      = ["10 ${local.postal_smtp_hostname}."]
}

resource "google_dns_record_set" "postal_spf" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${local.postal_spf_hostname}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"v=spf1 ip4:${google_compute_address.postal[0].address} -all\""]
}

resource "google_dns_record_set" "postal_sender_spf" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${var.postal_domain}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"v=spf1 include:${local.postal_spf_hostname} -all\""]
}

resource "google_dns_record_set" "postal_return_path_spf" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "${local.postal_return_path_hostname}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"v=spf1 a mx include:${local.postal_spf_hostname} -all\""]
}

resource "google_dns_record_set" "postal_sender_return_path" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "psrp.${var.postal_domain}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["${local.postal_return_path_hostname}."]
}

resource "google_dns_record_set" "postal_default_return_path_dkim" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "postal._domainkey.${local.postal_return_path_hostname}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = [local.postal_default_dkim_rrdata]
}

resource "google_dns_record_set" "postal_sender_dkim" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "postal-claritas._domainkey.${var.postal_domain}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = [local.postal_sender_dkim_rrdata]
}

resource "google_dns_record_set" "postal_dmarc" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = google_dns_managed_zone.postal[0].name
  name         = "_dmarc.${var.postal_domain}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"v=DMARC1; p=${var.postal_dmarc_policy}; adkim=s; aspf=r; pct=100\""]
}

############################################
# Persistent data, snapshots, and VM
############################################

resource "google_compute_disk" "postal_data" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  name    = "claritas-postal-data"
  zone    = var.zone
  type    = "pd-balanced"
  size    = var.postal_data_disk_size_gb

  labels = {
    application = "postal"
    environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled_services["compute.googleapis.com"]]
}

resource "google_compute_resource_policy" "postal_snapshots" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  name    = "claritas-postal-daily-snapshots"
  region  = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "03:00"
      }
    }

    retention_policy {
      max_retention_days    = 14
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }

    snapshot_properties {
      storage_locations = [var.region]
      labels = {
        application = "postal"
      }
    }
  }
}

resource "google_compute_disk_resource_policy_attachment" "postal_snapshots" {
  count   = var.postal_enabled ? 1 : 0
  project = var.project_id
  name    = google_compute_resource_policy.postal_snapshots[0].name
  disk    = google_compute_disk.postal_data[0].name
  zone    = var.zone
}

resource "google_compute_instance" "postal" {
  count        = var.postal_enabled ? 1 : 0
  project      = var.project_id
  name         = "claritas-postal"
  description  = "Dedicated Postal email delivery server"
  zone         = var.zone
  machine_type = var.postal_machine_type

  allow_stopping_for_update = true
  deletion_protection       = var.postal_deletion_protection
  tags                      = ["claritas-postal"]

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      type  = "pd-balanced"
      size  = var.postal_boot_disk_size_gb
    }
  }

  attached_disk {
    source      = google_compute_disk.postal_data[0].self_link
    device_name = "postal-data"
    mode        = "READ_WRITE"
  }

  network_interface {
    network = data.google_compute_network.vpc.self_link

    access_config {
      nat_ip                 = google_compute_address.postal[0].address
      network_tier           = "PREMIUM"
      public_ptr_domain_name = var.postal_enable_public_ptr ? "${local.postal_smtp_hostname}." : null
    }
  }

  service_account {
    email  = google_service_account.postal[0].email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
    serial-port-enable     = "FALSE"
  }

  metadata_startup_script = local.postal_startup_script

  # Startup-script changes are applied by postal_startup_script_update below.
  # Without this, the Google provider recreates the VM for every script change,
  # which conflicts with the protected, persistent Postal data disk.
  lifecycle {
    ignore_changes = [metadata_startup_script]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  labels = {
    application = "postal"
    environment = "production"
    managed_by  = "terraform"
  }

  depends_on = [
    google_dns_record_set.postal_a,
    google_secret_manager_secret_version.postal_mariadb,
    google_secret_manager_secret_version.postal_rails,
    google_secret_manager_secret_version.postal_signing,
    google_secret_manager_secret_version.postal_domain_dkim,
    google_secret_manager_secret_version.postal_admin,
    google_secret_manager_secret_version.postal_smtp_credential,
    google_secret_manager_secret_iam_member.postal_mariadb,
    google_secret_manager_secret_iam_member.postal_rails,
    google_secret_manager_secret_iam_member.postal_signing,
    google_secret_manager_secret_iam_member.postal_domain_dkim,
    google_secret_manager_secret_iam_member.postal_admin,
    google_secret_manager_secret_iam_member.postal_smtp_credential,
  ]
}

# Apply a changed startup script to the existing VM and reset it so the GCE
# guest agent executes the new bootstrap. This makes later Postal bootstrap
# changes part of Terraform deployment rather than a manual operator reboot.
resource "terraform_data" "postal_startup_script_update" {
  count = var.postal_enabled ? 1 : 0

  triggers_replace = [sha256(local.postal_startup_script)]

  provisioner "local-exec" {
    command = <<-EOT
      # Keep this POSIX-shell compatible because Terraform invokes local-exec
      # with /bin/sh by default on the deployment runner.
      set -eu
      startup_script=$(mktemp)
      encoded_startup_script=$(mktemp)
      trap 'rm -f "$startup_script" "$encoded_startup_script"' EXIT HUP INT TERM
      printf '%s' "$POSTAL_STARTUP_SCRIPT_B64" > "$encoded_startup_script"
      base64 --decode "$encoded_startup_script" > "$startup_script"
      set -Eeuo pipefail
      startup_script=$(mktemp)
      trap 'rm -f "$startup_script"' EXIT
      printf '%s' "$POSTAL_STARTUP_SCRIPT_B64" | base64 --decode > "$startup_script"
      gcloud compute instances add-metadata "$POSTAL_INSTANCE" \
        --project "$POSTAL_PROJECT" \
        --zone "$POSTAL_ZONE" \
        --metadata-from-file startup-script="$startup_script" \
        --quiet
      gcloud compute instances reset "$POSTAL_INSTANCE" \
        --project "$POSTAL_PROJECT" \
        --zone "$POSTAL_ZONE" \
        --quiet
    EOT

    environment = {
      POSTAL_INSTANCE           = google_compute_instance.postal[0].name
      POSTAL_PROJECT            = var.project_id
      POSTAL_ZONE               = var.zone
      POSTAL_STARTUP_SCRIPT_B64 = base64encode(local.postal_startup_script)
    }
  }

  depends_on = [google_compute_instance.postal]
}

############################################
# Network policy
############################################

resource "google_compute_firewall" "postal_web_acme" {
  count         = var.postal_enabled ? 1 : 0
  project       = var.project_id
  name          = "claritas-postal-web-acme"
  network       = data.google_compute_network.vpc.name
  description   = "Allow ACME HTTP challenges for Postal HTTPS"
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["claritas-postal"]

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }
}

resource "google_compute_firewall" "postal_web_https" {
  count         = var.postal_enabled ? 1 : 0
  project       = var.project_id
  name          = "claritas-postal-web-https"
  network       = data.google_compute_network.vpc.name
  description   = "Allow approved networks to reach the Postal administration UI"
  direction     = "INGRESS"
  source_ranges = var.postal_web_allowed_cidrs
  target_tags   = ["claritas-postal"]

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "postal_smtp_inbound" {
  count         = var.postal_enabled ? 1 : 0
  project       = var.project_id
  name          = "claritas-postal-smtp-inbound"
  network       = data.google_compute_network.vpc.name
  description   = "Allow internet MTAs to deliver bounces and routed mail to Postal"
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["claritas-postal"]

  allow {
    protocol = "tcp"
    ports    = ["25"]
  }
}

resource "google_compute_firewall" "postal_smtp_submission" {
  count         = var.postal_enabled ? 1 : 0
  project       = var.project_id
  name          = "claritas-postal-smtp-submission"
  network       = data.google_compute_network.vpc.name
  description   = "Allow authenticated SMTP submission from GKE/VPC workloads only"
  direction     = "INGRESS"
  source_ranges = var.postal_internal_smtp_cidrs
  target_tags   = ["claritas-postal"]

  allow {
    protocol = "tcp"
    ports    = ["2525"]
  }
}

resource "google_compute_firewall" "postal_iap_ssh" {
  count         = var.postal_enabled ? 1 : 0
  project       = var.project_id
  name          = "claritas-postal-iap-ssh"
  network       = data.google_compute_network.vpc.name
  description   = "Allow administrative SSH only through Google IAP"
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["claritas-postal"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

############################################
# Claritas API SMTP configuration in GKE
############################################

resource "kubernetes_config_map_v1" "claritas_smtp" {
  count = var.postal_enabled ? 1 : 0

  metadata {
    name      = "claritas-smtp"
    namespace = var.k8s_namespace
  }

  data = {
    SMTP_HOST                        = google_compute_instance.postal[0].network_interface[0].network_ip
    SMTP_PORT                        = "2525"
    SMTP_SECURE                      = "false"
    SMTP_FROM                        = var.postal_sender_address
    SMTP_FROM_NAME                   = var.postal_sender_name
    SMTP_REPLY_TO                    = var.postal_reply_to
    EMAIL_PUBLIC_BASE_URL            = var.postal_email_public_base_url
    PERSONAL_BRIEFING_WORKER_ENABLED = tostring(var.postal_email_delivery_enabled)
  }

  depends_on = [google_container_cluster.primary]
}

resource "kubernetes_secret_v1" "claritas_smtp" {
  count = var.postal_enabled ? 1 : 0

  metadata {
    name      = "claritas-smtp"
    namespace = var.k8s_namespace
  }

  data = {
    SMTP_USER     = var.postal_email_delivery_enabled ? var.postal_smtp_username : ""
    SMTP_PASSWORD = var.postal_email_delivery_enabled ? local.postal_smtp_credential_effective : ""
  }

  type       = "Opaque"
  depends_on = [google_container_cluster.primary]

}
