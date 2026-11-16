#!/usr/bin/env bash
# The design matrix: every screen and state at 1280, 768 and 390 in dark and light, with
# axe contrast, targets, clipping, sideways scroll, console errors and control counts.
# Usage: scripts/ui-shots.sh [out dir] (default design-shots/matrix). Writes PNGs and matrix.json,
# matrix.json after every measurement.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
out="${1:-design-shots/matrix}"
# Against a production build the API serves (pnpm sim's built mode), so no dev server
# re-optimizes mid-run; UI_SHOTS_DEV=1 shoots the Vite dev server instead.
if [ "${UI_SHOTS_DEV:-}" != "1" ]; then
	VITE_DESIGN_GALLERY=1 node node_modules/vite/bin/vite.js build >/dev/null || exit 1
	export PRISMALENS_E2E_BUILT=1 PRISMALENS_SIM_PREBUILT=1
fi
DESIGN_SHOTS=1 DESIGN_SHOTS_DIR="$out" pnpm exec playwright test e2e/journeys/design-matrix.spec.ts \
	--project=chromium --workers=1 --reporter=line
