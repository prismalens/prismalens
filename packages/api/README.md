# @prismalens/api

The in-development NestJS REST API server for PrismaLens. This package is currently `private: true` and not part of the CLI release.

## Running locally

```bash
pnpm dev:api
```

## Single-tenant startup invariant

PrismaLens is single-tenant (ADR-0011 §6): one organization, multi-user inside it. At startup
the API asserts the database contains at most one organization and **refuses to boot** if it
finds more. If startup aborts with the single-tenant error, reduce the database to a single
organization (remove the extras and their memberships) and restart.

## Webhook intake

PrismaLens provides endpoints to receive incoming alert and deployment webhooks:

- `POST /webhooks/generic` — Receive generic alert webhooks
- `POST /webhooks/prometheus` — Receive Prometheus AlertManager webhooks
- `POST /webhooks/render` — Receive Render deploy/health webhooks

### Signature Verification

- **Generic & Prometheus webhooks**: Configured via `PRISMALENS_WEBHOOK_SECRET`. When set, incoming webhooks must include a valid `X-Hub-Signature-256` header (HMAC-SHA256).
- **Render webhooks**: Configured via `PRISMALENS_RENDER_WEBHOOK_SECRET`. When set, incoming Render webhooks must include valid Standard Webhook signature headers (`webhook-signature`, `webhook-id`, `webhook-timestamp`, falling back defensively to `svix-signature`, `svix-id`, `svix-timestamp`). Missing or invalid signatures result in HTTP 403 / rejection.
  *Note: The exact header names Render sends in production (`webhook-*` vs `svix-*`) should be confirmed against a live delivery before relying on this in production.*

### Idempotency (`X-Idempotency-Key`)

Webhook endpoints accept an optional `X-Idempotency-Key` header. When provided:
- The key is persisted with the raw event record.
- Retried webhook deliveries matching a previously processed idempotency key return the cached alert and incident response without creating duplicate `Event` or `Alert` records or re-running correlation.
- Idempotency keys do not expire.

## License

Apache-2.0
