---
"prismalens": patch
---

Harden the server bootstrap: Host/Origin allowlist middleware plus `helmet`.

Every request's `Host` — and its `Origin`, when present — must name an allowlisted
hostname or is rejected with `403`. This closes the DNS-rebinding class against the
`@Public()` routes (login, session, and owner creation during the pre-setup window),
which CORS cannot cover because a rebound page is same-origin to the browser. Loopback
names and IP literals are always allowed, so the unconfigured local run and a LAN bind
both work with no configuration; `PRISMALENS_ALLOWED_HOSTS`, `PRISMALENS_PUBLIC_URL` and
`PRISMALENS_DOMAIN` extend the list.

`helmet` now sets the standard hardening headers, including a CSP locked to `'self'` for
every fetch directive, with two documented relaxations the statically served SPA requires.

Also: `PRISMALENS_HOST` now defaults to `127.0.0.1` rather than `0.0.0.0`, and a
non-loopback bind logs a warning; and the API no longer issues a cross-origin CORS grant
to `http://localhost:3000` by default — under single-origin serving that grant named an
origin that no longer exists. Set `PRISMALENS_CORS_ORIGIN` to opt back in.
