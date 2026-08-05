---
"prismalens": minor
---

Ship a migration runner and retire the squash-`init` policy (SQLite app-data).

The app now applies pending database migrations **programmatically at start**,
from SQL packed inside the installed artifact — no `prisma` CLI, no `pnpm`, no
schema source, none of which exist on a machine that ran `npm i -g prismalens`.
A current database is a no-op; a partially-migrated one advances in place.

Applying and recording are one `BEGIN IMMEDIATE` transaction, so concurrent or
repeated runs converge and a crash mid-apply leaves nothing half-done. An
existing populated database is backed up (`prismalens.db.bak-<epoch-ms>`) before
any write, and a database whose history this build cannot account for — a
downgrade, or an edited/squashed migration — is a hard stop with instructions
rather than a partial apply.

Migration history is **append-only from here on**. The development-phase rule
that said to squash `init` and delete `prismalens.db` is removed from the repo's
own instructions: following it once an installed database exists in the wild is
data loss.
