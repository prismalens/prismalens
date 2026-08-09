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

1. **Design validation before merge, and the screenshots go on the PR.** Capture the changed
   surface from the running dev stack in `default` and `dark`, plus `empty` and `error`
   for each of those states the surface can actually reach — a surface with both needs both
   shots. Pass a design review against the frontend-design standards. Commit the PNGs and
   render them in the PR body — capturing them locally is no longer enough. A frontend PR
   with no screenshots visible on the PR and no recorded verdict does not merge. (Mechanical
   enforcement is planned as a `design-evidence` status — #304 — deferred until #301's gate
   pattern is promoted here.)
2. **A `## UX review` section in the PR body, and the `ux-review` label on the PR.** Written
   to the template below: what changed and why (issue/ADR link), where to click, what to
   verify per state, judgment calls made, and the screenshot set. The operator walks these
   sections as a milestone sign-off requirement (query below). **UX-shape changes** — a new
   page, a navigation change, a new interaction model — are flagged to the operator
   immediately, out of band, not batched into the milestone walk.
3. **Playwright spec.** Ship or extend an e2e spec covering the changed surface (#303).
   Until the harness lands, the PR body must name the intended spec so coverage debt stays
   visible. Coverage is audited at each milestone alongside the UX review walkthrough.

An implementation spec for frontend work that omits these deliverables is incomplete — do
not start implementation until they are added.

> Superseded 2026-08-09: requirement 2 used to be "append an entry to
> `~/ai-context/prismalens-ux-ledger.html`". That file is **frozen** — it keeps its history,
> takes no new entries, and nothing is migrated out of it. New evidence lives on the PR.

### Where the screenshots live

**Commit them to the repo**, next to the spec that exercises the surface:

```
packages/frontend/e2e/<suite>/screenshots/<surface>-<state>.png
```

`<suite>` is the Playwright directory the change is covered by (`journeys/`, `pl-up/`, …) and
`<state>` is one of `default`, `dark`, `empty`, `error`. This matches what the frontend PRs
already do (`packages/frontend/e2e/pl-up/screenshots/` on `main`; #396 and #393 add their own
under `e2e/**/screenshots/`). Generate them from the spec (`await page.screenshot(...)`)
rather than by hand wherever the spec already reaches that state, so a re-run reproduces the
evidence.

Committed files, not drag-and-drop PR attachments: an agent driving `gh` cannot upload an
attachment (that is a browser-only gesture), attachment bytes live only in GitHub's CDN with
no link to the commit that produced them, and a committed PNG diffs visibly when the surface
changes.

**This repository is public and a committed PNG is permanent** — a later `git rm` does not
remove it from history. Shoot only synthetic state: the seeded dev fixtures, or a fresh
`pl up` workspace. Never a screenshot containing an API key, a token, a real incident or
alert payload, a customer or colleague's name, a real email address, a repository path
outside the checkout, or anything else you would not paste into a public issue. Look at every
PNG before `git add`, and redact or re-shoot rather than commit-and-fix.

Embed each one in the PR body with a **commit-pinned** raw URL — the repo is public, so these
render inline:

```
![Incidents — dark](https://raw.githubusercontent.com/prismalens/prismalens/<head-sha>/packages/frontend/e2e/journeys/screenshots/incidents-dark.png)
```

Use the head SHA (`git rev-parse HEAD` after the final push), never the branch name: the
branch is deleted on merge and every branch-pinned image 404s afterwards.

### The `## UX review` template

Copy this into the PR body and fill it in. The heading text is load-bearing — the milestone
walkthrough greps for it.

````markdown
## UX review

**UX shape:** none | new page | navigation change | new interaction model
<!-- Anything other than `none`: ping the operator now, don't wait for the milestone walk. -->

**What changed & why.** One short paragraph. Link the issue and any ADR: Closes #NNN, ADR-00NN.

**Where to click.**
1. `pnpm dev`, open http://localhost:3000/incidents
2. …

Include how to reach the required data state if a normal dev DB will not have it (seed
command, `pl up` against an empty workspace dir, fixture, …).

**What to verify, per state.**
- [ ] Default — …
- [ ] Dark — …
- [ ] Empty — …
- [ ] Error — …

**Judgment calls.** Decisions taken that the operator may want to veto, and why they were
taken. "None" is a valid answer; omitting the field is not.

**Screenshots.** Design gate: PASS | FAIL

| State | |
|---|---|
| Default | ![default](https://raw.githubusercontent.com/prismalens/prismalens/<sha>/packages/frontend/e2e/<suite>/screenshots/<surface>-default.png) |
| Dark | ![dark](https://raw.githubusercontent.com/prismalens/prismalens/<sha>/packages/frontend/e2e/<suite>/screenshots/<surface>-dark.png) |
| Empty | ![empty](https://raw.githubusercontent.com/prismalens/prismalens/<sha>/packages/frontend/e2e/<suite>/screenshots/<surface>-empty.png) |
| Error | ![error](https://raw.githubusercontent.com/prismalens/prismalens/<sha>/packages/frontend/e2e/<suite>/screenshots/<surface>-error.png) |

<!-- Drop the Empty / Error rows the surface genuinely cannot reach, and say which and why
     under Judgment calls. Do not drop one because you did not get round to it. -->
````

Apply the label when opening the PR:

```bash
gh pr create --title '…' --body-file <body.md> --label ux-review
```

If the PR already exists: `gh pr edit <number> --add-label ux-review`.

### How the operator walks a milestone

The label plus the fixed heading is what replaces the single ledger file. List everything
awaiting a walk:

```bash
gh pr list --repo prismalens/prismalens --label ux-review --state all --limit 100 \
  --json number,title,url,state,mergedAt \
  --template '{{range .}}#{{.number}}  {{.state}}  {{.title}}{{"\n"}}   {{.url}}{{"\n"}}{{end}}'
```

Scope it to one milestone window by merge date — the equivalent of "everything since the last
sign-off":

```bash
gh pr list --repo prismalens/prismalens --label ux-review --state merged \
  --search 'merged:>=2026-08-09' --limit 100 --json number,title,url
```

Both commands cap at `--limit 100`; raise it if a milestone ever spans more frontend PRs than
that, because `gh` silently returns the first page rather than telling you it truncated.

Read the walkthroughs back to back, in one pass, without opening each PR:

```bash
for n in $(gh pr list --repo prismalens/prismalens --label ux-review --state all \
             --limit 100 --json number -q '.[].number' | sort -n); do
  gh pr view --repo prismalens/prismalens "$n" --json number,title,body -q \
    '"\n\n=== PR #\(.number) — \(.title) ===\n" + (((.body // "") | split("## UX review") | .[1]) // "(!) no ## UX review section")'
done
```

A PR carrying the `ux-review` label with no `## UX review` section is a gate failure — that
loop prints it as `(!)` so it cannot hide.

The inverse failure — a frontend PR that was never labelled, and is therefore invisible to
every query above — is the one real weakness of a query-based walk, and until #304 lands it is
caught by an audit rather than by CI. Run this over the same window before signing off:

```bash
for n in $(gh pr list --repo prismalens/prismalens --state merged --search 'merged:>=2026-08-09' \
             --limit 100 --json number -q '.[].number'); do
  gh pr diff --repo prismalens/prismalens "$n" --name-only | grep -q '^packages/frontend/' || continue
  gh pr view --repo prismalens/prismalens "$n" --json number,title,labels -q \
    'select([.labels[].name] | index("ux-review") | not)
     | "(!) UNLABELLED frontend PR #\(.number) — \(.title)"'
done
```

Anything it prints gets `gh pr edit <n> --add-label ux-review` and a `## UX review` section
added to its body before the walk continues.

Sign-off is a comment on the PR (`gh pr comment <n> --body 'UX sign-off: …'`), so the verdict
stays attached to the change it judges.

History before 2026-08-09 lives in the frozen ledger at
`~/ai-context/prismalens-ux-ledger.html` (local to the operator's machine, not in git).

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
