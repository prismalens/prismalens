# Workflows

Each workflow file's header comment says what it is for and when it runs. This file holds what the YAML cannot say: what blocks a merge, what a contributor must keep true when editing a workflow, what a workflow needs from the repository settings, and how to run the things people run by hand.

## The merge gate

Ruleset `18441175` on `main` is the authority. Edit it with `gh api repos/prismalens/prismalens/rulesets/18441175`; no file in the tree declares it, so none can go stale. It requires:

| Required check | Published by |
| --- | --- |
| `CI gate` | `ci.yml`, job `ci-gate` |
| `Validate PR title (conventional commits)` | `pr-title.yml`, job `validate` |

It also sets `required_review_thread_resolution: true`: an unresolved review thread blocks the merge button with no workflow in the path. Nothing else blocks a merge, however red it looks.

- `CI gate` fails unless every job it `needs` succeeded, and accepts a skipped job only where `scripts/ci-plan.mjs` says `false` for that job's tier. When red, it labels each failed job `failed`, `timed out`, `never started` or `cancelled mid-run` (`scripts/ci-gate-report.mjs`), and says when `gh run rerun --failed` is enough.
- A red gate means the code is wrong, never that a free model was slow or refused (#884): no job spends a model call (#914).
- `strict_required_status_checks_policy` is `false`. With many PRs open, strict would make every merge invalidate the rest; the push run on `main` is the backstop for two green PRs that break `main` together.
- There is no merge queue in the ruleset (#1023): a PR can merge without a run on top of current `main`. `ci.yml` and `pr-title.yml` also run on `merge_group`, so a queue can be switched on without a workflow edit. A merge group plans like a push to `main`: the PR tiers, not the network-bound proofs. `pr-title.yml` passes there with its title step skipped.
- A check that must block a merge joins `CI gate`'s `needs`. A separate workflow file is advisory, because the ruleset requires only the two contexts above. Prefer a native GitHub rule to a workflow that emulates one.

## What a CI run runs

The `changes` job runs `scripts/ci-plan.mjs`, whose header lists the tiers (`skip`, `code`, `e2e`, `intake`, `full`, `agents`, `defer`, `draft`) and what turns each on. The tier outputs gate the jobs in `ci.yml`; `CI gate` waits on all of them.

- Turbo's graph (`turbo ls --affected`) decides a package's tiers, so a new package needs no list. A path outside every package that `OUTSIDE` in `scripts/ci-plan.mjs` does not name turns every tier on, and so does a failed turbo call. A renamed file counts under both its names.
- The `full-ci` label is read at the next push or re-run. To run the proofs on a branch without a release PR: `gh workflow run nightly.yml --ref <branch>`.
- A draft release PR plans `defer`: nothing runs and `CI gate` is red on purpose until the PR is marked ready, which starts the run.
- A draft PR plans `draft`: `lint`, `build` and the ubuntu `test` run; `e2e`, the tarball jobs, `test-later` and `proofs` do not, and `CI gate` allows exactly those skips; marking it ready plans the rest. A draft run's plan job is named `Plan (draft)`; `scripts/ci-plan.mjs` never counts such a run as an earlier pass, so a green draft proves nothing for a ready PR.
- A PR check shows the job's `name:`; `needs:` uses the job id. Every check that runs the packed tarball starts with `Tarball:`.
- One build per run (#885): `build` saves turbo's cache under `turbo-<os>-<sha>`; `test`, `pack` and `e2e` restore it. `cli-smoke-cross-os.yml` waits for `Pack npm tarball` on the same commit and installs that artifact, packing itself only if the job is missing or red.
- `ci-rerun-unstarted.yml` reruns a failed `CI`, `Standalone CLI build` or `Nightly` run once, when its only red jobs never got a runner or failed on a network fault their log names.

## `e2e-browser.yml`

The suite runs as 4 shards, each on its own runner with its own stacks, within a 15-minute limit. A test tagged `@quarantine` leaves the `chromium` and `journeys` projects and runs on shard 1 under `continue-on-error`. `e2e-browser-mobile.yml` runs the `@responsive` journeys nightly and by hand, never on a PR.

## `nightly.yml`

- The schedule does nothing until the repository variable `NIGHTLY_ENABLED` is `true`. Publishing the nightly prerelease needs `NIGHTLY_PUBLISH` (RELEASING.md, "Nightly").
- Its `report` job keeps one issue titled `Nightly CI failing`, found by that exact title: a red night opens or rewrites it, a recurrence reopens it, a green night closes it. A cancelled or skipped `proofs` run and a failed `Live:` job count as red. On dispatch `report` only prints what it would do unless its input is on.
- The `Live:` jobs check that the pinned OpenCode and its own free model still complete an investigation, with no secret (#1085). The intake passes on 2 valid reports of 3, then one run cut off by a restart must resume. They run every scheduled night and on dispatch with `live`; the agent version is the pin in `scripts/agent-pins.json`, not the latest release (#639, #712).
- Release gate: dispatch on `main`, not on a PR branch, with `ref` set to the release PR's base SHA, and link the run from the PR: `gh workflow run nightly.yml --ref main -f ref=<sha> -f live=true`.
- Each packed-intake attempt uploads its event stream as `intake-events-attempt-<n>`, kept 30 days.
- Agent qualification runs its 3 admissions one at a time, because each writes a probe file into the checkout. Its 3 behaviour matrices run at once on Linux only, where `/proc` lets the `cancel` row tell its own tool process from another run's (#885).

## `agent-release-watch.yml`

It probes each agent row at its channel's latest release and at its pin on Linux, Windows and macOS, and moves the pins. No job spends a model call and none is required.

- A red scheduled leg (or a dispatch with `file-issues`) opens or rewrites one issue per agent and OS titled `Agent probe failing: <agent> on <os>`.
- The `bump` job calls `gh-workflows:.github/workflows/pin-bump.yml`: a release that has been public 3 days moves its pin on one rolling pull request, `pin-bump/agents`. A pin whose probe fails is held back. The call's `sync` input refreshes the adapter SDK, the lockfile, each row's `tested` and the model list.
- `RELEASE_PAT` opens that PR so CI starts on it; a PR opened with `GITHUB_TOKEN` gets no checks.
- The pins live in `scripts/agent-pins.json` and `@prismalens/agent-adapters`.
- A pinned agent installs from its lock in `scripts/agent-locks/<agent>/` (`npm ci`, or `uv pip sync` of a hashed `requirements.lock`), the same bytes on every runner (#1154); the latest legs stay unlocked. After a pin moves, `node scripts/agent-locks.mjs regen` rewrites the locks and `check` (in `format-and-lint`) fails until it has run.

## Review is advisory; unresolved threads block

`claude-code-review.yml` and `claude.yml` are managed caller stubs: the logic lives in `gh-workflows:.github/workflows/claude-code-review.yml` and `claude.yml`, so do not add logic here. `.github/claude-review.yml` sets the lane's admission to label: only a PR labelled `claude_review` gets the Claude review. CodeRabbit is summoned by `Sumit1993/rig`'s hourly routine, and the `coderabbit_review` label is the manual override (`.coderabbit.yaml`). Any unresolved thread, from a reviewer or a human, blocks the merge.

A reviewer that posts nothing leaves a PR that merges unreviewed; the callee's `announce` job upserts one advisory comment per PR saying whether the reviewer published for that head; nothing gates on it.

- The stub's `permissions:` block is a ceiling; each callee job declares its own subset. `review` and `verify` run a model over diff text an attacker can influence and must never acquire a write: an injected prompt would then reach a job that can resolve review threads.
- Fork PRs get no secrets; the lane skips them.

## Gate-writers

No workflow in this repo holds `statuses: write` or `checks: write`; keep it that way. Required checks match by context name with no integration pin, so any workflow that can post a status named `CI gate` satisfies the gate. Adding either permission needs a decision recorded on #301.

## Editing a workflow

- Every external `uses:` is a full commit SHA with its version in a comment; `scripts/workflow-pins.test.mjs` enforces it.
- A job that could publish (a `publish` or release upload, an id-token, a reusable-workflow call) must match `scripts/workflow-publishers.json`; `scripts/workflow-publishers.mjs` fails on any change to that set.
- Set `timeout-minutes` on every job except one that calls a reusable workflow, which cannot (`scripts/workflow-pins.test.mjs`).
- `release.yml` and the two `publish-*.yml` keep their file names because npm's trusted-publisher setting names the workflow file.
- The caller stubs for `prismalens/gh-workflows` keep the names `gh-workflows:scripts/setup-repo.sh` checks for.

## Secrets and variables

| Name | Used by | Without it |
| --- | --- | --- |
| `RELEASE_PAT` | `release.yml`, `agent-release-watch.yml` | PRs they open start no CI; `release.yml` falls back to `GITHUB_TOKEN` (`docs/contributing/release-pipeline.md`) |
| `PACKAGE_MANAGERS_TOKEN` | `release.yml` | the release run fails at the Homebrew and Scoop step |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude.yml`, `claude-code-review.yml` | the lane cannot run |
| `REVIEW_TELEMETRY_URL`, `REVIEW_TELEMETRY_TOKEN` | the review stubs, `pr-state.yml`, `review-findings-sweep.yml`, `telemetry-health.yml` | review telemetry is not reported |
| `RELEASE_ENABLED`, `NIGHTLY_ENABLED`, `NIGHTLY_PUBLISH` (variables) | `release.yml`, `nightly.yml` | the release, the nightly and its publication stay off |
