# CLAUDE.md

## Your persona
You should be critical of users ideas. Not eveything the is asked to be done should be done until explicitly said. You should research and give counter opinions when the pros of the counter options are greater.

## Development phase context
This is a project that is still in development phase
* No deperecation/legacy/dead code needed
* Clean upgrade/update/change only
* No account: the host is the operator (ADR 0001 §2). Opening the dev app on localhost is signed in.

## DB migrations: append-only (#335)
0.5.0 is on npm (2026-09-19), so installed databases exist:

* **Never** delete, edit, rename or squash a migration under
  `packages/@prismalens/database/prisma/{sqlite,pg}/schema/`. A schema change is a new additive
  migration (`pnpm db:migrate`), and nobody is told to delete `prismalens.db`. The runner
  hard-stops on an edited history rather than reconcile it.
* The runner refuses a pre-0.5.0 database by name (`pre-release-database`).
* See `CONTRIBUTING.md` → *Database migrations* for the lifecycle and the failure table.

## Package installation
When adding new packages, always prefer addition/installation via the package manager over adding the package details to package.json file directly.

## Ecosystem
* This is a NodeJS project
* API NestJS
* UI Tanstack start + Tanstack router + tailwind + shadcn

## App/Project context
* Opensource app
* Single tenant

## Code Formatting Best Practices

### Never hand-fix what Biome will fix
Run `pnpm format-and-lint:fix` before you commit. It applies formatting and the
SAFE lint fixes in one pass; `pnpm format-and-lint` (no `:fix`) is the read-only
form CI runs.

Do not read a Biome diagnostic and edit the file by hand to satisfy it — that is
the slow path, and it is the one that produces the push / red `Lint (Biome)` /
re-read / fix / push-again cycle. Let the tool write, then re-run it to confirm.

A `pre-commit` hook does this for staged files automatically once you have run
`pnpm install` (it never blocks a commit; CI's `Lint (Biome)` job is the
enforcement). Do not rely on it alone: it fires at commit time, so a long editing
session still ends with the fix command.

Unsafe fixes are never applied automatically. If Biome reports one, decide
deliberately whether `--unsafe` is correct for that case rather than reaching for
it by reflex.

### Indentation
- Never convert tabs to spaces or vice-versa.
- Preserve the original indentation pattern exactly when making code suggestions.

## Knowledge base (mage)
Design/spec knowledge lives in an external **mage** hub — see [AGENTS.md](AGENTS.md). This repo is
project `prismalens-platform`; start at `<hub>/INDEX.md` and open the
`prismalens-platform` wing (hub path in `mage/metadata.json`; full instructions
in AGENTS.md).

@AGENTS.md
