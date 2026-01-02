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

Last updated: 2026-01-01
