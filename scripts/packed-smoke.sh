#!/usr/bin/env sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel
#
# Packed-artifact smoke (work-005 R0.d): prove the npm tarball installs and runs
# in a CLEAN environment — no pnpm, no monorepo, no devDependencies, no repo
# checkout. Catches what unit tests structurally cannot: missing `files`,
# undeclared dependencies, broken bin/shebang wiring, ESM resolution against
# the published layout, engines mismatches.
#
# Usage: packed-smoke.sh <dir-with-tarball>
#   The dir must hold the single published tarball from `pnpm pack`:
#   prismalens-<version>.tgz. The first-party @prismalens/* closure is bundled
#   INTO it (issue #193) — there is nothing else to install.
#
# Runs on POSIX sh + node + npm only (works inside node:22-slim / node:24-slim).
set -eu

TARBALLS=$(cd "${1:?usage: packed-smoke.sh <dir-with-tarball>}" && pwd)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
cd "$SCRATCH"

fail() {
	echo "SMOKE FAIL: $1" >&2
	exit 1
}

find_tarball() {
	# $1: filename prefix. The [0-9] in the glob anchors the version digit so
	# the prefix cannot accidentally match a differently-named tarball.
	for f in "$TARBALLS"/$1[0-9]*.tgz; do
		[ -e "$f" ] || fail "no tarball matching $1*.tgz in $TARBALLS"
		echo "$f"
		return
	done
}

CLI_TGZ=$(find_tarball "prismalens-")

echo "==> tarball:"
echo "    $CLI_TGZ"

echo "==> tarball is self-contained: no @prismalens/* in its dependencies"
# The closure is bundled, not published (issue #193) — a leftover @prismalens/*
# dependency would make a fresh install unresolvable against the registry.
if tar -xzOf "$CLI_TGZ" package/package.json | node -e "
	const pkg = JSON.parse(require('fs').readFileSync(0, 'utf8'));
	process.exit(Object.keys(pkg.dependencies ?? {}).some((d) => d.startsWith('@prismalens/')) ? 0 : 1);
"; then
	fail "the CLI tarball's dependencies still reference @prismalens/* — the closure is not bundled"
fi

cat > package.json <<EOF
{
	"name": "packed-smoke-scratch",
	"private": true,
	"dependencies": { "prismalens": "file:$CLI_TGZ" }
}
EOF

echo "==> npm install (clean scratch dir, engines enforced)"
npm install --engine-strict --no-audit --no-fund --loglevel=error || fail "npm install of the packed tarball failed"

BIN="$SCRATCH/node_modules/.bin"
[ -x "$BIN/prismalens" ] || fail "prismalens bin not linked"
[ -x "$BIN/pl" ] || fail "pl bin alias not linked"

echo "==> no @prismalens/* packages materialised in node_modules (bundled, not installed)"
[ ! -d "$SCRATCH/node_modules/@prismalens" ] || fail "@prismalens/* appeared in node_modules — the closure leaked out of the bundle"

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
