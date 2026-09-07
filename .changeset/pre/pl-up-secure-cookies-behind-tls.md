---
"prismalens": patch
---

The API now logs a warning at boot if running in production without secure cookies enabled, alerting you if a reverse proxy requires `PRISMALENS_PUBLIC_URL` or `PRISMALENS_PROTOCOL=https` to prevent silent logouts.
