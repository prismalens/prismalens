#!/usr/bin/env bash
set -e

echo "==> 1. Global Install in node:22-slim..."
START_INSTALL=$(date +%s%3N)
npm i -g /tmp/prismalens-0.4.0.tgz
END_INSTALL=$(date +%s%3N)
INSTALL_TIME=$((END_INSTALL - START_INSTALL))
echo "Install completed in ${INSTALL_TIME}ms"

echo "==> 2. Checking installed binaries and better-sqlite3..."
which prismalens
which pl
prismalens --version

echo "==> 3. Booting 'prismalens up'..."
export PRISMALENS_PORT=3001
export PRISMALENS_HOST=0.0.0.0
export DATABASE_URL="file:/tmp/prismalens-spike.db"
export NODE_ENV="production"

# Record boot start time
BOOT_START=$(date +%s%3N)
prismalens up > /tmp/boot.log 2>&1 &
PID=$!

echo "Waiting for app to become ready on http://localhost:3001/health..."
READY=0
for i in $(seq 1 30); do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        READY=1
        BOOT_END=$(date +%s%3N)
        BOOT_TIME=$((BOOT_END - BOOT_START))
        echo "APP READY in ${BOOT_TIME}ms!"
        break
    fi
    sleep 0.5
done

if [ $READY -eq 0 ]; then
    echo "APP FAILED TO BECOME READY WITHIN 15s. Boot Log:"
    cat /tmp/boot.log
    kill $PID || true
    exit 1
fi

echo "=== BOOT LOG ==="
cat /tmp/boot.log
echo "================"

echo ""
echo "==> 4. Route & Single Origin Assertions:"

echo "--- A. GET /health ---"
curl -s -i http://localhost:3001/health
echo ""

echo "--- B. Static Asset (CSS/JS bundle) ---"
ASSET=$(ls /usr/local/lib/node_modules/prismalens/dist/public/assets/*.css | head -n 1 | xargs basename)
echo "Fetching static asset: /assets/$ASSET"
curl -s -i "http://localhost:3001/assets/$ASSET" | head -n 15
echo ""

echo "--- C. SPA Fallback (deep route /incidents/1) ---"
curl -s -i http://localhost:3001/incidents/1 | head -n 20
echo ""

echo "--- D. Docs Route (/api/docs) ---"
curl -s -i http://localhost:3001/api/docs | head -n 15
echo ""

echo "--- E. Authenticated / API Call ---"
echo "Attempting auth sign-in with admin@prismalens.dev..."
AUTH_RESP=$(curl -s -i -X POST http://localhost:3001/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@prismalens.dev","password":"admin123"}')
echo "$AUTH_RESP" | head -n 20

echo ""
echo "Attempting unauthenticated /api call (e.g. /api/incidents or /api/auth/get-session)..."
curl -s -i http://localhost:3001/api/auth/get-session | head -n 15

echo ""
echo "==> 5. Native Bindings Verification:"
node -e "
const bs = require('/usr/local/lib/node_modules/prismalens/node_modules/better-sqlite3');
console.log('better-sqlite3 resolved successfully:', typeof bs);
" || node -e "
const bs = require('better-sqlite3');
console.log('better-sqlite3 resolved from global:', typeof bs);
"

kill $PID || true
