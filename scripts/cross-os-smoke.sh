#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel
#
# Cross-OS from-scratch CLI smoke: drives an ALREADY-INSTALLED `prismalens`
# package (tarball or registry install, doesn't matter which — see
# .github/workflows/cross-os-smoke.yml) as a real subprocess on Linux,
# macOS, and Windows (git-bash). This is phase-gate testing part 2 (the
# released-artifact verification), not sreforge — sreforge is the separate
# clean-env engine/eval capabilities ground.
#
# Shares its core assertions with scripts/packed-smoke.sh (which only proves
# the npm tarballs are well-formed, on Linux containers, as part of CI's
# `pack`/`packed-smoke` jobs) but adds OS coverage and new commands: status,
# unknown-flag handling, and a serve JSON-RPC round-trip.
#
# Usage: cross-os-smoke.sh <scratch-dir>
#   <scratch-dir> must contain a completed `npm install` of the `prismalens`
#   package: <scratch-dir>/node_modules/.bin/{prismalens,pl} and
#   <scratch-dir>/node_modules/prismalens/package.json.
#
# Runs under `bash` on all three OSes (workflow sets `shell: bash`, which on
# windows-latest is git-bash/MSYS2). npm's bin-linker writes THREE files per
# bin on Windows (`prismalens`, `prismalens.cmd`, `prismalens.ps1`); the
# extensionless `prismalens` file is a POSIX sh shim built for exactly this
# environment, so invoking "$BIN/prismalens" works unmodified on all three
# OSes — no .cmd/.exe special-casing needed.
set -euo pipefail

# On git-bash (windows-latest), bash's own `pwd`/`mktemp` return MSYS-style
# POSIX paths (e.g. /d/a/prismalens/scratch). Those resolve fine for bash's
# OWN file operations (MSYS coreutils understand them), but a spawned
# node.exe interprets a bare string like "/d/a/..." per Win32 rules (leading
# "/" = root of the current drive), NOT as the MSYS mount — silently
# pointing at the wrong, nonexistent directory. cygpath -m emits the
# "mixed" form (drive letter + forward slashes, e.g. D:/a/prismalens/scratch)
# that both MSYS bash AND native Node.js parse correctly, and — unlike
# cygpath -w's backslashes — is safe to embed inside a single-quoted JS
# string (`node -p "require('...')"`) with no escaping surprises. No-op on
# Linux/macOS, where cygpath doesn't exist.
native_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		printf '%s' "$1"
	fi
}

SCRATCH=$(native_path "$(cd "${1:?usage: cross-os-smoke.sh <scratch-dir>}" && pwd)")
BIN="$SCRATCH/node_modules/.bin"

fail() {
	echo "SMOKE FAIL: $1" >&2
	exit 1
}

[ -x "$BIN/prismalens" ] || fail "prismalens bin not linked at $BIN/prismalens"
[ -x "$BIN/pl" ] || fail "pl bin alias not linked at $BIN/pl"

# Isolate workspace state (session/status history) from the runner's real
# home dir — sidesteps ~ resolution differences on Windows entirely and
# guarantees a clean-slate `status`. A subdir of the already-native-safe
# SCRATCH, not mktemp -d, so the exported env var below is in the same safe
# form (see native_path above) when the CLI's node.exe subprocess reads it.
WORKSPACE_DIR="$SCRATCH/.prismalens-workspace"
mkdir -p "$WORKSPACE_DIR"
export PRISMALENS_WORKSPACE_DIR="$WORKSPACE_DIR"

echo "==> --version matches the installed package.json"
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

echo "==> doctor fails LOUDLY on a machine with no harness and no credentials"
set +e
DOCTOR_OUT=$("$BIN/pl" doctor 2>&1)
DOCTOR_EXIT=$?
set -e
[ "$DOCTOR_EXIT" -ne 0 ] || fail "doctor exited 0 in a clean env with no harness/credentials"
echo "$DOCTOR_OUT" | grep -qi "harness" || fail "doctor output does not mention the missing harness:
$DOCTOR_OUT"

echo "==> status on a clean workspace reports no runs, exit 0"
STATUS_OUT=$("$BIN/pl" status) || fail "status exited nonzero on a clean workspace"
echo "$STATUS_OUT" | grep -qi "no runs found" || fail "status did not report 'No runs found':
$STATUS_OUT"

echo "==> unknown flag is rejected with exit 1"
set +e
BAD_FLAG_OUT=$("$BIN/pl" status --this-flag-does-not-exist 2>&1)
BAD_FLAG_EXIT=$?
set -e
[ "$BAD_FLAG_EXIT" -ne 0 ] || fail "unknown flag exited 0"
echo "$BAD_FLAG_OUT" | grep -q "Unknown option:" || fail "unknown-flag output missing 'Unknown option:':
$BAD_FLAG_OUT"

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

echo "==> serve completes a JSON-RPC 2.0 initialize round-trip over stdio"
SERVE_OUT=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' | "$BIN/pl" serve) \
	|| fail "serve exited nonzero on a clean initialize round-trip"
echo "$SERVE_OUT" | grep -q '"protocolVersion"' || fail "serve response missing protocolVersion:
$SERVE_OUT"
echo "$SERVE_OUT" | grep -q '"serverInfo"' || fail "serve response missing serverInfo:
$SERVE_OUT"

echo "SMOKE OK (node $(node --version), $EXPECTED)"
