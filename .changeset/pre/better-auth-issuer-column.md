---
"prismalens": patch
---

Database schemas now include an `issuer` column on accounts, with existing credential accounts automatically backfilled to `local:credential` on migration. (#456)
