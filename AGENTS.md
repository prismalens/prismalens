# AGENTS.md

PrismaLens is a local-first incident investigator: alerts come in by webhook, a coding agent the user already runs (Claude Code, Codex, OpenCode, Gemini CLI) investigates through ACP, and the user gets a report with a cause and a next command. It is a pnpm + Turborepo monorepo: NestJS API, TanStack Start UI, Prisma on SQLite, and the `prismalens` CLI that bundles them. [CONTRIBUTING.md](CONTRIBUTING.md) is the process; references under `docs/contributing/` hold the detail.

## Commands

```bash
pnpm setup:worktree             # a fresh checkout or worktree: install, Prisma, registry, cached build
pnpm typecheck && pnpm test      # run both before calling a change done
pnpm format-and-lint             # Biome, then the frontend look gates
pnpm --filter @prismalens/frontend test:e2e   # Playwright; --workers=1 on a small machine
pnpm db:init && pnpm dev         # local API + UI
```

## Invariants
Easy to break and expensive to undo.

- **Migrations are append-only.** Installed databases exist, so never delete, edit, rename or squash a migration under `packages/@prismalens/database/prisma/sqlite/schema/`; a schema change is a new one (`pnpm db:migrate`). [docs/contributing/migrations.md](docs/contributing/migrations.md).
- **No non-free capability lands here**, not even disabled behind a flag. Paid capabilities load as separate modules through the capability-flag seam (#264); the flags and UI shells here stay inert without one.
- **One report shape.** What an agent returns and the UI renders is `ModelReportSchema` in `packages/@prismalens/contracts/src/schemas/investigation.ts`. Change it there, not in a copy.
- **Registries, not lists.** Anything a user can see, run, set or bind is declared once in the registry the app reads. Run `pnpm registry where <thing>` before adding one; `pnpm registry ls [kind]` lists what exists and `pnpm registry brief <surface>` gives the rules in force on a surface. Entries are `define.<kind>(…)` in files named for their kind (`*.actions.ts`); kinds live in `packages/frontend/src/registry/kinds/`.
- **Tests ship with code, at its seams, once its shape settles.** A bug fix starts with a test that fails on the bug, at the highest seam that shows it. A feature may start as a spike; before its PR is ready it has tests at its public seam or a journey, not on internals. Coverage floors are a ratchet, not a target. Fix the implementation, not the test. Every test:
  - asserts every claim in its name, and every value a step takes as a parameter;
  - asserts the exact value, code or message, with a fixture the broken code would fail on: no bare `toBeInstanceOf`, `toBeDefined` or `>= 1`, no `expect` inside an `if`, a loop or a mock;
  - fails, or is skipped by name with its cause, when it cannot set up its condition; an assertion gated to one platform needs a CI leg on that platform.

  How: [docs/contributing/testing.md](docs/contributing/testing.md).
- **Keep indentation as found.** Never convert tabs to spaces or back.

## Writing
- Comments, test names, commits and PR text explain current behaviour to a reader who was not in the conversation. Cite a public issue when the story is long; never a review round, a chat or a board card.
- A comment carries one non-obvious constraint in three lines or fewer.
- Name other products only where a doc identifies an integration, such as the supported agents.
- Docs say each rule once. `node scripts/docs-check.mjs` holds every Markdown file to its word budget and to paths and scripts that exist.

## UI changes
A change under `packages/frontend` follows [GUIDELINES.md](packages/frontend/design/GUIDELINES.md) and [CONTRIBUTING.md → UI changes](CONTRIBUTING.md#ui-changes).

## Docs
docs.prismalens.io documents a short contract: install and upgrade, the basic use of `pl up`, `pl doctor` and `pl upgrade`, the alert webhook contract, the report's structure, and the trust and data guarantees (`prismalens.io:docs/POLICY.md`). A PR that changes one links the website PR or a docs issue; anything else is described by `--help`, the UI and the release notes ("Docs: none, not on the contract"). `README.md` is the front page, `packages/cli/README.md` the npm page with one line per command, and other package READMEs hold one line and the website link.
