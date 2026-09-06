---
"prismalens": patch
---

CLI: the session store gets its own file, and the recovery path refuses to touch application data (#355).

- The CLI's SQLite session store now lives at `<workspace>/prismalens-cli.db`. It previously opened `<workspace>/prismalens.db` — the same file `@prismalens/config` hands Prisma for the application database. Because the store's schema-mismatch recovery renames its whole file aside and recreates it, any drift in the CLI's own five tables (`groups`, `runs`, `events`, `reports`, `group_alerts`) would carry a `pl up` user's incidents, investigations, services and postmortems away with it.
- The rename-aside recovery now inspects `sqlite_master` first and refuses, with an error naming the file, the foreign tables and the safe action, if the file holds any table the CLI does not own. The check runs both before the first write and immediately before the rename, so the CLI neither creates its tables inside a database it does not own nor moves one aside.
- Existing CLI run history inside a shared `prismalens.db` is **not** migrated: on a shared file the CLI's `events` table and Prisma's `events` table are the same name, so a copy cannot tell whose rows it is reading. The old file is left byte-for-byte untouched, and the CLI prints a one-time notice saying how many runs are in it and that they were not copied across.

Nothing in `packages/api`, `packages/worker` or `packages/engine` reads the CLI's tables, so the split is behaviour-neutral for the application.
