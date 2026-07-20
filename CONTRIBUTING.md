# Contributing to prismalens

Thanks for your interest in improving prismalens — a local-first SRE
incident-investigation tool.

## Contribution status

**prismalens is open source (Apache-2.0) but is not accepting outside code
contributions yet.** The codebase is moving fast pre-1.0 and the review
bandwidth goes into the release. What IS very welcome right now: bug reports,
feature requests, and discussions — use the issue templates. Forking is of
course fine; that's what the license is for.

When code contributions open, they will be gated by the Developer Certificate
of Origin (DCO, `Signed-off-by` on every commit) under Apache-2.0
inbound=outbound. This section will be updated when that happens.

Alongside the DCO, a one-time **Contributor License Agreement** ([CLA.md](CLA.md))
will apply. It exists purely for IP hygiene — it keeps the Project's copyright in
one clean place, as is standard for open-core projects (Grafana, Sentry) — and it
does not change the license: your contributions remain licensed to everyone under
Apache-2.0, inbound = outbound. It is **not in force yet**; when contributions
open, a bot will ask each new contributor to sign once on their first pull
request by posting a short comment. Nothing is required of you today.

## Ground rules

- **The trunk branch is `main`, and it is protected.** Every change lands
  through a pull request; direct pushes to the trunk are not allowed (for
  anyone, including the maintainer).
- **Never commit secrets.** No API keys, tokens, connection strings, or private
  content. prismalens runs against real infrastructure under read-only
  credentials by design — keep that contract intact.
- Keep PRs focused. One logical change per PR makes review fast.

## Development setup

Requirements: **Node >= 22** and **pnpm** (this repo pins pnpm via the
`packageManager` field; `corepack enable` will select the right version). It is
a Turborepo monorepo (NestJS API + TanStack Start UI + a BullMQ worker, with
Prisma/SQLite).

```bash
git clone https://github.com/prismalens/prismalens.git
cd prismalens
pnpm install

pnpm build        # turbo run build
pnpm typecheck    # turbo run typecheck
pnpm test         # turbo run test
pnpm format-and-lint        # biome check . (lint + format)
pnpm format-and-lint:fix    # biome check . --write
```

Run the app locally (API + frontend):

```bash
pnpm db:init      # initialise the local SQLite database
pnpm dev          # turbo run dev (or dev:api / dev:frontend)
```

The dev login is `admin@prismalens.dev` / `admin123`.

## Making a change

1. **Branch** off `main`: `git checkout -b fix/short-description main`.
2. **Work test-first (repo policy since #58): new code ships with tests written
   at its public seams and ≥80% per-metric coverage.** Vitest enforces this via
   per-glob `coverage.thresholds` (see `packages/cli/vitest.config.ts`) — when
   you add a module, add it (or its directory) to that map; reviewers treat a
   new source file with no threshold entry as a missing test. Pre-existing
   files are exempt until touched. Fix the implementation, not the test,
   unless the test is wrong.
3. Make sure `pnpm typecheck`, `pnpm build`, `pnpm test`, and
   `pnpm format-and-lint` all pass.
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `perf:`.
5. **Open a PR** against `main`. The **PR title** must be a valid conventional
   commit — a required check enforces it (the repo squash-merges, so the PR
   title becomes the trunk commit subject).

## Code style

- Formatting and linting are handled by **Biome** — run `pnpm format-and-lint`.
- **Never convert tabs to spaces or vice-versa.** Preserve the existing
  indentation of each file exactly.
- Small, cohesive files; explicit error handling at boundaries; no stray
  `console.log` debris and no hardcoded secrets.

## License headers (SPDX)

Every first-party source file (`*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.mjs`,
`*.cjs`) starts with:

```
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
```

(after the shebang, for executables). CI enforces this via `pnpm spdx:check`.
Headers are automatically inserted when you commit; `pnpm spdx:fix` remains
available for manual runs. Generated code is excluded — paraglide
output, generated clients, anything under `dist/` — see the `EXCLUDE` list in
`scripts/spdx-headers.mjs`.

## Knowledge base (mage)

Durable design and spec knowledge lives in an **external mage hub**, not in this
repo — see [AGENTS.md](AGENTS.md). Before non-trivial work, read the hub's
`INDEX.md` and the `prismalens-platform` wing. When you learn something durable
(an interface detail, a gotcha, a decision), capture it as a note there rather
than letting it evaporate.

## Releases and package publishing

One package publishes to npm: `prismalens` (the CLI). Its first-party library
closure — `@prismalens/engine`, `@prismalens/contracts`, `@prismalens/config` —
is `private: true` and **bundled into the CLI tarball at build time** (tsup), so
it never publishes separately (see
[#193](https://github.com/prismalens/prismalens/issues/193)).
Versioning and publishing run through
[Changesets](https://github.com/changesets/changesets) (`.changeset/config.json`
+ `.github/workflows/release.yml`): a change anywhere in that closure should come
with a changeset naming **`prismalens`** — never a `@prismalens/*` package (see
[`.changeset/README.md`](.changeset/README.md)). On every push to `main` with
pending changesets, the release workflow opens/updates a **"chore: version
packages" PR** (`pnpm changeset:version`); merging that PR publishes the bumped
`prismalens` package to npm with provenance (`pnpm changeset:publish` =
`pnpm publish -r`, which skips private packages, then `changeset tag`) and
creates a GitHub Release for its tag. The version PR is opened with the
`RELEASE_PAT` repo secret (fine-grained PAT, Contents + Pull requests read/write
— the PR must come from a user so CI triggers on it). npm publishing uses
**trusted publishing** (OIDC): `prismalens` registers this repo's `release.yml`
as a trusted publisher on npmjs.com, pnpm exchanges the workflow's OIDC token
for a short-lived credential, and provenance is attested automatically — there
is no npm token secret to rotate or leak.

The same steps can be run manually from a local checkout as a fallback:
`pnpm changeset:version` → review/commit → `pnpm build && pnpm test &&
pnpm publint` → `pnpm changeset:publish` → `git push --follow-tags`.

Everything else in `packages/` stays `private: true` — `@prismalens/logger` and
`@prismalens/database` are internal, and the app-side packages
(`@prismalens/api`, `@prismalens/frontend`, `@prismalens/worker`) are excluded
from Changesets entirely — they deploy, they don't publish.

## Reporting bugs and requesting features

Use the issue templates. For anything security-sensitive, **do not open a public
issue** — see [SECURITY.md](SECURITY.md).

## License

prismalens is distributed under the [Apache License 2.0](LICENSE) (see also
[NOTICE](NOTICE)). The hosted cloud / enterprise edition
(`prismalens-enterprise`) is a separate, **proprietary** product and carries
none of this repository's licensing. This repository's license is not
changing — paid features are developed in the separate proprietary repo and
never move out of (or into) this one.

If and when outside code contributions are accepted (see
[Contribution status](#contribution-status)), contributors will sign a
lightweight **Contributor License Agreement (CLA)** in addition to DCO
sign-off. The CLA exists for IP hygiene — keeping the project's copyright in
one clean place, as is standard for open-core projects (Grafana, Sentry) — and
contributions remain licensed to everyone under Apache-2.0, inbound=outbound.
