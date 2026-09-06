---
"prismalens": minor
---

Service → local checkout mapping: investigations now run against your actual repo.

A service can be pointed at a checkout on the machine running the worker
(**Service detail → Repositories → Local checkout**), and the investigation's working
directory is resolved from it per run — the incident's service first, then the firing
alert's `service`/`namespace`/`job` label by exact name. `PRISMALENS_INVESTIGATION_CWD`
is demoted from the primary mechanism to the unmapped escape hatch, and an unmapped run
now says so in the worker log and on the incident timeline instead of silently reading
whatever directory the worker happened to start in.

Paths are validated server-side before they are stored — a path that does not exist, is
a file, or is not inside a git work tree is refused at configuration time with the
reason. The validation and the resolution order live in `@prismalens/config` alongside
the CLI's `resolveRepoPath`, so `pl listen` and the app cannot drift apart; the CLI's
`detect-repo` now delegates to that shared implementation.
