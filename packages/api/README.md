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

## Network exposure and the Host/Origin allowlist

The API serves the SPA and the API from one origin (ADR-0029), so its network posture is
the whole app's network posture. Three things control it, and they compose in this order.

**1. What it binds to — `PRISMALENS_HOST`, default `127.0.0.1`.** Loopback: reachable only
from the machine it runs on. A non-loopback bind (`0.0.0.0`, a LAN address) is a supported
opt-in and puts the app on the network; the server logs a warning at startup when you take
it, because a default-open bind is how comparable local-first tools ended up
internet-exposed at scale.

**2. What hostnames it answers to — `PRISMALENS_ALLOWED_HOSTS`, default: loopback only.**
Every request's `Host` header — and its `Origin` header, when it has one — must name an
allowlisted hostname, or it is rejected with `403`. This is the DNS-rebinding defence: a
page on `attacker.example` whose DNS has been rebound to `127.0.0.1` is *same-origin* to
the browser, so no CORS check runs on it, but it still sends `Host: attacker.example`.
Without this check that page could drive the `@Public()` routes — login, session, and
during the pre-setup window, owner creation.

The effective allowlist is:

| Source | Always present? |
| --- | --- |
| `localhost` | yes — the local operator is the `pl up` user |
| any **IP literal** (`192.168.1.5`, `::1`) | yes — DNS rebinding cannot make a browser send a raw IP as `Host`, so allowing them is free of rebinding risk and makes a LAN bind work unconfigured |
| `PRISMALENS_ALLOWED_HOSTS` entries (comma-separated) | when set |
| the hostname of `PRISMALENS_PUBLIC_URL` | when set |
| `PRISMALENS_DOMAIN` | when set |
| the hostnames of `PRISMALENS_CORS_ORIGIN` | when set — an origin you granted CORS to must survive this check, or the grant would be `403`'d before CORS ever ran |

Matching is on **hostname only** — the port is ignored, because DNS controls names and not
ports, and ignoring it keeps `--port` overrides and the dev Vite proxy working with no
configuration. Subdomains are *not* implied: `app.example.com` does not admit
`evil.app.example.com`. Setting `PRISMALENS_ALLOWED_HOSTS=*` disables the check entirely
and logs a warning — reach for a hostname list first.

The opaque `Origin: null` — what a sandboxed iframe or a `file://` page sends — is rejected
like any other non-allowlisted origin. Nothing legitimate in a single-origin app produces it.

Webhook routes are exempt from the **`Origin`** half of the check while
`PRISMALENS_CORS_WEBHOOK_OPEN` is on, since they are deliberately callable from
browser-based testing tools and authenticate with signatures rather than cookies. Their
`Host` is still checked.

**3. Cross-origin access — `PRISMALENS_CORS_ORIGIN`, default: off.** Under single-origin
serving the browser never makes a cross-origin call to these routes (in dev the Vite server
proxies `/api` rather than fetching it), so no CORS grant is issued unless you ask for one.
`PRISMALENS_CORS_ORIGIN="*"` is refused at boot — a wildcard with credentials is a
vulnerability, not a configuration.

### Worked example

Verified against a locally booted API (`PRISMALENS_PORT=4099`, nothing else configured):

```console
$ # 1. The unconfigured default: loopback answers, with the hardening headers.
$ curl -sS -i -H 'Host: localhost:4099' http://127.0.0.1:4099/health
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self';base-uri 'self';font-src 'self' data:;
  form-action 'self';frame-ancestors 'none';img-src 'self' data: blob:;object-src 'none';
  script-src 'self' 'unsafe-inline';script-src-attr 'none';style-src 'self' 'unsafe-inline';
  connect-src 'self';worker-src 'self' blob:;manifest-src 'self';frame-src 'none'
Cross-Origin-Opener-Policy: same-origin
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY

$ # 2. A LAN IP works without configuration — rebinding can't produce a raw-IP Host.
$ curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: 192.168.1.5:4099' \
    http://127.0.0.1:4099/health
200

$ # 3. A rebound hostname is refused, including on the pre-setup route.
$ curl -sS -H 'Host: rebound.attacker.test' http://127.0.0.1:4099/api/setup
{"statusCode":403,"error":"Forbidden","message":"Blocked request: Host header
 \"rebound.attacker.test\" is not allowlisted. If this hostname is how you reach
 PrismaLens, add it to PRISMALENS_ALLOWED_HOSTS (comma-separated)."}

$ # 4. An acceptable Host does not rescue a hostile Origin.
$ curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: localhost:4099' \
    -H 'Origin: https://evil.example' http://127.0.0.1:4099/health
403
```

And the same server booted for a LAN, with one hostname configured:

```console
$ PRISMALENS_HOST=0.0.0.0 PRISMALENS_ALLOWED_HOSTS=prismalens.internal node dist/src/main.js
... "level":"warn","context":"Bootstrap","msg":"Binding to 0.0.0.0 — PrismaLens is
    reachable from the network, not just this machine. Make sure it sits behind a trusted
    network boundary, and list the hostnames you reach it by in PRISMALENS_ALLOWED_HOSTS."
... "level":"info","context":"Bootstrap","msg":"CORS disabled (single-origin serving).
    Set PRISMALENS_CORS_ORIGIN to allow a specific external origin."

$ curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: prismalens.internal' \
    http://127.0.0.1:4100/health
200
$ curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: localhost:4100' \
    http://127.0.0.1:4100/health   # loopback is never dropped
200
```

### Security headers

`helmet` runs ahead of the allowlist so its headers land on rejections too. Two CSP
relaxations are deliberate and documented in `src/middlewares/helmet.middleware.ts`:

- **`script-src 'unsafe-inline'`** (and `style-src`) — TanStack's `<Scripts />` emits inline
  hydration scripts and the theme pre-paint script is inline by design. A nonce is not
  available: Nest serves the SPA as *static files*, so there is no per-request template pass
  to stamp one into.
- **no `upgrade-insecure-requests`** — helmet adds it by default; on the plain-HTTP
  localhost origin `pl up` serves, it rewrites same-origin subresource requests to `https://`
  and the page fails to load.

Everything else is `'self'`: no external origin can supply script, style, font, image or
connection target. Framing is refused twice over — `frame-ancestors 'none'` plus
`X-Frame-Options: DENY`, overriding helmet's `SAMEORIGIN` default so browsers that only
honour the legacy header agree with the CSP. HSTS is emitted only when this process
terminates TLS itself (`PRISMALENS_PROTOCOL=https`).

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
