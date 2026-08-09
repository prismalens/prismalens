# AGENTS.md

Instructions for AI coding agents working in this repository.

<!-- BEGIN mage -->
## mage knowledge base (external hub)

This repository's durable knowledge lives in an external **mage hub** at
`/home/sumit/.mage/hubs/github.com/prismalens/prismalens-docs-hub`, where this repo is the **prismalens-platform** project. mage is a portable,
file-based knowledge base of notes — insight, procedure, and pointers (not
copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read the hub index first: `/home/sumit/.mage/hubs/github.com/prismalens/prismalens-docs-hub/INDEX.md` — find the **prismalens-platform** wing (its
   notes are grouped there; in a large hub the wing links out to its own
   `/home/sumit/.mage/hubs/github.com/prismalens/prismalens-docs-hub/_index.prismalens-platform.md`). One line per note: type · title · keywords · → link. Open
   only the notes the task touches; don't read everything.
2. Skim `/home/sumit/.mage/hubs/github.com/prismalens/prismalens-docs-hub/decisions/` for the hub's governing decisions.
3. Treat notes as point-in-time. If a note is `status: stale-suspect`, or its
   `last_reviewed` / `provenance.commit` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with `/mage-learn` into
the hub. Capture the reusable *insight + procedure + pointers*, never a copy.

**Cross-link, don't just file.** A standalone note is write-only — it won't be
recalled at the point of need unless the doc you read there links to it. So when
you capture a research/option `note`, wire its `[[wikilink]]` **inline into the
specific ADR section(s) it bears on** (and those ADRs' `## Relations`),
**bidirectionally** (note→ADR and ADR→note), then `mage index`. See the hub note
`cross-link-research-into-decisions` for the procedure + the failure it prevents.

**Commit hygiene:** mage never commits for you. It suggests `git` commands; you
run them.
<!-- END mage -->

## Implementation specs must declare docs impact

Every implementation spec handed to a coding agent must name a **Docs surfaces** deliverable: the specific files (README.md section, docs/ page, CLI --help text, mage note) the change is expected to update — or state explicitly "none affected because …". A spec without either is incomplete; do not start implementation until it's added.

Where a named surface explains three or more interacting parts (a resolution order, a topology, a state machine, a pipeline, a precedence rule), the spec must also say which concrete artifact will carry it — a worked example, a terminal transcript, a diagram, or (only if genuinely graphical) a screenshot with a stated invalidation trigger. Prose-only for that kind of surface is an incomplete spec.

## Frontend changes carry a design gate, a UX review on the PR, and an e2e spec

Every PR touching `packages/frontend` — regardless of which agent or session produces it:

1. **Design validation before merge, with the screenshots on the PR.** Capture the changed
   surface from the running dev stack in `default` and `dark`, plus `empty` and `error` for
   each of those the surface can actually reach, and pass a design review against the
   frontend-design standards. Capturing locally is no longer enough — they go *on the PR*. No
   screenshots visible there and no recorded verdict, no merge. (Mechanical enforcement is
   planned as a `design-evidence` status — #304 — deferred until #301's pattern is promoted.)
2. **A `## UX review` section in the PR body, and the `ux-review` label on the PR.** Fill in
   the template below. The heading text and the label are both load-bearing: they are how the
   operator finds this change again at milestone sign-off.
3. **Playwright spec.** Ship or extend an e2e spec covering the changed surface (#303). Until
   the harness lands, name the intended spec in the PR body so coverage debt stays visible.

**UX-shape changes** — a new page, a navigation change, a new interaction model — are flagged
to the operator **immediately and out of band**, never batched into the milestone walk.

An implementation spec for frontend work that omits these deliverables is incomplete — do not
start implementation until they are added. Requirement 2 replaced an append-to-a-local-file
ledger on 2026-08-09; that file is frozen, and the operator's side of this — walking a
milestone, auditing for PRs that forgot the label — is now
[`docs/ux-review-walkthrough.md`](docs/ux-review-walkthrough.md).

### Screenshots

Commit them beside the spec that exercises the surface, as
`packages/frontend/e2e/<suite>/screenshots/<surface>-<state>.png` — `<suite>` is the Playwright
directory (`journeys/`, `pl-up/`, …), `<state>` is `default`, `dark`, `empty`, or `error`.
Generate them from the spec (`await page.screenshot(...)`) wherever it already reaches that
state. **This repo is public and a committed PNG is permanent**: seeded or synthetic state
only, and look at every file before `git add` — no keys, tokens, real alert or incident
payloads, personal names, or emails.

Embed each in the PR body with a raw URL pinned to the **head SHA** (`git rev-parse HEAD` after
the final push), never the branch name — branch-pinned images 404 once the branch is deleted
on merge:

```
![Incidents — dark](https://raw.githubusercontent.com/prismalens/prismalens/<head-sha>/packages/frontend/e2e/journeys/screenshots/incidents-dark.png)
```

### The `## UX review` template

````markdown
## UX review

**UX shape:** none | new page | navigation change | new interaction model

**What changed & why.** One paragraph. Closes #NNN, plus the ADR link if one governs it.

**Where to click.** Numbered steps starting from a dev-app URL, including how to reach the
required data state if a normal dev DB will not have it (seed command, `pl up` against an
empty workspace dir, fixture).

**What to verify, per state.** A `- [ ]` line each for default, dark, empty, error.

**Judgment calls.** Anything the operator may want to veto, and why it was chosen. "None" is
a valid answer; omitting the field is not.

**Screenshots.** Design gate: PASS | FAIL — one commit-pinned image per state above. Drop a
state only if the surface genuinely cannot reach it, and say which and why under Judgment
calls.
````

Open the PR with the label already attached:

```bash
gh pr create --title '…' --body-file <body.md> --label ux-review
```

If it already exists: `gh pr edit <number> --add-label ux-review`.

## Implementation specs must declare a capability tier

Every implementation spec also states its **capability tier**: `free` (the default — everything
in this repo), or a non-free tier per ADR-0023's boundary. Non-free capabilities never land in
this repository — not even disabled behind a boolean. They integrate only through the
capability-flag + dynamically-loaded-module seam (#264); the flags and UI shells here stay inert
without a verified module. A spec that adds gated-but-present behavior to this repo is
misdesigned — send it back.

## Agents never operate in the main checkout

All agent work on this repository's files and git state — coding, running commands,
checking out branches, anything that touches this repo's working tree — happens in a
worktree at `~/worktrees/<repo>/<branch-slug>`, never in the main checkout at the repo
root. The main checkout, and the dev stack it serves (the one running `pnpm dev` for
manual verification), is orchestrator territory: only the orchestrator switches its
branch or restarts its stack, and only deliberately. An agent that finds itself pointed
at the main checkout stops and reports rather than proceeding — a prior incident had an
agent "restore" the main repo to a stale branch, which cascaded into compile failures and
an invalid-data DB reseed. This does not affect the external mage hub: `/mage-learn` and
`mage index` write to `~/.mage/hubs/...`, outside this repo's git state, and remain
required regardless of which checkout an agent is reasoning from.
