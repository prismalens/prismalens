#!/usr/bin/env bash
set -euo pipefail

# Prune canary artifacts older than seven days.
ARTIFACT_DIR="${1:-/tmp/canary artifacts}"

find "$ARTIFACT_DIR" -type f -mtime +7 -delete
