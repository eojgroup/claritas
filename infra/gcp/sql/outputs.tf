output "instance_connection_name" {
  value       = google_sql_database_instance.pg.connection_name
  description = "PROJECT:REGION:INSTANCE"
}

output "private_ip_address" {
  value = google_sql_database_instance.pg.private_ip_address
}

output "db_name"   { value = google_sql_database.db.name }
output "db_user"   { value = google_sql_user.app.name }
output "db_pass"   { value = random_password.db_password.result  sensitive = true }