mock_provider "google" {
  mock_data "google_compute_network" {
    defaults = {
      name      = "default"
      self_link = "https://www.googleapis.com/compute/v1/projects/claritas-test/global/networks/default"
    }
  }
}
mock_provider "kubernetes" {}
mock_provider "random" {}
mock_provider "tls" {}

variables {
  project_id                 = "claritas-test"
  postal_deletion_protection = false
}

run "postal_is_disabled_by_default" {
  command = plan

  assert {
    condition     = output.postal_enabled == false
    error_message = "Postal must remain opt-in so an ordinary infrastructure apply cannot start mail delivery."
  }
}

run "postal_resources_can_be_planned" {
  command = plan

  variables {
    postal_enabled                = true
    postal_email_delivery_enabled = false
    postal_admin_email            = "operator@example.com"
  }

  assert {
    condition     = output.postal_enabled == true
    error_message = "The Postal-enabled plan should expose an enabled deployment."
  }

  assert {
    condition     = output.postal_smtp_credential_configured == false
    error_message = "Provisioning Postal must not automatically turn on briefing delivery."
  }

  assert {
    condition     = output.postal_web_url == "https://postal.briefings.claritas.info"
    error_message = "Postal should use the isolated delegated briefing domain."
  }
}
