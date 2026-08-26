# Runtime Topology and Packaging Specification

This document details the current single-process packaging architecture, access model, and storage design for PrismaLens (`pl up`), as established in issue [#237](https://github.com/prismalens/prismalens/issues/237) and **ADR-0029**.

## 1. Single-Process Topology

PrismaLens `pl up` boots the entire application stack in **one Node.js process** on **one port** without requiring external infrastructure components (such as separate Nginx/Caddy reverse proxies, external PostgreSQL/Redis services, or standalone migration CLIs):

- **NestJS API Backend:** Handles REST endpoints (`/api`), oRPC services (`/orpc`), health checks (`/health`), and OpenAPI documentation (`/api/docs`) ([`packages/api/src/main.ts:118-244`](../packages/api/src/main.ts#L118-L244)).
- **Single-Origin SPA Serving:** Employs `@nestjs/serve-static` ([`packages/api/src/app.module.ts:48-57`](../packages/api/src/app.module.ts#L48-L57)) to serve the compiled frontend dashboard from the same process and port, excluding `/api`, `/orpc`, and `/health` prefixes.
- **In-Process Worker & Investigation Execution:** Imports the API entrypoint in-process ([`packages/cli/src/cli/up.ts:66-126`](../packages/cli/src/cli/up.ts#L66-L126)). The API process manages background work and forks investigation child processes on demand using `@prismalens/worker` resolved inside the installed package.
- **Embedded SQLite Store:** Uses `better-sqlite3` with auto-applied migrations executed before NestJS boots ([`packages/api/src/main.ts:62-83`](../packages/api/src/main.ts#L62-L83)).

### Terminal Boot Output

When `pl up` starts, it outputs log messages showing workspace resolution, migration state, CORS configuration, and endpoint URLs ([`packages/cli/src/cli/up.ts:118-119`](../packages/cli/src/cli/up.ts#L118-L119), [`packages/api/src/main.ts:247-252`](../packages/api/src/main.ts#L247-L252)):

```text
$ pl up
[info] Workspace: /home/user/.prismalens
[info] Dashboard: /usr/local/lib/node_modules/prismalens/node_modules/@prismalens/api/public
[info] [Bootstrap] Database migrated: 20260701000000_init
[info] [Bootstrap] CORS disabled (single-origin serving). Set PRISMALENS_CORS_ORIGIN to allow a specific external origin.
[info] [Bootstrap] PrismaLens API running on http://127.0.0.1:3001
[info] [Bootstrap] Health check: http://127.0.0.1:3001/health
[info] [Bootstrap] API endpoints: http://127.0.0.1:3001/api
[info] [Bootstrap] API documentation: http://127.0.0.1:3001/api/docs
```

---

## 2. Placements and Access Model

PrismaLens supports two primary operational placements:

| Placement | Default Bind | Who Can Reach It | Auth Posture | Primary Use Case |
| --- | --- | --- | --- | --- |
| **Laptop / Workstation** | `127.0.0.1` (`localhost`) | Local machine user only | Single-user setup (`POST /api/setup`), session cookies. Host allowlist defaults to `localhost`. | Local ad-hoc investigation, developer workstation, single-user operation. |
| **VM / Server / Container** | `--host 0.0.0.0` (explicit opt-in) | Network / team members on accessible host & port | Session cookies, DNS-rebinding protection (`PRISMALENS_ALLOWED_HOSTS`). Multi-user RBAC is not yet implemented. Put behind trusted network boundary / TLS. | Shared team deployment, internal staging server, container infrastructure. |

### Bind & Host Allowlist Expectations

- **Loopback Default:** By default, `pl up` binds to `127.0.0.1` (or `PRISMALENS_HOST`/`--host` default `localhost`) on port `3001` ([`packages/cli/src/cli/up.ts:73-86`](../packages/cli/src/cli/up.ts#L73-L86), [`packages/api/src/main.ts:230-231`](../packages/api/src/main.ts#L230-L231)).
- **Non-Loopback Opt-In:** Binding to non-loopback host addresses (such as `0.0.0.0` or a LAN IP) requires explicit opt-in via `--host` or `PRISMALENS_HOST`. When detected, a security warning is logged ([`packages/api/src/main.ts:236-242`](../packages/api/src/main.ts#L236-L242)):
  ```text
  [warn] [Bootstrap] Binding to 0.0.0.0 — PrismaLens is reachable from the network, not just this machine. Make sure it sits behind a trusted network boundary, and list the hostnames you reach it by in PRISMALENS_ALLOWED_HOSTS.
  ```
- **DNS-Rebinding Protection:** The Host/Origin allowlist middleware ([`packages/api/src/middlewares/host-allowlist.middleware.ts:28-36`](../packages/api/src/middlewares/host-allowlist.middleware.ts#L28-L36)) intercepts requests before NestJS guards or routing to reject non-allowlisted `Host` or `Origin` headers with a `403 Forbidden`. IP literals are permitted by default, while custom hostnames must be explicitly set via `PRISMALENS_ALLOWED_HOSTS`.
- **Authentication & RBAC Posture:** First-run setup initializes the primary owner account (`POST /api/setup`), and session cookies authenticate subsequent requests. Fine-grained multi-user RBAC (role-based access control) is **not yet implemented** (deferred under ADR-0011 §6).

---

## 3. Storage Architecture: Embedded SQLite & Zero Infra

PrismaLens eliminates external database dependencies by storing all state in an embedded SQLite database managed via `better-sqlite3`:

- **Workspace Knob:** The database location is resolved solely via the application workspace directory (`~/.prismalens` or `PRISMALENS_WORKSPACE_DIR`). `PRISMALENS_DB_URL` and `DATABASE_URL` are both ignored for path resolution — the workspace dir is the only knob ([`packages/cli/src/cli/up.ts:97-107`](../packages/cli/src/cli/up.ts#L97-L107)). (`DATABASE_URL` is separately read by the auth layer to detect Postgres — [`packages/api/src/core/auth/auth.service.ts:56`](../packages/api/src/core/auth/auth.service.ts#L56) — unrelated to path resolution.)
- **Programmatic Migrations:** Pending SQL migrations are applied programmatically before NestJS completes initialization using `@prismalens/database/migrator` ([`packages/api/src/main.ts:48-83`](../packages/api/src/main.ts#L48-L83)).
- **Self-Contained SQL Migration Files:** Migration SQL scripts travel inside the published npm package tarball under `@prismalens/database/dist/prisma/sqlite/schema/` (staged by `scripts/pack-cli.mjs`).

---

## 4. Known Limitations & Failure Modes

- **Port Collisions (`EADDRINUSE`):** Attempting to run `pl up` on a port already bound by another process currently results in an unhandled Node.js exception stack trace rather than a graceful error message. A fix is currently in flight on branch `r1/237-eaddrinuse-handling` and is **not yet landed** on `main`.
- **Single-Tenant Operating Boundary:** Multi-user isolation and fine-grained permissions/roles are **not yet implemented** (ADR-0011 §6).
- **Single-API-Replica Constraint (In-Process EventBus):** The PrismaLens API service must run as a **single replica** (operator deployment guidance; multi-instance deployment is unsupported). The dispatch layer's `EventBus` ([`packages/api/src/infrastructure/dispatch/event-bus.ts:71-129`](../packages/api/src/infrastructure/dispatch/event-bus.ts#L71-L129)) is an in-process `Map` of handler sets with no cross-process transport. Running multiple API replicas silently breaks event relay and cancellation:
  1. **Live SSE Stream Disconnection:**
     - **False Clean Completion (Enqueuing Replica):** When `POST /investigations` lands on Replica A, `StreamRelayService.attach()` is called at enqueue time ([`packages/api/src/infrastructure/dispatch/dispatch.service.ts:158-160`](../packages/api/src/infrastructure/dispatch/dispatch.service.ts#L158-L160)), initializing an `ACTIVE` empty buffer ([`packages/api/src/modules/investigations/stream-relay.service.ts:167-198`](../packages/api/src/modules/investigations/stream-relay.service.ts#L167-L198)). When Replica B claims and executes the job ([`packages/api/src/infrastructure/dispatch/dispatcher.ts:227-235`](../packages/api/src/infrastructure/dispatch/dispatcher.ts#L227-L235)), an SSE client connecting to Replica A (`GET /api/investigations/:id/stream`) attaches to Replica A's stalled `ACTIVE` buffer ([`packages/api/src/modules/investigations/stream-relay.service.ts:310-324`](../packages/api/src/modules/investigations/stream-relay.service.ts#L310-L324)). After `MAX_IDLE_BUFFER_MS` (10 minutes, [`packages/api/src/modules/investigations/stream-relay.service.ts:28`](../packages/api/src/modules/investigations/stream-relay.service.ts#L28)), `sweepStaleBuffers()` ([`packages/api/src/modules/investigations/stream-relay.service.ts:370-381`](../packages/api/src/modules/investigations/stream-relay.service.ts#L370-L381)) invokes `complete()`, sending a clean `{ type: "done" }` marker ([`packages/api/src/modules/investigations/investigation-stream.controller.ts:74-78`](../packages/api/src/modules/investigations/investigation-stream.controller.ts#L74-L78)) — wire-identical to a genuine `FINISHED` run. The client permanently marks a still-running investigation completed (the #388 hazard).
     - **Unclean Disconnection (Non-Participating Replica):** An SSE client connecting to Replica C (which neither enqueued nor claimed the job) finds no buffer (`UNKNOWN` state, [`packages/api/src/modules/investigations/stream-relay.service.ts:301`](../packages/api/src/modules/investigations/stream-relay.service.ts#L301)), receives zero frames, and closes cleanly without a `done` marker ([`packages/api/src/modules/investigations/investigation-stream.controller.ts:79-91`](../packages/api/src/modules/investigations/investigation-stream.controller.ts#L79-L91)), causing the client's `EventSource` to trigger `onerror` and fall back to polling.
  2. **Ghost Cancellation & Double Writers:** When a cancellation request (`POST /api/investigations/:id/cancel`) is routed to Replica C ([`packages/api/src/modules/investigations/investigations.controller.ts:158-213`](../packages/api/src/modules/investigations/investigations.controller.ts#L158-L213)), Replica C publishes on its local `EventBus`. Because the running job's cancellation handler is registered on Replica B ([`packages/api/src/infrastructure/dispatch/dispatcher.ts:258-264`](../packages/api/src/infrastructure/dispatch/dispatcher.ts#L258-L264)), Replica C observes zero receivers. Replica C concludes the run is orphaned, marks the job cancelled in the database, and overrides the investigation state while Replica B continues executing the investigation — creating double writers and corrupting terminal state.

  #### Worked Example: Multi-Replica Event & Cancel Loss

  ```text
  Load Balancer (Round Robin)
       │
       ├───► [Replica A (API)] — Enqueued Job `inv-1` (attach called at enqueue)
       │        ├── InProcessEventBus (handlers: [])
       │        ├── StreamRelay buffer: ACTIVE (empty, waiting for events on Bus A)
       │        └── Client 1: GET /api/investigations/inv-1/stream
       │               └── Listens to Bus A -> 0 events received -> at 10m MAX_IDLE_BUFFER_MS,
       │                   idle sweep fires complete() -> emits clean `done` (FALSE COMPLETION!)
       │
       ├───► [Replica B (API + Dispatch)] — Claimed & Running Job `inv-1`
       │        ├── InProcessEventBus (handlers: [Job Runner])
       │        └── Running Job `inv-1`
       │               ├── Publishes events to Bus B (never received by Replica A or C)
       │               └── Listens for cancel on Bus B
       │
       └───► [Replica C (API)] — Never touched `inv-1`
                ├── InProcessEventBus (handlers: [])
                ├── Client 2: GET /api/investigations/inv-1/stream
                │      └── No buffer (UNKNOWN) -> closes immediately with no `done` (UNCLEAN CLOSE)
                └── User Cancel: POST /api/investigations/inv-1/cancel
                       └── Publishes to Bus C -> 0 receivers heard -> writes DB "cancelled"
                           (Job on Replica B never receives cancel; continues running -> double writers)
  ```

  Multi-replica placements with a distributed transport/driver are tracked in [#340](https://github.com/prismalens/prismalens/issues/340) — "JobStore: Postgres SKIP LOCKED driver + heartbeat/reclaim for multi-replica placements".

---

## 5. Architectural References

- **Issue Reference:** [#237](https://github.com/prismalens/prismalens/issues/237) — Single-process application topology and packaging.
- **Issue Reference:** [#375](https://github.com/prismalens/prismalens/issues/375) — Document the single-API-replica constraint of the in-process EventBus in the deploy docs.
- **Issue Reference:** [#340](https://github.com/prismalens/prismalens/issues/340) — JobStore: Postgres SKIP LOCKED driver + heartbeat/reclaim for multi-replica placements.
- **ADR-0008:** Two-tier agent engine architecture (supervisor Tier-1 + rented harness Tier-2).
- **ADR-0010:** Engine as CLI supervisor.
- **ADR-0011:** Domain model boundaries & multi-user RBAC (fine-grained RBAC marked not yet implemented).
- **ADR-0017:** Tool execution security and guardrails vs boundaries.
- **ADR-0020:** Sandbox isolation boundaries (`srt` / `e2b`).
- **ADR-0022:** Reactive-pull posture (no standing ingestion).
- **ADR-0029:** Single-process topology & single-origin SPA serving.

### Related Documentation

- [`packages/cli/README.md`](../packages/cli/README.md) — CLI overview and `pl up` section.
- [`docs/ui-flows-and-e2e-strategy.md`](ui-flows-and-e2e-strategy.md) — UI flows and test strategy.
- [`docs/engine-hardening-backlog.md`](engine-hardening-backlog.md) — Engine security and hardening roadmap.
- [`docs/capabilities.md`](capabilities.md) — Capability tier specifications.
