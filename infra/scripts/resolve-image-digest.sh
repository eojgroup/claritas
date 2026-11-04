#!/usr/bin/env bash
set -euo pipefail

ref="${1:?Usage: resolve-image-digest.sh IMAGE_REFERENCE}"
attempts="${IMAGE_DIGEST_ATTEMPTS:-3}"
retry_seconds="${IMAGE_DIGEST_RETRY_SECONDS:-5}"
if [[ ! "$attempts" =~ ^[1-9][0-9]*$ || ! "$retry_seconds" =~ ^[0-9]+$ ]]; then
  echo "Image digest retry settings must be non-negative integers with at least one attempt." >&2
  exit 2
fi

for ((attempt=1; attempt<=attempts; attempt++)); do
  # Inspect failures belong inside the retry condition. An unguarded command
  # substitution under errexit/pipefail exits before the retry loop can run.
  # Capture all output before parsing: an early-exit awk can close a pipe while
  # buildx still writes manifest details and turn a valid result into failure.
  if inspection="$(docker buildx imagetools inspect "$ref")"; then
    digest="$(printf '%s\n' "$inspection" | awk '$1 == "Digest:" && !found { print $2; found=1 }')"
    if [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      printf '%s\n' "$digest"
      exit 0
    fi
  fi
  echo "Image digest inspection attempt ${attempt}/${attempts} did not return a valid manifest digest." >&2
  if ((attempt<attempts)); then sleep "$((attempt*retry_seconds))"; fi
done
echo "Failed to resolve an immutable digest for ${ref}." >&2
exit 1
