# TODO: Deferred Improvements

This file tracks technical debt and improvements that are deferred for later implementation.

## Security

### Webhook Signature Verification
- [x] **GitHub HMAC SHA256** - Verify `x-hub-signature-256` header
- [ ] **Render webhook signature** - Verify Render's signature header
- **Status**: GitHub done (WebhookSignatureGuard), Render pending
- **Priority**: HIGH before production

### Rate Limiting
- [ ] Configure @nestjs/throttler middleware on webhook endpoints (`/webhooks/*`)
- [ ] Consider per-IP rate limiting for public endpoints
- **Status**: @nestjs/throttler installed but not configured on endpoints
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
- [ ] Use oRPC/Zod schemas for validation (project uses oRPC, not class-validator)
- **Priority**: LOW

## Schema

### SQLite Incident Number Sequence
- [ ] Implement proper locking for concurrent incident creation in SQLite
- [ ] Currently relies on application-level management (no autoincrement)
- **Priority**: LOW (SQLite is dev-only, PostgreSQL has autoincrement)

## Environment Variable Management

### Varlock / @env-spec Integration
- [ ] Add `.env.schema` with @env-spec decorators for all env vars (encryption keys, API keys, DB URLs, LLM provider keys)
- [ ] Integrate `@varlock/vite-integration` for frontend (TanStack Start uses Vite)
- [ ] Use `varlock run` wrapper for API startup (no native NestJS plugin exists)
- [ ] Add `varlock load` check to CI for validation
- **Why**: Env vars fail silently when missing (especially PRISMALENS_ENCRYPTION_KEY, PEM paths). Varlock validates at startup, provides type-safe access, and redacts sensitive values from logs.
- **Ref**: [varlock.dev](https://varlock.dev), [GitHub](https://github.com/dmno-dev/varlock)
- **Priority**: MEDIUM

## Real-time Features
- [ ] Add SSE or WebSocket support for real-time updates
  - Real-time alert notifications
  - Investigation status updates
- **Priority**: MEDIUM

## Deployment & Distribution
- [ ] Plan Docker image packaging for API, UI, and worker
- [ ] Create Kubernetes manifests (Ingress, Services, ConfigMap, Secrets)
- **Priority**: LOW (dev phase)

---

## Design Questions (Open)

- Need to look into the logic of grouping alerts into incidents. Who groups the alerts? AI preferred
- When should an investigation be initiated
- What happens if an alert comes in when an incident is under investigation. Added to incident manually or automatically by AI
- What happens if an alert is removed from the incident by a user
- What happens when an alert comes in after an investigation is done. Was the investigation successful, were the recommendations applied or rejected

---

Last updated: 2026-03-14 (YYYY-MM-DD)
