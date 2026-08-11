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
    google_project_service.enabled_services["monitoring.googleapis.com"],
    google_project_iam_member.terraform_runner_monitoring_alerts
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
    google_project_service.enabled_services["monitoring.googleapis.com"],
    google_project_iam_member.terraform_runner_monitoring_alerts
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
    content = "Cloud SQL backend connections have exceeded the reserved threshold. The cost baseline caps the single API pool at three connections and Keycloak at five; check for unexpected clients or replica growth."
  }

  user_labels = {
    service  = "claritas"
    severity = "warning"
  }

  depends_on = [
    google_project_service.enabled_services["monitoring.googleapis.com"],
    google_project_iam_member.terraform_runner_monitoring_alerts
  ]
}

resource "google_monitoring_alert_policy" "domain_event_subscription_backlog" {
  project      = var.project_id
  display_name = "Claritas domain-event backlog"
  combiner     = "OR"

  conditions {
    display_name = "Oldest unacknowledged domain event exceeds ten minutes"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"pubsub_subscription\"",
        "resource.label.subscription_id = \"${google_pubsub_subscription.domain_events_api.name}\"",
        "metric.type = \"pubsub.googleapis.com/subscription/oldest_unacked_message_age\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 600
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  documentation {
    content = "The cross-domain event consumer is at least ten minutes behind. Inspect claritas-api event consumer logs, database leases, and the dead-letter subscription."
  }

  user_labels = { service = "claritas", severity = "critical" }
  depends_on  = [google_project_iam_member.terraform_runner_monitoring_alerts]
}

resource "google_monitoring_alert_policy" "domain_event_dead_letters" {
  project      = var.project_id
  display_name = "Claritas event dead letters"
  combiner     = "OR"

  conditions {
    display_name = "Unresolved Pub/Sub dead letters present"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"pubsub_subscription\"",
        "resource.label.subscription_id = \"${google_pubsub_subscription.dead_letter_operations.name}\"",
        "metric.type = \"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  documentation {
    content = "A domain event exhausted Pub/Sub delivery attempts. Inspect the dead-letter subscription and event_dead_letter table before replaying it."
  }

  user_labels = { service = "claritas", severity = "critical" }
  depends_on  = [google_project_iam_member.terraform_runner_monitoring_alerts]
}

resource "google_logging_metric" "earth_observation_failures" {
  project = var.project_id
  name    = "claritas_earth_observation_failures"
  filter = join(" AND ", [
    "resource.type=\"k8s_container\"",
    "resource.labels.container_name=\"claritas-api\"",
    "(jsonPayload.event=\"earth_observation_worker_failed\" OR jsonPayload.event=\"firms_poll_failed\" OR jsonPayload.event=\"usgs_poll_failed\")",
  ])
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_iam_member.terraform_runner_logging_metrics]
}

resource "google_monitoring_alert_policy" "earth_observation_repeated_failures" {
  project      = var.project_id
  display_name = "Claritas Earth Observation provider failures"
  combiner     = "OR"
  conditions {
    display_name = "Three Earth Observation/source failures in fifteen minutes"
    condition_threshold {
      filter          = "metric.type = \"logging.googleapis.com/user/${google_logging_metric.earth_observation_failures.name}\" AND resource.type = \"k8s_container\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "0s"
      aggregations {
        alignment_period     = "900s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  documentation {
    content = "Copernicus, FIRMS, or USGS failed repeatedly. Inspect provider status, rate-limit state, credentials, and static egress before retrying jobs."
  }
  user_labels = { service = "claritas", severity = "warning" }
  depends_on  = [google_project_iam_member.terraform_runner_monitoring_alerts]
}
