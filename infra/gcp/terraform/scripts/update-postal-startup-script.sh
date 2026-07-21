#!/bin/sh
# Terraform local-exec uses /bin/sh by default on the deployment runner.
set -eu

startup_script=$(mktemp)
encoded_startup_script=$(mktemp)
trap 'rm -f "$startup_script" "$encoded_startup_script"' EXIT HUP INT TERM

# Avoid a pipeline: under POSIX sh, a failed base64 decoder must stop the
# deployment before incomplete startup-script metadata can be uploaded.
printf '%s' "$POSTAL_STARTUP_SCRIPT_B64" > "$encoded_startup_script"
base64 --decode "$encoded_startup_script" > "$startup_script"

gcloud compute instances add-metadata "$POSTAL_INSTANCE" \
  --project "$POSTAL_PROJECT" \
  --zone "$POSTAL_ZONE" \
  --metadata-from-file startup-script="$startup_script" \
  --quiet

gcloud compute instances reset "$POSTAL_INSTANCE" \
  --project "$POSTAL_PROJECT" \
  --zone "$POSTAL_ZONE" \
  --quiet
