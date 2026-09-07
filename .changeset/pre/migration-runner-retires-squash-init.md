---
"prismalens": minor
---

`pl up` now applies database migrations itself at start, from SQL inside the installed package. A current database is left alone, a partial one advances in place, and a backup is taken before any write. Migration history is append-only from here on. (#335)

Action: a database created before `init` was last edited stops with `checksum-mismatch` on first boot. Do not delete it. See CONTRIBUTING.md, *Recovering a database that drifted*.
