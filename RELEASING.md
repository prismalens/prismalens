# Releasing

What a release manager does, in order. The mechanics of the release run, artifact standards and publishing by hand are in [docs/contributing/release-pipeline.md](docs/contributing/release-pipeline.md).

## 1. Milestones
Milestones are versions, and exactly two are open: the current release and the next. When the current release PR merges:
1. Finish and close its Phase gate issue. A milestone closed before its gate issue makes `milestone-release-checklist.yml` warn on that issue.
2. Move the closed milestone's open issues to the next one, then close it.
3. Create the milestone after the next. `milestone-release-checklist.yml` files its Phase gate issue from `.github/release-checklists/patch.md`, or `minor.md` for a `0.N.0`. It skips a milestone that is not `0.Y.Z`, so a major release gets no automatic issue.

Direction by theme lives in the pinned roadmap issue, #881 - Roadmap and handoff, not in milestones.

## 2. The Phase gate issue
Each 0.x release has one Phase gate issue. Its checklist is the gate: close it last, because the milestone is not done while it is open. Findings go in that issue, or in one linked `X.Y.Z walk findings` issue with a checkbox per finding, its evidence, and screenshots attached with `gh issue comment --attach`.

## 3. The gate
- A release publishes nothing to npm until one packed-tarball walk has passed on the release PR's base SHA. The pass is keyed to that SHA.
- release-please opens the release PR (`chore(main): release X`) and publishes nothing until it merges. The gate blocks the release, never a merge to `main`.
- The walk is a person trying what CI cannot, from the packed tarball, one step at a time, recording each as pass or fail with a screenshot or the terminal output.
- Anything merged to `main` moves the base SHA. Redo the CI lines below on the new base.
- The release PR is a draft, rebuilt on every push to `main`, and its own CI waits until you mark it ready for review (#1052). Read the gate on the base SHA's `main` run; the run on the PR's head, started by "ready for review", is what lets it merge. While the PR is ready, every rebuild runs CI again; `gh pr ready <n> --undo` returns it to a draft.
- Install the `npm-tarballs` artifact of `Pack npm tarball` on the base SHA, never a version from npm. Work in a fresh `mktemp -d` directory on a port other than 6473.
- Paste the passing walk's transcript on the release PR. Recheck a failed step once its fix merges.

### Required checks
Two checks are required on `main`: `CI gate` and `Validate PR title`. `CI gate` waits on the build, type-check, lint and test jobs, the packed-tarball jobs (smoke, intake, service, upgrade smoke), the side checks on Linux, macOS and Windows, the harness admission of each agent, and `E2E`; `ci.yml` lists them. A green gate on the base SHA means all of them passed there.

Also on the base SHA, outside the gate:
- [ ] `Standalone CLI` dispatched on the base branch (`gh workflow run build-standalone-cli.yml --ref main`; `--ref` takes a branch or tag, never a SHA), with the run's head SHA equal to the base SHA (`gh run list --workflow build-standalone-cli.yml --json headSha`). Its `smoke-installer` job installs each release npm lists from 0.5.0 on and upgrades it to the candidate with its data.
- [ ] `Desktop` run on the base. The desktop part of the walk uses its artifact.
- [ ] Docs for this release's screens merged in `prismalens/prismalens.io`, describing every command, flag, env var and page the release changed, checked against the packed tarball. The site goes live after npm has the version.

What stays manual, because a runner cannot do it:
- one real, signed-in agent run per agent and per OS;
- `pl doctor`, and a private-repo clone through the real credential helper;
- the desktop window, tray and notification;
- Ctrl+C in a real terminal on Windows and macOS;
- WSL2, Tailscale and the phone, when their files changed;
- a real `irm | iex` install after publish.

After publish, the release run installs the formula and manifest it pushed from the real Homebrew tap and Scoop bucket, and fails when `PACKAGE_MANAGERS_TOKEN` is unset. Run registry-mode `cross-os-smoke` on the released version, then the docs sweep for renamed or retired identifiers.

## 4. Patch release
In 0.x every release is a patch (`0.N.P`), whatever its commits. `versioning: always-bump-patch` in `release-please-config.json` holds the line ([VERSIONING.md](VERSIONING.md)).

A patch walk:
- walks only the manual steps the release's diff changed, and carries each unchanged step forward with git-diff evidence that its files are untouched since the walk that last passed it;
- runs `.github/release-checklists/patch.md`: a green `CI gate`, the scoped manual walk, registry-mode `cross-os-smoke`, the real-tap install jobs, the docs sweep and the findings record;
- has no full walk, no site review, no scripted live test and no close-out. Those belong to a minor.

## 5. Minor release
A minor (`0.N.0`) happens only when a maintainer changes the `always-bump-patch` line on purpose, for a phase from the milestones. It adds to a patch:
- the full manual walk: every manual step, nothing carried forward;
- the site and docs checks in `.github/release-checklists/minor.md`: reference completeness, the adversarial docs review, the site's claims checked against the packed artifact, re-captured imagery where the pages changed, and links validated on the built site;
- a scripted live test against the packed tarball, a deterministic script and not an agent-driven run;
- the close-out: update #881 - Roadmap and handoff.

A major release is not decided. `1.0.0` is a deliberate stability promise, set out in [VERSIONING.md](VERSIONING.md).

## 6. Nightly
- Each night whose proofs pass, `.github/workflows/nightly.yml` publishes main's head as `<next patch>-nightly.<YYYYMMDD>.<run number>` (`scripts/nightly-version.mjs`), ordered above the newest published nightly. It is drafted as a GitHub prerelease that is never marked latest, gets the five standalone archives and `SHA256SUMS`, then publishes. `scripts/release-complete.mjs --public` then downloads it with no token and hashes every archive. A night with no new commits publishes nothing, and a re-run computes the same version and publishes the draft it finds.
- Nightlies are never on npm, which carries stable launchers only. `pl upgrade --channel nightly` switches an npm install to the newest nightly's archive, and `--channel stable` switches it back, refusing when the workspace database is newer than the target. The installers, Homebrew and Scoop stay on stable, and there is no nightly desktop build.
- `scripts/prune-nightlies.mjs` keeps the newest 10 nightly prereleases. It never deletes a stable release, a draft or a tag a published npm launcher names; `--dry-run` prints what it would delete.

Two repository variables switch it on, under Settings, Secrets and variables, Actions, Variables:
- `NIGHTLY_ENABLED` set to `true` lets the schedule run the proofs. Unset, the scheduled run skips every job and says so in its summary.
- `NIGHTLY_PUBLISH` set to `true` lets the schedule draft and publish the nightly. A dispatch on `main` with `publish` checked and no `ref` publishes once by hand.
