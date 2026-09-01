---
"prismalens": patch
---

Add unique constraint on `Account(issuer, accountId)` for Better Auth 1.7 compatibility in both SQLite and PostgreSQL lineages (#461).

- **Schema definition:** Added `@@unique([issuer, accountId])` to the `Account` model in both SQLite and PostgreSQL schemas.
- **Additive migration:** Added `20260826180000_account_issuer_account_id_unique` creating the `account_issuer_accountId_key` unique index in both lineages, refusing to migrate and reporting offending rows if duplicate records are detected.
