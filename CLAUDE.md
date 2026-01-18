# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Context: PrismaLens Community Edition
* **Architecture:** Single-tenant, local-first, self-hosted application.
* **Data Isolation:** No multi-tenancy. Ignore `tenant_id` or `organization_id` constraints.
* **Execution Environment:** Local Docker/Process or direct Node.js.

## Repository Structure

Turborepo monorepo with separate frontend and API:

```
prismalens/
├── packages/
│   ├── api/                     # NestJS API (port 3001)
│   ├── frontend/                # TanStack Start SSR (port 3000)
│   ├── @prismalens/agents/      # Langchain agents for incident management
│   ├── @prismalens/config/      # Shared env config (Zod schemas)
│   ├── @prismalens/contracts/   # Shared oRPC contracts
│   ├── @prismalens/database/    # Prisma schema & client
│   ├── worker/                  # Bullmq worker for running agents in Queue mode
│   └── prismalens/              # CLI package
├── docker/
│   ├── caddy/                   # Caddyfile configs (local, ssl, selfsigned)
│   └── images/                  # Dockerfiles (api, frontend, worker)
└── examples/docker/             # Example docker-compose files
```

## Development

```bash
# Start services (no Docker needed for dev)
pnpm dev:frontend    # http://localhost:3000 (Vite proxies /api to :3001)
pnpm dev:api         # http://localhost:3001

# Other commands
pnpm build           # Build all packages
pnpm typecheck       # Type-check all packages
pnpm lint            # Lint all packages
pnpm db:migrate      # Run Prisma migrations
pnpm db:studio       # Open Prisma Studio
```

## Architecture

```
Production:  User → Caddy (:5367) → /api/* → API (:3001)
                                 → /*     → Frontend (:3000)

Development: User → Frontend (:3000) → Vite proxy /api → API (:3001)
```

- **Frontend**: TanStack Start (SSR), TanStack Query, oRPC client, shadcn/ui
- **API**: NestJS, oRPC, Prisma ORM, BullMQ (optional)
- **Config**: `@prismalens/config` - Zod schemas for all env vars

## Key Environment Variables

Defined in `packages/@prismalens/config/src/schemas/`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRISMALENS_PORT` | 3001 | API server port |
| `PRISMALENS_HOST` | 0.0.0.0 | API bind address |
| `PRISMALENS_PUBLIC_URL` | - | Public URL for OAuth/emails |
| `PRISMALENS_WEBHOOK_URL` | - | External webhook callback URL |
| `DOMAIN` | - | SSL domain (Caddy Let's Encrypt) |
| `DATABASE_URL` | file:./prismalens.db | Database connection |

## API Endpoints

```
POST /api/webhooks/prometheus    # AlertManager webhook
POST /api/webhooks/generic       # Generic alert ingestion
GET  /api/alerts                 # List alerts
GET  /api/incidents              # List incidents
GET  /health                     # Health check
```

## Multi-Agent Workflow (Python)

```
Alert → Alert Agent → Gatherer → Analyzer → Recommender
```

Located in `packages/@prismalens/worker-python/agents/`.

## Frontend Development Guidelines

### API Calls - Use oRPC (Required)

**Never use raw `fetch()` for API calls.** Always use oRPC hooks from `@/lib/api/hooks/`:

```typescript
// ✅ Correct - Use oRPC hooks
import { useAlerts, useCreateAlert } from "@/lib/api/hooks";
const { data: alerts } = useAlerts({ status: "open" });
const createMutation = useCreateAlert();

// ❌ Wrong - Raw fetch
const response = await fetch("/api/alerts");
```

**Pattern for new API endpoints:**
1. Create contract in `@prismalens/contracts/src/contracts/`
2. Add to combined contract in `contracts/index.ts`
3. Implement in API with `@Implement(contract)` decorator
4. Create hooks in `frontend/src/lib/api/hooks/`

### Component Architecture

**Use existing components** - Check `/packages/frontend/src/components/` before creating inline implementations:
- `components/setup/` - Setup wizard steps
- `components/settings/` - Settings page sections
- `components/dashboard/` - Dashboard widgets (StatCard, etc.)
- `components/shared/` - Reusable utilities (EmptyState, LoadingSpinner, SeverityBadge, etc.)

**Route files should be thin** - Routes compose components, not implement UI logic. A route should typically be <100 lines.
