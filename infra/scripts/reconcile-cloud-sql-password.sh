#!/usr/bin/env bash
set +x
set -euo pipefail

project="${1:?project is required}"
instance="${2:?instance is required}"
database_user="${3:?database user is required}"
: "${CLARITAS_SQL_PASSWORD:?database password is required}"
attempts="${CLOUD_SQL_PASSWORD_ATTEMPTS:-20}"
delay_seconds="${CLOUD_SQL_PASSWORD_RETRY_SECONDS:-15}"

if ! [[ "$attempts" =~ ^[1-9][0-9]*$ && "$delay_seconds" =~ ^[0-9]+$ ]]; then
  echo "Invalid Cloud SQL retry configuration." >&2
  exit 2
fi

for ((attempt = 1; attempt <= attempts; attempt++)); do
  if output="$(gcloud sql users set-password "$database_user" \
      --instance="$instance" --project="$project" \
      --password="$CLARITAS_SQL_PASSWORD" --quiet 2>&1)"; then
    echo "Cloud SQL password reconciled for ${database_user}."
    exit 0
  else
    status=$?
  fi

  # Backups and maintenance can hold the instance operation lock even when
  # GitHub deployments are serialized. Repeating the same password is safe;
  # permission, validation and other failures must still fail immediately.
  if grep -Eq 'HTTP(Error| Error) 409' <<< "$output" \
      && grep -Fq 'another operation was already in progress' <<< "$output" \
      && (( attempt < attempts )); then
    echo "Cloud SQL is busy; retrying ${database_user} (${attempt}/${attempts}) in ${delay_seconds}s."
    sleep "$delay_seconds"
    continue
  fi

  # Never print a supplied password, even when a CLI error echoes its flags.
  printf '%s\n' "${output//"$CLARITAS_SQL_PASSWORD"/[REDACTED]}" >&2
  echo "Cloud SQL password reconciliation failed for ${database_user} after ${attempt} attempt(s)." >&2
  exit "$status"
done
