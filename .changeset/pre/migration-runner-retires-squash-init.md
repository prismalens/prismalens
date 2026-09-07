---
"prismalens": minor
---

`pl up` now applies database migrations itself at start, from SQL inside the installed package. A current database is left alone, a partial one advances in place, and a backup is taken before any write. Migration history is append-only from here on. (#335)

Action: a database created before 0.5.0-rc.0 stops with `checksum-mismatch` on first boot. The message prints the repair. Do not delete `prismalens.db`.
