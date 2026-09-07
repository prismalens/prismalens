---
"prismalens": patch
---

The CLI session store now lives in `prismalens-cli.db` instead of sharing `prismalens.db` with your incidents and services, and its recovery path refuses to touch a database holding tables it does not own. (#355)

Action: existing `pl` run history in a shared `prismalens.db` is not copied across. The old file is left untouched, and the CLI prints a one-time notice saying how many runs it holds.
