#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel

set -euo pipefail

TARBALL_PATH="/home/sumit/worktrees/prismalens/327-rerun-option-b/packages/cli/prismalens-0.4.0.tgz"

docker run --rm -i \
  -v "$TARBALL_PATH:/tmp/prismalens-0.4.0.tgz:ro" \
  node:22-slim bash -s << 'DOCKER_SCRIPT'
set -eu
set -m

apt-get update -qq && apt-get install -y -qq curl procps >/dev/null

echo "================================================================================"
echo "=== STEP 4: INSTALLATION IN CLEAN CONTAINER ==="
echo "================================================================================"
echo "Compiler toolchain check:"
which gcc g++ make python3 || echo "No compiler toolchain installed in node:22-slim"

echo "Running npm install -g /tmp/prismalens-0.4.0.tgz..."
INSTALL_START=$(date +%s)
INSTALL_LOG=$(npm install -g /tmp/prismalens-0.4.0.tgz 2>&1)
INSTALL_EXIT=$?
INSTALL_END=$(date +%s)
INSTALL_TIME=$((INSTALL_END - INSTALL_START))

echo "Install Exit Code: $INSTALL_EXIT"
echo "Install Time: ${INSTALL_TIME}s"
echo "Install Log Output:"
echo "$INSTALL_LOG"

echo "================================================================================"
echo "=== NATIVE BINDINGS CHECK: better-sqlite3 ==="
echo "================================================================================"
BS_NODE=$(find /usr/local/lib/node_modules -name "better_sqlite3.node" 2>/dev/null || echo "not found")
echo "better_sqlite3.node path: $BS_NODE"
if [ -f "$BS_NODE" ]; then
  echo "better_sqlite3.node file exists"
fi

echo "================================================================================"
echo "=== STEP 5: BOOTING PRISMALENS UP ==="
echo "================================================================================"
export PRISMALENS_WORKSPACE_DIR=/tmp/prismalens-container-workspace
export PRISMALENS_PORT=3001
export PRISMALENS_HOST=0.0.0.0
export NODE_ENV=development

mkdir -p "$PRISMALENS_WORKSPACE_DIR"

prismalens up > /tmp/boot.log 2>&1 &
APP_PID=$!

echo "Waiting for app to initialize and map routes..."
FOR_I=0
READY=0
while [ $FOR_I -lt 150 ]; do
  if curl -s http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "App is up and responding on port 3001 after ${FOR_I}s!"
    READY=1
    break
  fi
  sleep 1
  FOR_I=$((FOR_I + 1))
done

if [ $READY -eq 0 ]; then
  echo "ERROR: App failed to respond on port 3001 within 60 seconds!"
  echo "=== BOOT LOG ON FAILURE ==="
  cat /tmp/boot.log
  exit 1
fi


echo "================================================================================"
echo "=== ASSERTIONS AGAINST SINGLE ORIGIN (http://127.0.0.1:3001) ==="
echo "================================================================================"

echo "--- 1. GET /health ---"
curl -i -s http://127.0.0.1:3001/health

echo -e "\n--- 2. Static Asset (SPA bundle file) ---"
STATIC_ASSET=$(ls /usr/local/lib/node_modules/prismalens/dist/public/assets/*.js 2>/dev/null | head -n 1 | xargs -n 1 basename || echo "")
if [ -n "$STATIC_ASSET" ]; then
  echo "Requesting /assets/$STATIC_ASSET..."
  curl -i -s "http://127.0.0.1:3001/assets/$STATIC_ASSET" | head -n 15
else
  echo "No static asset js file found directly, checking dist/public..."
  ls -la /usr/local/lib/node_modules/prismalens/dist/public/
fi

echo -e "\n--- 3. SPA Fallback on Deep Client Route GET /incidents/1 ---"
curl -i -s http://127.0.0.1:3001/incidents/1 | head -n 25

echo -e "\n--- 4. GET /api/docs ---"
curl -i -s http://127.0.0.1:3001/api/docs | head -n 25

echo -e "\n--- 5. POST /api/auth/sign-in/email ---"
SIGNIN_RESP=$(curl -i -s -c /tmp/cookies.txt -X POST http://127.0.0.1:3001/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@prismalens.dev","password":"admin123"}')
echo "$SIGNIN_RESP"

echo -e "\n--- 6. Authenticated /api call (GET /api/incidents) using session ---"
curl -i -s -b /tmp/cookies.txt http://127.0.0.1:3001/api/incidents

echo -e "\n--- 7. Route Shadowing & Webhook Resolution ---"
echo "7a. Shadowing check: non-existent /api/nonexistent should return 404 API error (not static HTML fallback):"
curl -i -s http://127.0.0.1:3001/api/nonexistent | head -n 20

echo -e "\n7b. Webhook route POST /api/webhooks/generic:"
curl -i -s -X POST http://127.0.0.1:3001/api/webhooks/generic \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Alert","severity":"high","source":"test"}'

echo -e "\n================================================================================"
echo "=== STEP 6: ROUTE MAPPING ANALYSIS & BOOT LOG ==="
echo "================================================================================"
MAPPED_COUNT=$(grep -c "Mapped {" /tmp/boot.log || true)
echo "Total Mapped Routes Count: $MAPPED_COUNT"
AUTH_ROUTE_PRESENT=$(grep -c "Mapped {/api/auth/\*path" /tmp/boot.log || true)
echo "/api/auth/*path Present Count: $AUTH_ROUTE_PRESENT"

echo -e "\n================================================================================"
echo "=== CONTAINER TEST COMPLETE ==="
echo "================================================================================"

kill $APP_PID 2>/dev/null || true
DOCKER_SCRIPT
