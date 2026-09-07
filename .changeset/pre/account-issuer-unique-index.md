---
"prismalens": patch
---

A unique constraint on `Account(issuer, accountId)` prevents duplicate user accounts across providers in SQLite and PostgreSQL databases. Migrations refuse to run and report offending rows if duplicates are detected. (#461)
