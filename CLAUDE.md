# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Context: PrismaLens Community Edition
* **Architecture:** Single-tenant, local-first, self-hosted application.
* **Project Scope:** Implicitly scoped to the current local project (Single Project Mode).
* **Data Isolation:** No multi-tenancy. Ignore `tenant_id` or `organization_id` constraints.
* **User Authority:** Single-user environment with full admin access.
* **Execution Environment:** Local Docker/Process. All file paths are relative to the container/host mount.

## Repository Structure

This is a Turborepo monorepo:

```
prismalens/
├── packages/
│   ├── api/                        # NestJS REST API (TypeScript)
│   ├── frontend/                   # Next.js 14 App Router dashboard
│   ├── cli/                        # CLI tool (@prismalens/cli)
│   └── @prismalens/worker-python/  # Python worker with Google ADK agents
└── docker/
    └── images/                     # Docker images (main, worker)
```

## Essential Commands

### Development
```bash
pnpm install                         # Install all Node dependencies
pnpm dev                             # Start all services (turbo)
pnpm dev:api                         # Start NestJS API only
pnpm dev:frontend                    # Start Next.js frontend only
pnpm dev:worker                      # Start Python worker (uv run)

# Python worker dependencies
cd packages/@prismalens/worker-python && uv sync
```

### Building & Testing
```bash
pnpm build                           # Build all packages
pnpm test                            # Run all tests
pnpm lint                            # Lint all packages
pnpm typecheck                       # Type-check all packages
pnpm format                          # Format with Prettier
```

### Package-specific
```bash
# API (NestJS)
cd packages/api
pnpm test                            # Jest tests
pnpm test:e2e                        # E2E tests
pnpm start:dev                       # Watch mode

# Frontend (Next.js)
cd packages/frontend
pnpm dev                             # Dev server
pnpm build                           # Production build

# Python Worker
cd packages/@prismalens/worker-python
uv run pytest                        # Run tests
uv run ruff check .                  # Lint
```

### Database
```bash
pnpm db:migrate                      # Run Prisma migrations
pnpm db:generate                     # Generate Prisma client
pnpm db:studio                       # Open Prisma Studio
```

### Docker
```bash
docker compose up --build            # Community Edition
```

## Architecture Overview

### Service Architecture
- **API (NestJS)**: REST API with BullMQ job queue for async processing
- **Frontend (Next.js)**: React Flow visualization, TanStack Query for data fetching
- **Worker (Python)**: Google ADK agents for multi-agent incident analysis

### Edition Detection
Runtime feature detection via `PRISMALENS_EDITION` environment variable:
- `COMMUNITY` - Synchronous execution, no Redis/queue
- `ENTERPRISE` - Async BullMQ queue, Redis, workers

### Multi-Agent Workflow
```
Alert → Alert Agent → Gatherer Agent → Analyzer Agent → Recommender Agent
       (validation)    (context)        (analysis)      (recommendations)
```

Agents are in `packages/@prismalens/worker-python/agents/`:
- `coordinator.py` - Orchestrates the workflow (Google ADK SequentialAgent)
- `alert/` - Validation and normalization
- `gatherer/` - Context collection (logs, code, metrics)
- `analyzer/` - Root cause analysis
- `recommender/` - Actionable recommendations
- `log_retriever/` - Specialized log collection (sub-agent)

### Key Directories

**API (`packages/api/src/`)**
- `main.ts` - NestJS entry point
- `app.module.ts` - Root module (imports all feature modules)
- `alerts/` - Alert CRUD and processing
- `analysis/` - Analysis job management
- `webhooks/` - Prometheus, generic webhook ingestion
- `recommendations/` - Recommendation endpoints
- `queue/` - BullMQ job queue service
- `prisma/` - Database service

**Frontend (`packages/frontend/src/`)**
- `app/` - Next.js App Router pages
- `components/InvestigationCanvas.tsx` - React Flow DAG visualization
- `lib/api/` - API client with TanStack Query hooks

**Python Worker (`packages/@prismalens/worker-python/`)**
- `agents/` - Google ADK agent implementations
- `tools/` - Agent tools (GitHub, Render, analysis)
- `tools/safe_native/` - Sandboxed file/repo tools
- `config/settings.py` - Pydantic settings

### API Endpoints
```
POST /api/webhooks/prometheus    # AlertManager webhook
POST /api/webhooks/generic       # Generic alert ingestion
POST /api/alerts/analyze         # Trigger analysis
GET  /api/alerts                 # List alerts
GET  /api/recommendations        # Get recommendations
GET  /health                     # Health check
```

### LLM Integration
Uses LiteLLM for BYOK (Bring Your Own Key) - supports Google Gemini, OpenAI, Anthropic, Azure OpenAI. Configure via environment variables in `.env`.
