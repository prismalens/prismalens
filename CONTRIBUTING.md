# Contributing to prismalens

prismalens is open source (Apache-2.0) and **not accepting outside code contributions yet**. Bug reports, feature requests and discussions are welcome through the issue templates; anything security-sensitive goes to [SECURITY.md](SECURITY.md), never a public issue. When outside code contributions open, they take a DCO `Signed-off-by` and the one-time [CLA](CLA.md); until then neither applies, and maintainers and their agents work as below.

## Setup

Node 24 (`.nvmrc`) and pnpm through `corepack enable`. The commands every change runs are in [AGENTS.md](AGENTS.md#commands). Beyond them:

- `pnpm setup:worktree` makes a fresh clone or worktree ready: install, Prisma client, registry, build. It is safe to rerun, and a worktree on the same commit restores the build from the shared turbo cache.
- `pnpm db:init && pnpm dev` runs the API and UI locally. In dev the browser pairs itself on its first request (`PRISMALENS_DEV_PAIR=off` to pair by hand), and an empty database gets demo data (`PRISMALENS_SEED_DEMO=1` forces it outside development).
- `pnpm dev:desktop` runs the Electron app against the dev server, with hot reload.
- Export `PRISMALENS_TELEMETRY=internal` in your shell profile, so your own testing is never counted as an install. `pnpm dev` and the test scripts that boot the app default to it.

## Making a change

1. Branch off `main`; every change lands through a pull request.
2. Ship tests with the change: [docs/contributing/testing.md](docs/contributing/testing.md).
3. Run `pnpm typecheck && pnpm test` and `pnpm format-and-lint`. CI runs them too, on Linux, plus the checks named in [.github/workflows/README.md](.github/workflows/README.md). A local failure that the base branch shows too is not yours: name it in the PR's proof and let CI rule.
4. Title the PR as a [Conventional Commit](https://www.conventionalcommits.org/); a required check enforces it. A single PR squash-merges, so its title becomes the commit on `main`. The body follows `.github/PULL_REQUEST_TEMPLATE.md`, including with `gh pr create --body`.
5. Never commit secrets or private content. Fixtures and log excerpts are synthetic.

A schema change is a new migration: [docs/contributing/migrations.md](docs/contributing/migrations.md).

### Closing issues

Write one keyword per issue, `closes #a, closes #b`; `closes #a, #b` links only #a. A keyword counts only when the PR merges into `main`, so check `gh pr view --json closingIssuesReferences` after opening, and again after a stacked PR retargets. A PR that finishes part of an issue writes `refs #n`. An umbrella issue is closed by hand once its Done when is met, never by a keyword.

### Landing a stack

A stack is PRs based on each other's branches. Land it with **Create a merge commit**, not a squash: the bottom PR's commits join `main`, the next PR retargets with the same head, and its green checks stand. A squash would make every PR above it need a merge-up push and a new CI run. Never run `git merge -s ours origin/main` on a stack PR: it drops every other change on `main`.

## UI changes

The look is held by checks first and review second; the rules are in [packages/frontend/design/GUIDELINES.md](packages/frontend/design/GUIDELINES.md).

- Always: `pnpm --filter @prismalens/frontend ui:check:static`.
- When a screen changes: `pnpm --filter @prismalens/frontend ui:check`, which renders every screen and state and holds them to `packages/frontend/ui-budget.json`.
- A structural change (navigation, the composer, a whole screen) also gets the review in [JUDGE.md](packages/frontend/design/JUDGE.md).

The PR body lists the before and after shots from `ui:shots`, any `ui-budget.json` change with its reason, every user-facing string added or changed, and whether [CAPABILITIES.md](packages/frontend/design/CAPABILITIES.md) changed.

## Releases and docs

Releases, milestones and the phase-gate walk: [RELEASING.md](RELEASING.md); the pipeline behind them: [docs/contributing/release-pipeline.md](docs/contributing/release-pipeline.md). Product docs live on [docs.prismalens.io](https://docs.prismalens.io), built from `prismalens.io:docs/`; `AGENTS.md` → *Docs* says which changes need them.

Every Markdown file here has a word budget and may name only paths and scripts that exist (`node scripts/docs-check.mjs`). A doc over budget is cut, or its detail moves to a reference under `docs/contributing/` that the core links.

## License

[Apache License 2.0](LICENSE); see also [NOTICE](NOTICE). New source files open with the two-line SPDX header their neighbours carry; `scripts/spdx-headers.test.mjs` checks it under `packages/`.
