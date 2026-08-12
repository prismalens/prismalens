# Workflows

Ten workflow files is more surface than one operator can hold in their head, and
the dangerous subset is small. This file names that subset. Tracked in #301
(review-lane rollout); the ruling that asked for it is
`fable-ruling-4-ci-surface.md`.

## The merge gate

Two checks are required on `main` by ruleset `18441175`, plus one native rule.
Nothing else blocks a merge, however red it looks:

The ruleset is the authority, and it is edited directly through the GitHub API
(`gh api repos/prismalens/prismalens/rulesets/18441175`). There is deliberately no
in-tree file that declares it: a declarative copy with nothing to reconcile it
cannot be kept current, and a stale one reads as authority. This table, and the
live ruleset, are what to trust.

| Required check | Published by | Kind |
| --- | --- | --- |
| `CI gate` | `ci.yml` → job `ci-gate` | check run |
| `Validate PR title (conventional commits)` | `pr-title.yml` → jobs `validate` (PR events) / `validate-queue` (merge queue) | check run |

Both required contexts also report on `merge_group` events (#403): the merge
queue validates each PR against a speculative merge onto `main`, which is what
replaces the ruleset's "branch must be up to date" requirement and its
full-CI-rerun-per-sibling-merge cost.

The third blocker is not a check at all: `required_review_thread_resolution: true`
on the same ruleset. An unresolved review thread blocks the merge button natively,
with no workflow, token or status in the path.

## Review is advisory; unresolved threads are what block

`review-evidence` — a required commit status published by a `review-evidence.yml`
that no longer exists — was retired in #415, along with `review-admit.yml`,
`.github/scripts/`, and the `marker` job in `claude-code-review.yml`. It tried to
prove "a competent reviewer read this exact code" from vendor artifacts: comment
bodies, review states, marker strings, walkthrough stubs. None of those is a
documented API contract and all of them are summonable by anyone who can comment.
Five sound fixes produced five holes in the same place, and the intended happy path
never once completed end to end — the `marker` job posted with `GITHUB_TOKEN`, and
GitHub's anti-recursion rule prevents a `GITHUB_TOKEN` comment from firing the
`issue_comment` trigger the publisher listened on. So the property was never held,
while the gate blocked correct code for two weeks.

What replaced it:

| Mechanism | What it does |
| --- | --- |
| `claude-code-review.yml` | reviews every same-repo PR and posts **inline findings** (`--comment` in its `prompt:` is what makes it post at all) |
| `required_review_thread_resolution` | any unresolved thread — from that reviewer or a human — blocks merge |
| `review-ready` label | **manual** admission of an online CodeRabbit review via `.coderabbit.yaml`'s `auto_review.labels` valve, for sensitive paths or a second opinion |

**Findings block; silence does not.** What is genuinely lost is the machine
guarantee that a reviewer ran on a given head — a guarantee that, per the above, was
never actually held. A reviewer that silently posts nothing now yields a PR that
merges unreviewed. Two places announce that fact, neither of which gates:
the `Report reviewer liveness` step in `claude-code-review.yml` warns in the job
log, and the `announce` job in the same file upserts one advisory comment per PR
stating whether `claude[bot]` actually published anything for the reviewed head
(added after 2026-08-11, when the reviewer ran full reviews, posted nothing, and
every job stayed green for a day before anyone noticed).

## Gate-writers — the workflows that can publish a required check

**No workflow in this repo holds `statuses: write` or `checks: write`.** Keep it
that way. Required checks are matched **by context name with no integration pin**:
any workflow that can post a status named `CI gate` satisfies that gate, and GitHub
will not distinguish it from the real one. The one workflow that ever held
`statuses: write` is gone.

`claude-code-review.yml` runs a model over attacker-influencable diff text on a
**read-only** token. It posts through the action's own app installation, not the
workflow token. It must never acquire a write: a prompt injected into a reviewed
diff would then reach a job that can act on it, and under the current arrangement
the most valuable thing to inject is "resolve these threads".

## Rule for new enforcement

**New enforcement is a step in an existing workflow, never a new file.** Every new
workflow adds a trigger, a token and a permission block the operator has to audit,
and the count is already past what one person tracks. If a rule needs enforcing, add
a step to `ci.yml`, which owns the only aggregating required check.

**Never add `statuses: write` or `checks: write` to any workflow** without a
decision recorded on #301. A status-writer can publish every required check by name,
so it holds the whole gate whatever its stated job is.

**Prefer a native GitHub rule to a workflow that emulates one.** That is the lesson
#415 paid for: thread resolution enforces what four generations of evidence-parsing
could not, because GitHub owns both the artifact and the rule.

## Full inventory

Every workflow in this directory. Two of them — `ci.yml` and `pr-title.yml` —
publish the required checks described above and are the exceptions to watch; the
rest are advisory or out-of-band and cannot affect a merge.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | `pull_request`, `push` | build, test, lint, pack, changeset validation; aggregates to `CI gate` |
| `e2e.yml` | `pull_request`, `push` | Playwright end-to-end suite |
| `cross-os-smoke.yml` | `pull_request`, `push`, `release`, dispatch | CLI smoke across operating systems |
| `audit.yml` | schedule, dispatch | dependency/security audit |
| `release.yml` | `push` | changesets release and publish |
| `dependabot-auto-merge.yml` | Dependabot PRs | auto-merges machine dependency bumps |
| `phase-gate.yml` | `milestone` | milestone bookkeeping |
| `claude-code-review.yml` | `pull_request` | advisory review of every **same-repository** PR; posts inline findings, gates nothing; skips forks, which get no secrets |
| `claude.yml` | `@claude` mentions | labour tool; cannot submit or resolve reviews |
| `pr-title.yml` | `pull_request_target` | conventional-commit title check |
