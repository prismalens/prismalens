---
"prismalens": patch
---

Adopt Better Auth 1.7+ by adding the required `issuer` column to the `Account` model and database schema (#456).

- **Schema migration:** Added an additive migration (`20260823073903_account_issuer`) in both SQLite and PostgreSQL lineages adding the `issuer` column to the `account` table, with automatic backfill for existing credential accounts to `local:credential`.
- **Dependency upgrade:** Unpinned `better-auth` in `pnpm-workspace.yaml` catalog from `~1.6.25` to `^1.7.1`.
