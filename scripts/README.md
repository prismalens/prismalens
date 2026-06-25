# scripts/

Operational and developer helper scripts, grouped by audience.

```
scripts/
  dev/    # local developer helpers — seeding demo data, resetting the dev DB.
          # NEVER run against a shared/production environment.
  repo/   # repo / CI / ops automation (GitHub settings, governance).
```

Database-package-internal tooling (migrations, init) lives with the package it
serves: `packages/@prismalens/database/scripts/`.

## Conventions for new scripts

- **Location** — local dev helper → `scripts/dev/`; repo/ops automation → `scripts/repo/`.
- **Language by what it touches** — talks to the DB directly → `.mjs` that imports
  `prisma` from `packages/@prismalens/database/dist/client.js` and runs under plain `node`
  (build the database package first). Drives the running API → `.sh` (curl + cookie auth).
- **Naming** — `<verb>-<noun>` (`seed-*`, `reset-*`, `sync-*`); avoid milestone/temporary names.
- **Header** — top comment states purpose, prerequisites, and a usage line.
- **Idempotency** — re-runnable, or the side effect is documented.
- **Discoverability** — surface common ones as root `package.json` scripts (below) so the
  path and prerequisites aren't tribal knowledge.

## dev/

| Script | `pnpm` | What | Prerequisites |
|---|---|---|---|
| `seed-demo-investigation.mjs` | `pnpm seed:demo` | Demo incident + pending investigation; sets Google as active LLM provider. Idempotent. | DB built (`pnpm build`); key via `GOOGLE_API_KEY` at API runtime |
| `seed-default-user.sh` | `pnpm seed:user` | Creates the dev admin (`admin@prismalens.dev` / `admin123`) via the setup API. | API running on :3001 |
| `seed-dev-integrations.sh` | `pnpm seed:integrations` | Seeds dev integrations (GitHub App, Render, Vercel) via the API. | API on :3001, dev user, `.env.seed` |
| `reset-auth-db.mjs` | `pnpm reset:auth` | Clears auth tables (user/session/account/verification). | DB built |

## repo/

| Script | `pnpm` | What | Prerequisites |
|---|---|---|---|
| `sync-repo-governance.sh` | `pnpm repo:governance` | Applies `.github/governance.json` (settings, labels, branch ruleset) via `gh api`. Idempotent. `--dry-run` supported. | `gh` authed with admin on the repo |
