---
"prismalens": patch
---

Fix a security regression from the `pl up` cookie-scheme change (#237): the
shipped `docker-compose.ssl.yml` example ran the API with `NODE_ENV=production`
behind Caddy's Let's Encrypt TLS termination but never set
`PRISMALENS_PUBLIC_URL`, so the session cookie's `Secure` attribute — now keyed
to the resolved origin's scheme rather than `NODE_ENV` — silently dropped. The
example now sets `PRISMALENS_PUBLIC_URL=https://${DOMAIN:-localhost}`,
consistent with how it already parameterises `DOMAIN` for Caddy.

The API also now logs a boot warning whenever `NODE_ENV=production` resolves to
non-secure cookies, so any other deployment missing `PRISMALENS_PUBLIC_URL` (or
`PRISMALENS_PROTOCOL=https`) behind a TLS terminator finds out at startup
instead of at the next silent logout.
