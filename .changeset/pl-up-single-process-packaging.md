---
"prismalens": minor
---

`pl up` — run the whole app as one process on one port, from one npm install

`npm i -g prismalens && pl up` now boots the NestJS API, serves the built
dashboard from the same origin, creates a SQLite database in `~/.prismalens`
and applies its own migrations. No Docker, no Redis, no second server.

The tarball carries the first-party closure as **bundled dependencies**: a new
`scripts/pack-cli.mjs` copies each built `@prismalens/*` package into
`node_modules/@prismalens/<name>` and GENERATES the third-party dependency
union those copies resolve against — because copying moves the hoist, it does
not remove it. The pack fails on a version-range conflict between copied
packages, or on any copied package importing something absent from the union.
`packages/cli` no longer bundles the closure with `noExternal`.

`engines.node` moves to `>=24`: `@prismalens/api` and `@prismalens/database`
now travel inside this package and both require it.
