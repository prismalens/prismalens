#!/usr/bin/env bash
# The design matrix: every screen and state at 1280, 768 and 390 in dark and light, with
# axe contrast, targets, clipping, sideways scroll, console errors and control counts.
# Usage: scripts/ui-shots.sh [out dir] (default design-shots/matrix). Writes PNGs and matrix.json.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
out="${1:-design-shots/matrix}"
DESIGN_SHOTS=1 DESIGN_SHOTS_DIR="$out" pnpm exec playwright test e2e/journeys/design-matrix.spec.ts \
	--project=chromium --workers=1 --reporter=line
