output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}

output "project_id" {
  value = var.project_id
}