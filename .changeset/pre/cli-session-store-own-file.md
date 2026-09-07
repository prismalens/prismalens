---
"prismalens": patch
---

The CLI SQLite session store now lives in `prismalens-cli.db` rather than sharing `prismalens.db` with application data. CLI recovery checks reject touching databases containing foreign tables, preventing accidental loss of incidents or services. (#355)
