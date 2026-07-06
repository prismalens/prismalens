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

## Ground rules

- **The trunk branch is `main`, and it is protected.** Every change lands
  through a pull request; direct pushes to the trunk are not allowed (for
  anyone, including the maintainer).
- **Never commit secrets.** No API keys, tokens, connection strings, or private
  content. prismalens runs against real infrastructure under read-only
  credentials by design — keep that contract intact.
- Keep PRs focused. One logical change per PR makes review fast.

## Development setup

Requirements: **Node >= 24** and **pnpm** (this repo pins pnpm via the
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
2. **Write or update tests** where it makes sense; fix the implementation, not
   the test, unless the test is wrong.
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

(after the shebang, for executables). CI enforces this via `pnpm spdx:check`;
`pnpm spdx:fix` inserts missing headers. Generated code is excluded — paraglide
output, generated clients, anything under `dist/` — see the `EXCLUDE` list in
`scripts/spdx-headers.mjs`.

## Knowledge base (mage)

Durable design and spec knowledge lives in an **external mage hub**, not in this
repo — see [AGENTS.md](AGENTS.md). Before non-trivial work, read the hub's
`INDEX.md` and the `prismalens-platform` wing. When you learn something durable
(an interface detail, a gotcha, a decision), capture it as a note there rather
than letting it evaporate.

## Releases and package publishing

Four packages publish to npm: `prismalens` (the CLI) plus its library closure
`@prismalens/engine`, `@prismalens/contracts`, and `@prismalens/config`.
Versioning and publishing run through
[Changesets](https://github.com/changesets/changesets)
(`.changeset/config.json` + `.github/workflows/release.yml`): a change to a
publishable package should come with a changeset (`pnpm changeset`); on `main`,
the release workflow opens a "Version Packages" PR (`pnpm changeset:version`),
and merging that PR publishes the bumped packages to npm with provenance
(`pnpm changeset:publish`). Everything else in `packages/` stays
`private: true` — `@prismalens/logger` and `@prismalens/database` are internal,
and the app-side packages (`@prismalens/api`, `@prismalens/frontend`,
`@prismalens/worker`) are excluded from Changesets entirely — they deploy, they
don't publish.

## Reporting bugs and requesting features

Use the issue templates. For anything security-sensitive, **do not open a public
issue** — see [SECURITY.md](SECURITY.md).

## License

prismalens is distributed under the [Apache License 2.0](LICENSE) (see also
[NOTICE](NOTICE)). The hosted cloud / enterprise edition
(`prismalens-enterprise`) is a separate, **proprietary** product and carries
none of this repository's licensing. If and when outside code contributions
are accepted (see [Contribution status](#contribution-status)), they will be
licensed under Apache-2.0, inbound=outbound, with DCO sign-off.
