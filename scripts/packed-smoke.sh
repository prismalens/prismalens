#!/usr/bin/env sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel
#
# Packed-artifact smoke (work-005 R0.d): prove the npm tarballs install and run
# in a CLEAN environment — no pnpm, no monorepo, no devDependencies, no repo
# checkout. Catches what unit tests structurally cannot: missing `files`,
# undeclared dependencies, broken bin/shebang wiring, ESM resolution against
# the published layout, engines mismatches.
#
# Usage: packed-smoke.sh <dir-with-tarballs>
#   The dir must hold exactly the 4 closure tarballs from `pnpm pack`:
#   prismalens-*.tgz, prismalens-engine-*.tgz, prismalens-contracts-*.tgz,
#   prismalens-config-*.tgz.
#
# Runs on POSIX sh + node + npm only (works inside node:22-slim / node:24-slim).
set -eu

TARBALLS=$(cd "${1:?usage: packed-smoke.sh <dir-with-tarballs>}" && pwd)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
cd "$SCRATCH"

fail() {
	echo "SMOKE FAIL: $1" >&2
	exit 1
}

find_tarball() {
	# $1: filename prefix. pnpm pack names scoped packages with a single dash
	# (prismalens-engine-0.0.1.tgz) and the unscoped CLI prismalens-<version>.tgz.
	for f in "$TARBALLS"/$1[0-9]*.tgz; do
		[ -e "$f" ] || fail "no tarball matching $1*.tgz in $TARBALLS"
		echo "$f"
		return
	done
}

# The [0-9] in the glob keeps the CLI prefix from matching the scoped tarballs.
CLI_TGZ=$(find_tarball "prismalens-")
ENGINE_TGZ=$(find_tarball "prismalens-engine-")
CONTRACTS_TGZ=$(find_tarball "prismalens-contracts-")
CONFIG_TGZ=$(find_tarball "prismalens-config-")

echo "==> tarballs:"
for t in "$CLI_TGZ" "$ENGINE_TGZ" "$CONTRACTS_TGZ" "$CONFIG_TGZ"; do echo "    $t"; done

# The @prismalens/* deps in the CLI tarball point at versions that do not exist
# on the registry until first publish — overrides pin them to the local tarballs
# so npm resolves the whole closure offline-from-registry's-perspective.
cat > package.json <<EOF
{
	"name": "packed-smoke-scratch",
	"private": true,
	"dependencies": { "prismalens": "file:$CLI_TGZ" },
	"overrides": {
		"@prismalens/engine": "file:$ENGINE_TGZ",
		"@prismalens/contracts": "file:$CONTRACTS_TGZ",
		"@prismalens/config": "file:$CONFIG_TGZ"
	}
}
EOF

echo "==> npm install (clean scratch dir, engines enforced)"
npm install --engine-strict --no-audit --no-fund --loglevel=error || fail "npm install of the packed closure failed"

BIN="$SCRATCH/node_modules/.bin"
[ -x "$BIN/prismalens" ] || fail "prismalens bin not linked"
[ -x "$BIN/pl" ] || fail "pl bin alias not linked"

echo "==> --version matches the packed package.json"
EXPECTED=$(node -p "require('$SCRATCH/node_modules/prismalens/package.json').version")
GOT=$("$BIN/prismalens" --version)
[ "$GOT" = "$EXPECTED" ] || fail "--version printed '$GOT', package.json says '$EXPECTED'"
echo "    $GOT"

echo "==> init scaffolds a config and leaves an existing one untouched"
INIT_DIR=$(mktemp -d)
( cd "$INIT_DIR" && "$BIN/pl" init >/dev/null ) || fail "pl init exited nonzero"
[ -f "$INIT_DIR/prismalens.config.yaml" ] || fail "init did not create prismalens.config.yaml"
echo "sentinel: keep" >> "$INIT_DIR/prismalens.config.yaml"
( cd "$INIT_DIR" && "$BIN/pl" init >/dev/null 2>&1 ) || true
grep -q "sentinel: keep" "$INIT_DIR/prismalens.config.yaml" || fail "second init overwrote the existing config"
rm -rf "$INIT_DIR"

echo "==> doctor fails LOUDLY on a machine with no harness and no credentials"
# This is the first command a real user runs on a broken setup: the failure
# mode is part of the contract. Expect a nonzero exit and an actionable report.
set +e
DOCTOR_OUT=$("$BIN/pl" doctor 2>&1)
DOCTOR_EXIT=$?
set -e
[ "$DOCTOR_EXIT" -ne 0 ] || fail "doctor exited 0 in a clean env with no harness/credentials"
echo "$DOCTOR_OUT" | grep -qi "harness" || fail "doctor output does not mention the missing harness:
$DOCTOR_OUT"

echo "==> investigate rejects garbage stdin with a usable error (no crash)"
set +e
INV_OUT=$(echo "not json" | "$BIN/pl" investigate --json 2>&1)
INV_EXIT=$?
set -e
[ "$INV_EXIT" -ne 0 ] || fail "investigate exited 0 on garbage stdin"
case "$INV_OUT" in
	*Error*|*error*|*invalid*|*Invalid*) : ;;
	*) fail "investigate gave no usable error on garbage stdin:
$INV_OUT" ;;
esac

echo "SMOKE OK (node $(node --version))"
