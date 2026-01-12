# TODO: Deferred Improvements

This file tracks technical debt and improvements that are deferred for later implementation.

## Security

### Webhook Signature Verification
- [ ] **GitHub HMAC SHA256** - Verify `x-hub-signature-256` header
- [ ] **Render webhook signature** - Verify Render's signature header
- **Why deferred**: Still in dev, webhooks used internally only
- **Priority**: HIGH before production

### Rate Limiting
- [ ] Add rate limiting middleware to webhook endpoints (`/webhooks/*`)
- [ ] Consider per-IP rate limiting for public endpoints
- **Priority**: HIGH before production

## API Improvements

### Pagination Metadata
- [ ] Create common `PaginatedResponse<T>` type with `{ items, total, limit, offset }`
- [ ] Update services to return total counts alongside results
- [ ] Update controller `findAll` endpoints to return paginated response
- **Affected endpoints**:
  - `GET /alerts`
  - `GET /incidents`
  - `GET /investigations`
  - `GET /recommendations`
  - `GET /events`
- **Priority**: MEDIUM

### Idempotency for Webhooks
- [ ] Implement `X-Idempotency-Key` header handling
- [ ] Prevent duplicate alert creation on webhook retry
- **Priority**: MEDIUM

### Query Parameter Validation
- [ ] Add bounds checking for `limit` (max 1000) and `offset` (>= 0)
- [ ] Use `@Transform()` decorators for automatic type conversion
- **Priority**: LOW

## Schema

### SQLite Incident Number Sequence
- [ ] Implement proper locking for concurrent incident creation in SQLite
- [ ] Currently relies on application-level management (no autoincrement)
- **Priority**: LOW (SQLite is dev-only, PostgreSQL has autoincrement)

---

## Developer ides - Rough notes to be analyzed and broken down into todos by AI and moved up
- Use @orpc/tanstack-query in forntend
- Move simple routes from api to frontend repo. Routes that have simple CRUD operations and only get used via the frontend client. Routes should be oRPC complient.
- Moving a few routes to frontend will require breaking of Prisma setup for DB from the api repo and moving it into @prismalens
- Verify the owner setup is working fine, when a user logs in for the first time on a self hosted setup.
- The more we work on this project and the more complex it is getting. At this point I feel getting rid of the CLI and directly distributing docker images would be a better idea. Need to plan how to package API, UI and worker for normal mode. In queue mode we can have worker running in a separate container
-
---

## Post-Architecture Tasks

These tasks are deferred until the core architecture is stable.

### CRUD Migration to TanStack Server Functions
- [ ] Migrate UI CRUD operations to TanStack Server Functions
  - User settings CRUD
  - Dashboard layout preferences
  - Search/filter state persistence

### oRPC Integration
- [ ] Set up oRPC integration between frontend and API
  - Type-safe API calls from frontend
  - Shared contract definitions

### Real-time Features
- [ ] Add WebSocket support through Caddy
  - Real-time alert notifications
  - Investigation status updates

### Kubernetes Deployment
- [ ] Create Kubernetes manifests
  - Ingress resource for path-based routing
  - Service definitions for frontend/api
  - ConfigMap for environment variables
  - Secrets for sensitive data

### Shell Scripts & CLI
- [ ] Refine deploy/install.sh
  - Interactive prompts for domain and LLM key
  - Support for different deployment modes (local, SSL, self-signed)
- [ ] Refine deploy/prismalens.sh wrapper
  - start, stop, logs, upgrade commands
  - Docker Compose management
- [ ] Extend packages/prismalens CLI for Docker deployments
  - `prismalens docker start`
  - `prismalens docker stop`
  - `prismalens docker logs`

Last updated: 2026-01-11(YYYY-MM-DD)
