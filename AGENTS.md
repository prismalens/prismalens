# AGENTS.md

PrismaLens is a local-first incident investigator: alerts come in by webhook, a coding agent the user already runs (Claude Code, Codex, OpenCode, Gemini CLI) investigates through ACP, and the user gets a report with a cause and a next command. It is a pnpm + Turborepo monorepo: NestJS API, TanStack Start UI, Prisma on SQLite or Postgres, and the `prismalens` CLI that bundles them.

## Commands
Node 24 or later (`.nvmrc`), pnpm via `corepack enable`.

```bash
pnpm install
pnpm typecheck && pnpm test      # run both before calling a change done
pnpm format-and-lint             # Biome, then the frontend look gates
pnpm --filter @prismalens/frontend test:e2e   # Playwright; use --workers=1 on a small machine
pnpm db:init && pnpm dev         # local API + UI
```

`CONTRIBUTING.md` has the full setup, the e2e tiers and the release flow.

## Invariants
These are easy for an agent to break and expensive to undo.

- **Migrations are append-only.** 0.5.0 shipped, so installed databases exist. Never delete, edit, rename or squash a migration under `packages/@prismalens/database/prisma/{sqlite,pg}/schema/`. A schema change is a new migration (`pnpm db:migrate`). The runner refuses an edited history by design. `CONTRIBUTING.md` → *Database migrations*.
- **No non-free capability lands here**, not even disabled behind a flag. Paid capabilities load as separate modules through the capability-flag seam (#264); the flags and UI shells in this repo stay inert without one.
- **One report shape.** What an agent returns and what the UI renders is `ModelReportSchema` in `packages/@prismalens/contracts/src/schemas/investigation.ts`. Change it there, not in a local copy.
- **Tests ship with code.** New modules get tests at their public seams and a coverage threshold entry (see `packages/cli/vitest.config.ts`). Fix the implementation, not the test, unless the test is wrong.
- **Keep indentation as found.** Never convert tabs to spaces or back.

## Writing
- Comments, test names, commit messages and PR text explain current behaviour to a reader who was not in the conversation. Cite a public issue (`#264`) when the story is long; never a review round, a chat, a board card or an iteration ID.
- A comment carries one non-obvious constraint in three lines or fewer. Don't narrate what the code does.
- Don't name other products in code, comments, commits or docs.
- Commits and PR titles follow Conventional Commits; a required check enforces the PR title.

## Docs
A change to anything a user sees updates its doc in the same PR, or the PR says why none is affected.

- `README.md` is the front page: what it is, quick start, repo layout.
- `packages/cli/README.md` is the npm page: install, quick start, one line per command, a link to the website.
- Other package READMEs hold one short description and the website link.
- Flags, config keys, environment variables and per-command reference live on docs.prismalens.io (repo `prismalens/prismalens.io`), not in package READMEs.
