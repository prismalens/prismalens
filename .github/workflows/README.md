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

`claude-code-review.yml` is the case most likely to be misread. It produces review
evidence, but it holds neither `statuses: write` nor `checks: write` — its `marker`
job posts a *comment*, and `review-evidence.yml` decides whether that comment counts.
Producing evidence and publishing a required check are two different privileges, and
only the second one is dangerous. Keep them separate.

That file carries a second split for the same reason, one level down. Its `review`
job runs the model on a **read-only** token; its `marker` job holds the only write,
runs no model, and reads nothing from the PR but its head SHA. So a prompt injected
into a reviewed diff reaches a job that cannot post anything the gate trusts. The
`marker` job additionally refuses to mint unless the reviewer demonstrably posted at
that head — a job succeeding is not evidence that it did anything.

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
| `claude-code-review.yml` | `pull_request` | reviews every PR, then mints the marker `review-evidence` branch D reads |
| `claude.yml` | `@claude` mentions | labour tool; **never** mints evidence |
| `review-admit.yml` | `pull_request` on high-risk paths, dispatch | applies `review-ready`, admitting the scarce online review |
| `pr-title.yml` | `pull_request_target` | conventional-commit title check |
| `review-evidence.yml` | PR/review/comment/dispatch | publishes the `review-evidence` status |

## How `review-evidence` goes green

Four branches, each keyed to the current head SHA (or a patch-identical earlier
commit — see `CARRY_FORWARD` in the script):

| | Evidence |
| --- | --- |
| **B1** | the PR is bot-authored (Dependabot); `CI gate` applies separately |
| **B2** | the PR is a generated release PR — same-repo **and** branch **and** title |
| **A** | a formal review by `coderabbitai[bot]` |
| **D** | a marker from `claude-code-review.yml`'s `marker` job, validated by looking up the run it cites |

**`claude[bot]` is not an allowlisted reviewer, and must not become one.** That
login is an app installation shared by `claude-code-review.yml` and `claude.yml`,
so a post carrying it does not establish which workflow produced it — anyone who
can comment `@claude` could otherwise mint evidence. Branch D exists precisely to
close that: the marker is authored by `github-actions[bot]` from a job that runs
no model, and the publisher re-derives the run's workflow file, head SHA and
conclusion rather than trusting the marker's text.

**On high-risk paths (`.github/high-risk-paths.txt`), branch D is not enough.**
Those PRs need `coderabbitai[bot]` evidence specifically — an independent
reviewer sharing no model, prompt or failure mode with the lane under review.
`review-admit.yml` labels them automatically; the publisher enforces it, because
a label can be removed and a PR-branch workflow can be tampered with while the
publisher runs from the default branch.

**A green job is never evidence.** Three separate times on the #301 track a
review job reported success having posted nothing at all. Only a posted artifact,
and for Claude only a marker backed by its run, counts.
