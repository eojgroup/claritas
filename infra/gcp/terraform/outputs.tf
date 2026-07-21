output "project_id" {
  value = var.project_id
}

output "instance_connection_name" {
  value = google_sql_database_instance.pg.connection_name
}

output "private_ip_address" {
  value = google_sql_database_instance.pg.private_ip_address
}

output "db_name" {
  value = google_sql_database.db.name
}

output "db_user" {
  value = google_sql_user.app.name
}

output "db_pass" {
  value     = random_password.db_password.result
  sensitive = true
}

output "keycloak_db_name" {
  value = google_sql_database.keycloak_db.name
}

output "keycloak_db_user" {
  value = google_sql_user.keycloak.name
}

output "keycloak_db_pass" {
  value     = random_password.keycloak_db_password.result
  sensitive = true
}

output "keycloak_admin" {
  value = var.keycloak_admin
}

output "keycloak_admin_password" {
  value     = try(trimspace(var.keycloak_admin_password), "") != "" ? var.keycloak_admin_password : random_password.keycloak_admin_password.result
  sensitive = true
}

output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}

output "artifact_registry_repo_name" {
  value = google_artifact_registry_repository.claritas_app.name
}

output "claritas_sql_gsa_email" {
  value = google_service_account.claritas_sql_gsa.email
}

output "cloud_sql_export_role_name" {
  description = "Custom Cloud SQL export role when export members are configured."
  value       = try(google_project_iam_custom_role.cloud_sql_exporter[0].name, null)
}

output "cloud_sql_export_members" {
  description = "IAM members explicitly granted the least-privilege Cloud SQL exporter role."
  value       = sort(tolist(var.cloud_sql_export_members))
}

output "auth_secret_ids" {
  value = { for key, secret in google_secret_manager_secret.auth : key => secret.id }
}

output "postal_enabled" {
  description = "Whether the Postal infrastructure is enabled."
  value       = var.postal_enabled
}

output "postal_vm_name" {
  description = "Postal Compute Engine instance name."
  value       = try(google_compute_instance.postal[0].name, null)
}

output "postal_external_ip" {
  description = "Stable Postal IPv4 address used for A, SPF, and reverse-DNS records."
  value       = try(google_compute_address.postal[0].address, null)
}

output "postal_internal_ip" {
  description = "Private Postal address used by the Claritas API for SMTP submission."
  value       = try(google_compute_instance.postal[0].network_interface[0].network_ip, null)
}

output "postal_web_url" {
  description = "Postal administration URL."
  value       = var.postal_enabled ? "https://${local.postal_web_hostname}" : null
}

output "postal_smtp_hostname" {
  description = "Public SMTP/HELO/PTR hostname."
  value       = var.postal_enabled ? local.postal_smtp_hostname : null
}

output "postal_dns_delegation" {
  description = "Create an NS record with these nameservers in the parent DNS provider."
  value = var.postal_enabled ? {
    subdomain   = var.postal_domain
    nameservers = google_dns_managed_zone.postal[0].name_servers
  } : null
}

output "postal_ptr_enabled" {
  description = "Whether the Compute Engine PTR record is enabled."
  value       = var.postal_enabled && var.postal_enable_public_ptr
}

output "postal_sender_dkim_managed" {
  description = "Whether Terraform manages the deterministic DKIM key for the Postal sending domain."
  value       = var.postal_enabled
}

output "postal_smtp_credential_configured" {
  description = "Whether personalised briefing delivery through Postal is enabled."
  value       = var.postal_enabled && var.postal_email_delivery_enabled
}

output "postal_admin_password_command" {
  description = "Command for an authorized operator to retrieve the Terraform-generated Postal administrator password."
  value       = var.postal_enabled ? "gcloud secrets versions access latest --project ${var.project_id} --secret claritas-postal-admin-password" : null
}
