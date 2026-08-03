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

- `POST /api/webhooks/generic` — Receive generic alert webhooks
- `POST /api/webhooks/prometheus` — Receive Prometheus AlertManager webhooks
- `POST /api/webhooks/render` — Receive Render deploy/health webhooks

All controller routes carry the global `/api` prefix, so the paths above are the
runtime paths a sender must post to.

> **Not to be confused with `prismalens listen`.** The `prismalens` CLI serves its
> own local Alertmanager receiver at `/webhooks/alertmanager`, authenticated with a
> bearer token (`listen.token`). That is a separate product surface with a separate
> route and auth scheme; the API server does not expose `/webhooks/alertmanager`.

### Raw-body capture

The app boots with `bodyParser: false` so oRPC can read request streams itself.
Signature verification, however, must hash the exact bytes the sender signed — a
`JSON.parse` → `JSON.stringify` round trip changes whitespace and key order and
never matches. `WebhookRawBodyMiddleware` therefore runs on webhook routes only,
stashing the raw buffer on `req.rawBody` before parsing. A webhook request that
reaches a signature guard without `rawBody` is **rejected**, never verified
against a reconstruction.

### Signature Verification

- **Generic & Prometheus webhooks**: Configured via `PRISMALENS_WEBHOOK_SECRET`. When set, incoming webhooks must include a valid `X-Hub-Signature-256` header (HMAC-SHA256 over the raw request bytes).
- **Render webhooks**: Configured via `PRISMALENS_RENDER_WEBHOOK_SECRET`. When set, incoming Render webhooks must include valid Standard Webhook signature headers (`webhook-signature`, `webhook-id`, `webhook-timestamp`, falling back defensively to `svix-signature`, `svix-id`, `svix-timestamp`). Missing or invalid signatures result in HTTP 403.
  The secret is validated at config parse time: base64, optionally carrying the `whsec_` prefix Render displays in its dashboard.
  *Note: The exact header names Render sends in production (`webhook-*` vs `svix-*`) should be confirmed against a live delivery.*

### Idempotency (`X-Idempotency-Key`)

Webhook endpoints accept an optional `X-Idempotency-Key` header. When provided:

- The key is persisted with the raw event record under a unique constraint.
- Retried deliveries matching a previously processed key return the cached alert and incident response without creating duplicate `Event` or `Alert` records or re-running correlation.
- **Batches derive one key per alert.** A Prometheus delivery carries a single header for the whole batch, so each alert is stored under `<key>:<fingerprint>` (falling back to `<key>:<index>`). Reusing the delivery key verbatim would make alerts 2..n replay alert 1 and report duplicate `alertIds`.
- **Concurrent duplicates get HTTP 409.** If two deliveries of the same key race, the loser of the unique-constraint insert (Prisma `P2002`) defers to the winner: it returns the winner's cached result once available, or `409 CONFLICT` while the winner is still mid-flight, so the sender simply retries.
- **Abandoned deliveries resume.** If an event was created but never linked to an alert — a prior attempt died between the two writes — a retry more than 30 seconds later resumes processing on that same event rather than blocking the delivery forever.
- Idempotency keys do not expire.

### Worked example

Verified against a locally booted API (`PRISMALENS_RENDER_WEBHOOK_SECRET` set).
Signatures are computed over the exact request bytes with `svix`:

```console
$ # 1. Valid Render delivery — signature computed over the raw, non-canonical JSON
$ curl -sS -X POST http://127.0.0.1:4099/api/webhooks/render \
    -H 'content-type: application/json' \
    -H 'webhook-id: msg_1785502389' \
    -H 'webhook-timestamp: 1785502389' \
    -H 'webhook-signature: v1,g0kJKM1w0lPo9x0BvV3rBnl2Z9Xl4pQ7yQ0hZ2mS1cE=' \
    --data-binary @render-delivery.json
HTTP 200
{"alertId":"364d2894-1843-4886-b1bf-b9536f30ed3e",
 "incidentId":"54c7d17d-6f77-4745-a776-8d59d7138a39","isNewIncident":true}

$ # 2. Same signature, one byte of trailing whitespace added to the body
HTTP 403
{"message":"Forbidden resource","error":"Forbidden","statusCode":403}

$ # 3. Replay of (1) with the same X-Idempotency-Key — cached, no new alert
HTTP 200
{"alertId":"364d2894-1843-4886-b1bf-b9536f30ed3e",
 "incidentId":"54c7d17d-6f77-4745-a776-8d59d7138a39","isNewIncident":true}

$ # 4. Prometheus batch: 3 alerts under ONE X-Idempotency-Key -> 3 distinct alerts
HTTP 200
{"received":3,"processed":3,
 "alertIds":["9d4d8e57-e4af-493f-b3f8-fe8b32e4519a",
             "65af10c3-faa7-449b-9eba-6449dd72f7fe",
             "2cdfedd7-b663-49bf-b576-c7676d9739a6"]}

$ # 5. Replay of (4) returns the same three ids — idempotent per alert
HTTP 200
{"received":3,"processed":3,
 "alertIds":["9d4d8e57-e4af-493f-b3f8-fe8b32e4519a",
             "65af10c3-faa7-449b-9eba-6449dd72f7fe",
             "2cdfedd7-b663-49bf-b576-c7676d9739a6"]}
```

## Pagination Metadata

`GET /api/alerts`, `GET /api/incidents` and `GET /api/investigations` return a
paginated response envelope:

```json
{
  "data": [ ... ],
  "pagination": {
    "total": 120,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

Fields:
- `total`: Total number of matching items in the database for the given filters.
- `limit`: Page size requested/applied.
- `offset`: Starting index of items in the page.
- `hasMore`: `true` if additional matching items exist past `offset + data.length`.

Other list endpoints have not been migrated to this envelope. `GET /api/services`,
`GET /api/deployments` and `GET /api/repositories` still return the older
`{ "data": [ ... ], "total": 120 }` shape.

## License

Apache-2.0
