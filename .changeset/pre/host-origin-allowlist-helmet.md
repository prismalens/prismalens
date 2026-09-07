---
"prismalens": patch
---

Server requests now enforce Host and Origin allowlisting to prevent DNS-rebinding attacks, and standard security headers are enabled. The server now binds to `127.0.0.1` by default instead of `0.0.0.0`.

Action: set `PRISMALENS_ALLOWED_HOSTS` or `PRISMALENS_PUBLIC_URL` if accessing PrismaLens through a reverse proxy or domain name.
