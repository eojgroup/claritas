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

output "api_egress_ip" {
  description = "Stable outbound IP for Claritas API and SMTP traffic. Authorize this address with the SMTP provider."
  value       = google_compute_address.api_egress.address
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
