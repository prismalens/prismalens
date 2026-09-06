---
"prismalens": patch
---

Pin `better-auth` to `1.7.2` to prevent missing `issuer` errors during account creation (#580).

- **Dependency pin:** Pinned `better-auth` to `1.7.2` in `pnpm-workspace.yaml` and `scripts/pack-cli.mjs`. Upstream `1.7.3` dropped the required `issuer` column that our schema expects.
- **Error diagnostics:** Log unexpected errors in `SetupController.createOwner` and dump server logs when packed smoke probes fail.
