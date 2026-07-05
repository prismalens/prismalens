#!/bin/bash
# SessionStart hook for Claude Code on the web: bring a fresh container to a
# state where build/typecheck/test/lint all work immediately.
# Order matters and mirrors CI (.github/workflows/ci.yml):
#   1. pnpm install     — node_modules (postinstall rebuilds better-sqlite3)
#   2. pnpm db:generate — the Prisma client MUST be regenerated after every
#                         install (a stale client from a different prisma
#                         version breaks every DB consumer at import time)
#   3. pnpm build       — populates each package's dist/ so cross-package
#                         typecheck and tests resolve workspace deps
# Idempotent: pnpm and turbo caching make re-runs cheap.
set -euo pipefail

# Web sessions only — local checkouts manage their own environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

# CLAUDE_PROJECT_DIR is set by the hook runner; fall back to the repo root
# (two levels up from this script) so the hook is also runnable by hand.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

pnpm install
pnpm db:generate
pnpm build
