---
"prismalens": patch
---

The API logs a boot warning when `NODE_ENV=production` resolves to non-secure cookies, so a deployment sitting behind a TLS terminator without `PRISMALENS_PUBLIC_URL` (or `PRISMALENS_PROTOCOL=https`) discovers the problem at startup rather than at the next silent logout.

