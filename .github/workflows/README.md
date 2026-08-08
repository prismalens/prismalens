# Workflows

Twelve workflow files is more surface than one operator can hold in their head, and
the dangerous subset is small. This file names that subset. Tracked in #301
(review-lane rollout); the ruling that asked for it is
`fable-ruling-4-ci-surface.md`.

## The merge gate

Three checks are required on `main` by ruleset `18441175`. Nothing else blocks a
merge, however red it looks:

| Required check | Published by | Kind |
| --- | --- | --- |
| `CI gate` | `ci.yml` → job `ci-gate` | check run |
| `Validate PR title (conventional commits)` | `pr-title.yml` → job `validate` | check run |
| `review-evidence` | `review-evidence.yml` → `../scripts/review-evidence.sh` | **commit status** |

## Gate-writers — the workflows that can publish a required check

**`review-evidence.yml` is the only workflow in this repo holding `statuses: write`,
and no workflow holds `checks: write`.** That is a property worth keeping, because
required checks are matched **by context name with no integration pin**: any
workflow that can post a status named `review-evidence` satisfies the gate, and
GitHub will not distinguish it from the real evaluator.

`review-evidence.yml` earns its privilege by never executing PR content: it runs on
`pull_request_target`, pins its checkout to the default branch, and reads the GitHub
API only. Read the header comment in that file before changing its trigger.

`claude-review.yml` is the case most likely to be misread. It produces review
evidence, but it holds neither `statuses: write` nor `checks: write` — it posts a
marker *comment*, and `review-evidence.yml` decides whether that comment counts.
Producing evidence and publishing a required check are two different privileges, and
only the second one is dangerous. Keep them separate.

## Rule for new enforcement

**New enforcement is a step in an existing workflow, never a new file.** Every new
workflow adds a trigger, a token and a permission block the operator has to audit,
and the count is already past what one person tracks. If a rule needs enforcing, add
a step to the workflow that already owns that surface — `ci.yml` for anything gating
code, `review-evidence.yml` for anything gating review.

**Never add `statuses: write` or `checks: write` to any workflow other than
`review-evidence.yml`** without a decision recorded on #301. A second status-writer
can publish every required check by name, so it holds the whole gate whatever its
stated job is.

## Full inventory

Every workflow in this directory. Three of them — `ci.yml`, `pr-title.yml` and
`review-evidence.yml` — publish the required checks described above and are the
exceptions to watch; the rest are advisory or out-of-band and cannot affect a
merge.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | `pull_request`, `push` | build, test, lint, pack, changeset validation; aggregates to `CI gate` |
| `e2e.yml` | `pull_request`, `push` | Playwright end-to-end suite |
| `cross-os-smoke.yml` | `pull_request`, `push`, `release`, dispatch | CLI smoke across operating systems |
| `audit.yml` | schedule, dispatch | dependency/security audit |
| `release.yml` | `push` | changesets release and publish |
| `dependabot-auto-merge.yml` | Dependabot PRs | auto-merges machine dependency bumps |
| `governance.yml` | dispatch | syncs `.github/governance.json` to repo settings |
| `phase-gate.yml` | `milestone` | milestone bookkeeping |
| `review-admit.yml` | dispatch | applies the `review-ready` admission label (spends the scarce online review) |
| `claude-review.yml` | dispatch | runs a Claude review and posts the marker `review-evidence` branch D reads |
| `pr-title.yml` | `pull_request_target` | conventional-commit title check |
| `review-evidence.yml` | PR/review/comment/schedule/dispatch | publishes the `review-evidence` status |
