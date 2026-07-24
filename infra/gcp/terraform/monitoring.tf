resource "google_monitoring_alert_policy" "cloud_sql_memory_pressure" {
  project      = var.project_id
  display_name = "Claritas Cloud SQL memory pressure"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL memory utilization above 90%"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.label.database_id = \"${var.project_id}:${google_sql_database_instance.pg.name}\"",
        "metric.type = \"cloudsql.googleapis.com/database/memory/utilization\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0.90
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  documentation {
    content = "Cloud SQL memory has remained above 90% for five minutes. Check Query Insights, connection counts, transport ingestion volume, and API pool-pressure logs before increasing PostgreSQL max_connections."
  }

  user_labels = {
    service  = "claritas"
    severity = "critical"
  }

  depends_on = [
    google_project_service.enabled_services["monitoring.googleapis.com"]
  ]
}

resource "google_monitoring_alert_policy" "cloud_sql_cpu_pressure" {
  project      = var.project_id
  display_name = "Claritas Cloud SQL sustained CPU pressure"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL CPU utilization above 85%"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.label.database_id = \"${var.project_id}:${google_sql_database_instance.pg.name}\"",
        "metric.type = \"cloudsql.googleapis.com/database/cpu/utilization\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "600s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  documentation {
    content = "Cloud SQL CPU has remained above 85% for ten minutes. Inspect slow-query logs and Query Insights; transport overview reads should use precomputed event/activity tables."
  }

  user_labels = {
    service  = "claritas"
    severity = "warning"
  }

  depends_on = [
    google_project_service.enabled_services["monitoring.googleapis.com"]
  ]
}

resource "google_monitoring_alert_policy" "cloud_sql_connection_pressure" {
  project      = var.project_id
  display_name = "Claritas Cloud SQL connection pressure"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL backend connections above reserved threshold"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.label.database_id = \"${var.project_id}:${google_sql_database_instance.pg.name}\"",
        "metric.type = \"cloudsql.googleapis.com/database/postgresql/num_backends\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = var.cloud_sql_connection_alert_threshold
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.database_id"]
      }
    }
  }

  documentation {
    content = "Cloud SQL backend connections have exceeded the reserved threshold. API pools are capped at five connections per replica and Keycloak at ten; check for unexpected clients or replica growth."
  }

  user_labels = {
    service  = "claritas"
    severity = "warning"
  }

  depends_on = [
    google_project_service.enabled_services["monitoring.googleapis.com"]
  ]
}
