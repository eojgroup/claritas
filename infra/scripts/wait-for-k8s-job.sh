#!/usr/bin/env bash
set -euo pipefail

namespace="${1:?namespace is required}"
job="${2:?job name is required}"
timeout_seconds="${3:-600}"

if ! [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "timeout must be a positive integer, got: $timeout_seconds" >&2
  exit 2
fi

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
  conditions="$(
    kubectl -n "$namespace" get job "$job" \
      -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"\n"}{end}' \
      2>/dev/null || true
  )"

  if grep -Fxq 'Complete=True' <<<"$conditions"; then
    echo "job/$job completed successfully."
    exit 0
  fi

  if grep -Fxq 'Failed=True' <<<"$conditions"; then
    echo "job/$job reported Failed." >&2
    exit 1
  fi

  sleep 5
done

echo "Timed out after ${timeout_seconds}s waiting for job/$job." >&2
exit 1
