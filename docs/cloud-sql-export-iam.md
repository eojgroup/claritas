# Cloud SQL Export IAM

Google Cloud will remove `cloudsql.instances.export` from Cloud SQL Viewer
(`roles/cloudsql.viewer`) and the legacy Reader role on August 1, 2026.

Claritas does not currently run Cloud SQL exports from the application,
Kubernetes workloads, or GitHub Actions. The runtime service account
`claritas-sql-gsa` needs only `roles/cloudsql.client`, so it must not receive
export access.

## Grant Export Access

For operators who genuinely require exports, add their full IAM member names
to `cloud_sql_export_members` in `infra/gcp/terraform/terraform.tfvars`:

```hcl
cloud_sql_export_members = [
  "group:database-operators@example.com",
]
```

Terraform creates and grants the project-level
`claritasCloudSqlExporter` custom role. It contains only the permissions Google
documents as required for PostgreSQL exports:

```text
cloudsql.instances.export
cloudsql.instances.get
```

Do not grant `roles/cloudsql.editor` solely to preserve export functionality.

The Terraform runner must have `roles/iam.roleAdmin` and permission to update
the project's IAM policy before the first custom-role deployment.

## Audit Before August 1, 2026

List principals currently relying on Cloud SQL Viewer:

```bash
gcloud projects get-iam-policy claritas-457808 \
  --flatten='bindings[].members' \
  --filter='bindings.role:roles/cloudsql.viewer' \
  --format='table(bindings.role,bindings.members)'
```

Only add principals that need to run Cloud SQL exports. Then apply Terraform
and confirm the resulting grants:

```bash
terraform -chdir=infra/gcp/terraform plan -var-file=terraform.tfvars
terraform -chdir=infra/gcp/terraform apply -var-file=terraform.tfvars
terraform -chdir=infra/gcp/terraform output cloud_sql_export_members
```

Cloud SQL exports also require the Cloud SQL instance service account to have
write access to the destination Cloud Storage bucket. Grant that access only
on the specific export bucket, not across the project.
