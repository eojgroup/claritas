output "project_id" {
  value = var.project_id
}

output "instance_connection_name" {
  value       = google_sql_database_instance.pg.connection_name
  description = "Cloud SQL instance connection string"
}

output "private_ip_address" {
  value       = google_sql_database_instance.pg.private_ip_address
  description = "Private IP of the Cloud SQL instance"
}

output "db_name" {
  value       = google_sql_database.db.name
  description = "Database name"
}

output "db_user" {
  value       = google_sql_user.app.name
  description = "Database user"
}

output "db_pass" {
  value       = random_password.db_password.result
  description = "Database password"
  sensitive   = true
}