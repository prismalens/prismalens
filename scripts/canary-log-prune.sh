#!/usr/bin/env bash
# Canary for prismalens/gh-workflows#43. Not for merge.
set -euo pipefail

LOG_DIR="${1:-/tmp/canary-logs}"
RETENTION_DAYS="${2:-7}"

files=$(find "$LOG_DIR" -name '*.log' -mtime +"$RETENTION_DAYS")
for f in $files; do
  rm -- "$f"
done
