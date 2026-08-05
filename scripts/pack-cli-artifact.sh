#!/usr/bin/env bash
set -euo pipefail

CLI_DIR="/home/sumit/worktrees/prismalens/327-packed-artifact/packages/cli"
DIST_DIR="$CLI_DIR/dist"

echo "==> Assembling 6 build products into CLI dist/..."

# 1. NestJS dist/main build
echo "-> Copying NestJS API dist..."
mkdir -p "$DIST_DIR/api"
cp -r /home/sumit/worktrees/prismalens/327-packed-artifact/packages/api/dist/* "$DIST_DIR/api/"

# 2. Static SPA build
echo "-> Copying Static SPA client build..."
mkdir -p "$DIST_DIR/public"
cp -r /home/sumit/worktrees/prismalens/327-packed-artifact/packages/frontend/dist/client/* "$DIST_DIR/public/"
if [ ! -f "$DIST_DIR/public/index.html" ] && [ -f "$DIST_DIR/public/_shell.html" ]; then
    cp "$DIST_DIR/public/_shell.html" "$DIST_DIR/public/index.html"
fi

# 3. Forked job processor
echo "-> Copying Worker processor..."
mkdir -p "$DIST_DIR/worker"
cp -r /home/sumit/worktrees/prismalens/327-packed-artifact/packages/worker/dist/* "$DIST_DIR/worker/"

# 4. Generated Prisma client
echo "-> Copying Generated Prisma client..."
mkdir -p "$DIST_DIR/prisma/generated"
cp -r /home/sumit/worktrees/prismalens/327-packed-artifact/packages/@prismalens/database/prisma/generated/* "$DIST_DIR/prisma/generated/"

# 5. Migration SQL directories & schema
echo "-> Copying Prisma SQLite migrations & schema..."
mkdir -p "$DIST_DIR/prisma/schema"
cp -r /home/sumit/worktrees/prismalens/327-packed-artifact/packages/@prismalens/database/prisma/sqlite/schema/* "$DIST_DIR/prisma/schema/"

echo "==> Assembly complete. Contents of CLI dist/:"
ls -la "$DIST_DIR"
