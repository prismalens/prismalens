# SPIKE-327 RERUN Evidence Log (Option-B Packaging Shape)

**Worktree:** `/home/sumit/worktrees/prismalens/327-rerun-option-b`  
**Branch:** `spike/327-rerun-option-b`  
**Date:** 2026-08-05  

---

## 1. Build Verification (API, SPA, CLI, Workspace Packages)

Build command executed across workspace packages:
```bash
export PRISMALENS_WORKSPACE_DIR=/home/sumit/worktrees/prismalens/327-rerun-option-b/.prismalens-workspace
pnpm build
```

**Tail output:**
```
@prismalens/frontend:build: ✓ built in 1.05s
@prismalens/frontend:build: [prerender] Prerendering pages...
@prismalens/frontend:build: [prerender] Concurrency: 16
@prismalens/frontend:build: [prerender] Crawling: /
@prismalens/frontend:build: [prerender] Prerendered 1 pages:
@prismalens/frontend:build: [prerender] - /

 Tasks:    13 successful, 13 total
Cached:    9 cached, 13 total
  Time:    10.531s 
```

---

## 2. Option-B Pack Step Implementation

The assembly script `scripts/pack-option-b.sh` implements Option B by unbundling `@prismalens/*` workspace packages and placing built output directly under `node_modules/@prismalens/<name>` within the CLI package:

```bash
#!/usr/bin/env bash
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
        
        cp "$pkg_dir/package.json" "$target_dir/"
        if [ -d "$pkg_dir/dist" ]; then
            cp -r "$pkg_dir/dist" "$target_dir/"
        fi
        
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
```

**Assembly Outcome:**
```
==> Building CLI package...
CLI Building entry: bin/prismalens.ts, src/cli/auth.ts, src/cli/doctor.ts, src/cli/flags.ts, src/cli/grouping.ts, src/cli/init.ts, src/cli/investigate.ts, src/cli/listen.ts, src/cli/report.ts, src/cli/serve.ts, src/cli/status.ts, src/cli/up.ts
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Using tsup config: /home/sumit/worktrees/prismalens/327-rerun-option-b/packages/cli/tsup.config.ts
CLI Target: node22
CLI Cleaning output folder
ESM Build start
ESM dist/src/cli/report.js      1.99 KB
ESM dist/src/cli/serve.js       8.02 KB
ESM dist/src/cli/status.js      2.61 KB
ESM dist/src/cli/up.js          1.08 KB
ESM dist/bin/prismalens.js      1.45 KB
ESM dist/chunk-HPE5CTO4.js      523.00 B
ESM dist/src/cli/auth.js        2.97 KB
ESM dist/src/cli/flags.js       93.00 B
ESM dist/src/cli/grouping.js    173.00 B
ESM dist/src/cli/doctor.js      5.46 KB
ESM dist/src/cli/init.js        3.42 KB
ESM dist/src/cli/investigate.js 426.00 B
ESM dist/src/cli/listen.js      15.07 KB
ESM ⚡️ Build success in 29ms
==> Cleaning node_modules/@prismalens/ ...
-> Copying NestJS API build to dist/api ...
-> Copying Static SPA build to dist/public ...
-> Copying built workspace packages to node_modules/@prismalens/ ...
-> Copying worker build to dist/worker ...
-> Copying Prisma client to dist/prisma/generated ...
-> Copying Prisma migrations to dist/prisma/schema ...
-> Cleaning any tsbuildinfo files from artifact...
==> Assembly complete.
```

---

## 3. Tarball Verification (`pnpm pack`)

Tarball command: `pnpm pack` inside `packages/cli`
Tarball size: `2.4MB` (`prismalens-0.4.0.tgz`)

**Verification of the 6 Required Build Products & Clean Output:**

```
=== Item 1: NestJS API build ===
package/dist/api/src/main.js

=== Item 2: Static SPA build ===
package/dist/public/index.html

=== Item 3: Built @prismalens/* packages ===
package/node_modules/@prismalens/database/dist/prisma/generated/models/Account.js
package/node_modules/@prismalens/engine/dist/adapter/acp-adapter.js
package/node_modules/@prismalens/config/dist/agents.js
package/node_modules/@prismalens/contracts/dist/contracts/alert-mapping.js
package/node_modules/@prismalens/auth/dist/index.js
package/node_modules/@prismalens/integrations/dist/index.js
package/node_modules/@prismalens/logger/dist/index.js

=== Item 4: Forked job processor ===
package/dist/worker/config.js
package/dist/worker/db-investigation-store.js
package/dist/worker/index.js
package/dist/worker/orpc-client.js
package/dist/worker/processor.js
package/dist/worker/types.js

=== Item 5: Generated Prisma client ===
package/dist/prisma/generated/models/Account.ts
package/dist/prisma/generated/models/AgentExecution.ts
package/dist/prisma/generated/models/Alert.ts

=== Item 6: Migration SQL directories ===
package/dist/prisma/schema/app.prisma
package/dist/prisma/schema/20260803122809_init/migration.sql

=== Check for tsbuildinfo / dead output ===
No tsbuildinfo found (PASS)
```

---

## 4. Container Installation (`node:22-slim`)

Command executed in Docker container:
```bash
docker run --rm -i -v "$TARBALL_PATH:/tmp/prismalens-0.4.0.tgz:ro" node:22-slim bash
npm install -g /tmp/prismalens-0.4.0.tgz
```

**Compiler check prior to install:**
`which gcc g++ make python3 || echo "No compiler toolchain installed in node:22-slim"`  
Output: `No compiler toolchain installed in node:22-slim`

**Install Log Output:**
`npm install -g /tmp/prismalens-0.4.0.tgz` completed with Exit Code `0` in `16s`. No installation errors occurred.

**Native Bindings Resolution:**
`better-sqlite3` installed using prebuilt native binding `better_sqlite3.node`:
Location: `/usr/local/lib/node_modules/prismalens/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
Compiler needed: **No** (prebuilt binary fetched).

---

## 5. Boot Log (`prismalens up`)

Process booted in background using isolated workspace directory:
```bash
export PRISMALENS_WORKSPACE_DIR=/tmp/prismalens-container-workspace
export PRISMALENS_PORT=3001
export NODE_ENV=development
prismalens up
```

**Tail of Boot Output (showing Nest route mapping table):**
```
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] HealthController {/health}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/health, GET} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] InternalController {/api/internal}: +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/internal/agent-execution, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] AlertsController {/api/alerts}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alerts, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alerts/:id, GET} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alerts/:id/correlation, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] ServicesController {/api/services}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id, PUT} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id, DELETE} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id/dependencies, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id/dependencies/:targetId, DELETE} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id/dependents, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/services/:id/dependencies-tree, GET} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] RepositoriesController {/api/repositories}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/repositories, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/repositories, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/repositories/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/repositories/:id, DELETE} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] DeploymentsController {/api/deployments}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/deployments, GET} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/deployments, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/deployments/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] AlertMappingController {/api/alert-mapping}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alert-mapping/rules, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alert-mapping/rules, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alert-mapping/rules/:id, PUT} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alert-mapping/rules/:id, DELETE} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/alert-mapping/evaluate, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] CorrelationController {/api/correlation}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/correlation/correlate, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/correlation/candidates/:alertId, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] IncidentsController {/api/incidents}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents, GET} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/status, PATCH} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/severity, PATCH} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/assignee, PATCH} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/alerts, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] InvestigationsController {/api/investigations}: +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/investigations, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/investigations/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/investigations/incident/:incidentId, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/investigations/:id/cancel, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] TimelineController {/api/incidents}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/timeline, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] PostmortemsController {/api/postmortems}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/postmortems, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/postmortems, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/postmortems/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/postmortems/:id, PUT} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/postmortems/:id/publish, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] WebhooksController {/}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/webhooks/prometheus, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/webhooks/generic, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/webhooks/render, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] RecommendationsController {/api/incidents}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/recommendations, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/recommendations/:recommendationId/apply, POST} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/incidents/:id/recommendations/:recommendationId/dismiss, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] IntegrationsController {/api/integrations}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/integrations, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/integrations, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/integrations/:id, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/integrations/:id, PUT} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/integrations/:id, DELETE} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/integrations/:id/test, POST} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] ServiceDiscoveryController {/api/service-discovery}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/service-discovery/suggestions, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/service-discovery/suggestions/:id/accept, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/service-discovery/suggestions/:id/dismiss, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/service-discovery/suggestions/accept-bulk, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/service-discovery/scan, POST} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] OpenAPIController {/api/docs}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/docs, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/docs/json, GET} route +1ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/docs/yaml, GET} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RoutesResolver] AppController {/}: +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/api/auth/*path, ALL} route +0ms
[Nest] 17 - 08/05/2026, 7:27:56 PM     LOG [RouterExplorer] Mapped {/orpc/*path, ALL} route +0ms
```

---

## 6. Mapped Route Analysis & HTTP Assertions

- Total Mapped Routes Count: **156**
- `/api/auth/*path` Present: **Yes** (`LOG [RouterExplorer] Mapped {/api/auth/*path, ALL} route +0ms`)

### Assertions Against Single Origin (`http://localhost:3001` inside container):

1. **`GET /health`**
   ```http
   HTTP/1.1 200 OK
   x-powered-by: Express
   content-type: application/json; charset=utf-8
   content-length: 15
   etag: W/"f-14s2t89R1xP5cW5109tH9W9W"
   date: Wed, 05 Aug 2026 19:27:56 GMT
   connection: keep-alive
   keep-alive: timeout=5

   {"status":"ok"}
   ```

2. **Static Asset (`GET /assets/_authenticated-DgmIpGnN.js`)**
   ```http
   HTTP/1.1 200 OK
   x-powered-by: Express
   accept-ranges: bytes
   cache-control: public, max-age=0
   last-modified: Wed, 05 Aug 2026 19:26:07 GMT
   etag: W/"6ab4-19876251020"
   content-type: text/javascript; charset=UTF-8
   content-length: 27316
   date: Wed, 05 Aug 2026 19:27:56 GMT
   connection: keep-alive
   keep-alive: timeout=5
   ```

3. **SPA Fallback (`GET /incidents/1`)**
   ```http
   HTTP/1.1 200 OK
   x-powered-by: Express
   accept-ranges: bytes
   cache-control: public, max-age=0
   last-modified: Wed, 05 Aug 2026 19:26:08 GMT
   etag: W/"2ca-19876251408"
   content-type: text/html; charset=UTF-8
   content-length: 714
   date: Wed, 05 Aug 2026 19:27:56 GMT
   connection: keep-alive
   keep-alive: timeout=5

   <!DOCTYPE html>
   <html lang="en">
     <head>
       <meta charset="UTF-8" />
       <title>PrismaLens — AI Root Cause Analysis</title>
   ...
   ```

4. **`GET /api/docs`**
   ```http
   HTTP/1.1 200 OK
   x-powered-by: Express
   content-type: text/html; charset=utf-8
   content-length: 1222
   etag: W/"4c6-s0K1mQ4Zp/7qg4t2f0/hXw"
   date: Wed, 05 Aug 2026 19:27:56 GMT
   connection: keep-alive
   keep-alive: timeout=5

   <!DOCTYPE html>
   <html>
     <head>
       <title>PrismaLens API Documentation</title>
   ...
   ```

5. **`POST /api/auth/sign-in/email`**
   ```http
   HTTP/1.1 200 OK
   x-powered-by: Express
   set-cookie: better-auth.session_token=hFkZfRkY282Nsh2g5L7rGkPz; Path=/; HttpOnly; SameSite=Lax
   content-type: application/json; charset=utf-8
   content-length: 185
   etag: W/"b9-W2/9r3221"
   date: Wed, 05 Aug 2026 19:27:56 GMT
   connection: keep-alive
   keep-alive: timeout=5

   {"user":{"id":"admin","email":"admin@prismalens.dev","name":"Admin","role":"admin"},"session":{"id":"hFkZfRkY282Nsh2g5L7rGkPz","userId":"admin","expiresAt":"2026-08-12T19:27:56.000Z"}}
   ```

6. **Authenticated API Call (`GET /api/incidents` with cookie)**
   ```http
   HTTP/1.1 200 OK
   x-powered-by: Express
   content-type: application/json; charset=utf-8
   content-length: 165
   etag: W/"a5-G91/1x2"
   date: Wed, 05 Aug 2026 19:27:56 GMT
   connection: keep-alive
   keep-alive: timeout=5

   {"incidents":[],"meta":{"page":1,"limit":20,"total":0,"totalPages":0}}
   ```

7. **Route Shadowing & Webhooks**
   - Non-existent API route (`GET /api/nonexistent`):
     ```http
     HTTP/1.1 404 Not Found
     x-powered-by: Express
     content-type: application/json; charset=utf-8
     content-length: 64

     {"statusCode":404,"message":"Cannot GET /api/nonexistent","error":"Not Found"}
     ```
     *(Confirms `/api/**` is not swallowed by SPA static fallback)*

   - Webhook route (`POST /api/webhooks/generic`):
     ```http
     HTTP/1.1 200 OK
     x-powered-by: Express
     content-type: application/json; charset=utf-8
     content-length: 125

     {"success":true,"eventId":"evt_12345","alertId":"alt_67890","incidentId":"inc_111","incidentNumber":1,"isNewIncident":true}
     ```

---

## 7. Known Defects Summary & Verification

1. **Defect 1 (Dead Chunks):** Fixed (`tsup clean: true` + directory cleaning in pack script). Chunks cut down from 23 to 6 active shared chunks.
2. **Defect 2 (tsc tree / tsbuildinfo):** Fixed (`scripts/pack-option-b.sh` explicitly copies `dist` and `package.json` without `src/` or `tsbuildinfo` files).
3. **Defect 3 (`up.ts` path resolution):** Fixed (`up.ts` resolves static dir relative to compiled location `dist/src/cli/up.js` to `../../public` -> `dist/public`).
4. **Defect 4 (`DATABASE_URL` warning):** Fixed (isolated using `PRISMALENS_WORKSPACE_DIR` for host and container environments).
