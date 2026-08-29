#!/usr/bin/env bash
set -euo pipefail

# Prune canary artifacts older than seven days.
ARTIFACT_DIR="${1:-/tmp/canary artifacts}"
RETENTION_DAYS="${2:-7}"

find "$ARTIFACT_DIR" -type f -mtime "+$RETENTION_DAYS" -delete
