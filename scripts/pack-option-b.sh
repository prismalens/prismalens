#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Sumit Patel

set -euo pipefail

ROOT_DIR="/home/sumit/worktrees/prismalens/327-rerun-option-b"
CLI_DIR="$ROOT_DIR/packages/cli"
DIST_DIR="$CLI_DIR/dist"
NODE_MODULES_DIR="$CLI_DIR/node_modules/@prismalens"

echo "==> Building CLI package..."
(cd "$CLI_DIR" && pnpm exec tsup)

echo "==> Cleaning node_modules/@prismalens/ ..."
rm -rf "$NODE_MODULES_DIR"
mkdir -p "$NODE_MODULES_DIR"

# 1. NestJS API build
echo "-> Copying NestJS API build to dist/api ..."
mkdir -p "$DIST_DIR/api"
cp -r "$ROOT_DIR/packages/api/dist/"* "$DIST_DIR/api/"

# 2. Static SPA build
echo "-> Copying Static SPA build to dist/public ..."
mkdir -p "$DIST_DIR/public"
cp -r "$ROOT_DIR/packages/frontend/dist/client/"* "$DIST_DIR/public/"
if [ ! -f "$DIST_DIR/public/index.html" ] && [ -f "$DIST_DIR/public/_shell.html" ]; then
    cp "$DIST_DIR/public/_shell.html" "$DIST_DIR/public/index.html"
fi

# 3. Built @prismalens/* workspace packages into node_modules/@prismalens/<name> (Option B)
echo "-> Copying built workspace packages to node_modules/@prismalens/ ..."
for pkg_dir in "$ROOT_DIR/packages/@prismalens"/*; do
    if [ -d "$pkg_dir" ]; then
        pkg_name=$(basename "$pkg_dir")
        target_dir="$NODE_MODULES_DIR/$pkg_name"
        mkdir -p "$target_dir"
        
        # Copy package.json and dist
        cp "$pkg_dir/package.json" "$target_dir/"
        if [ -d "$pkg_dir/dist" ]; then
            cp -r "$pkg_dir/dist" "$target_dir/"
        fi
        
        # Special case for database package: needs prisma folder with client & migrations
        if [ "$pkg_name" = "database" ]; then
            mkdir -p "$target_dir/prisma"
            if [ -d "$pkg_dir/prisma/generated" ]; then
                mkdir -p "$target_dir/prisma/generated"
                cp -r "$pkg_dir/prisma/generated/"* "$target_dir/prisma/generated/"
            fi
            if [ -d "$pkg_dir/prisma/sqlite" ]; then
                mkdir -p "$target_dir/prisma/sqlite"
                cp -r "$pkg_dir/prisma/sqlite/"* "$target_dir/prisma/sqlite/"
            fi
        fi
    fi
done

# 4. Forked job processor as a separate real file on disk
echo "-> Copying worker build to dist/worker ..."
mkdir -p "$DIST_DIR/worker"
cp -r "$ROOT_DIR/packages/worker/dist/"* "$DIST_DIR/worker/"

# 5. Generated Prisma client
echo "-> Copying Prisma client to dist/prisma/generated ..."
mkdir -p "$DIST_DIR/prisma/generated"
cp -r "$ROOT_DIR/packages/@prismalens/database/prisma/generated/"* "$DIST_DIR/prisma/generated/"

# 6. Migration SQL directories
echo "-> Copying Prisma migrations to dist/prisma/schema ..."
mkdir -p "$DIST_DIR/prisma/schema"
cp -r "$ROOT_DIR/packages/@prismalens/database/prisma/sqlite/schema/"* "$DIST_DIR/prisma/schema/"

# Clean any tsbuildinfo / .tsbuildinfo files from artifact (Defect 2)
echo "-> Cleaning any tsbuildinfo files from artifact..."
find "$CLI_DIR/node_modules/@prismalens" "$DIST_DIR" -name "*.tsbuildinfo" -delete 2>/dev/null || true

echo "==> Assembly complete."
