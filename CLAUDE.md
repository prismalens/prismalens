# CLAUDE.md

## DB migrations: append-only (#335)
0.5.0 is on npm (2026-09-19), so installed databases exist:

* **Never** delete, edit, rename or squash a migration under
  `packages/@prismalens/database/prisma/{sqlite,pg}/schema/`. A schema change is a new additive
  migration (`pnpm db:migrate`), and nobody is told to delete `prismalens.db`. The runner
  hard-stops on an edited history rather than reconcile it.
* The runner refuses a pre-0.5.0 database by name (`pre-release-database`).
* See `CONTRIBUTING.md` → *Database migrations* for the lifecycle and the failure table.

@AGENTS.md
