---
"prismalens": minor
---

`pl status` and `pl report` join the CLI, backed by a new `node:sqlite` record store (#60). Investigation runs, alert groups, events, and reports now persist to a WAL-mode SQLite database in place of the old JSON session files — no new native dependency, since it uses Node's built-in `node:sqlite` (which raises the CLI's Node floor to `>=22.13.0`, checked at startup). `pl status` lists runs and takes an optional `--status` filter; `pl report <id>` prints a stored report, adding the run's event timeline with `--events`. Failed runs now record their error reason instead of dropping it.
