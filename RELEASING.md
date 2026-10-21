# Releasing

This file says what the release gate is and what a patch and a minor release do and do not do. Each release's Phase gate issue, filed by `.github/workflows/phase-gate.yml` from `.github/release-checklists/patch.md` or `minor.md`, tracks its own run of the gate.

## The gate
- A release publishes nothing to npm until one packed-tarball walk has passed on the release PR's base SHA. The pass is keyed to that SHA.
- release-please opens the release PR (`chore(main): release X`) but publishes nothing until it merges. So the gate blocks the release, never a merge to `main`.
- The walk is a person at their own desk trying the product from the packed tarball, with an agent guiding one step at a time. Each step is recorded as pass or fail with a screenshot or the terminal output.
- The step-by-step walkthrough is kept maintainer-side. It describes the current UI and changes with every release, so it is not part of this repository.

## How the gate works
- Anything merged to `main` moves the base SHA. Redo the CI lines under **Before the walk** on the new base.
- The walk installs the `npm-tarballs` artifact of `Pack npm tarball` on the base SHA, never a version from npm. It runs in a fresh `mktemp -d` workspace on a port other than 6473.
- `Standalone CLI` is green on every OS on the base SHA. Its `smoke-installer` job covers upgrade from the previous release, PATH, reinstall, the downgrade guard, a second `pl` on PATH and uninstall.
- `pnpm gate:side-checks` runs the scripted side checks against the tarball (see [CONTRIBUTING.md](CONTRIBUTING.md#release-gate-side-checks)).
- docs.prismalens.io describes every command, flag, env var and page the release changed, checked against the packed tarball. The site goes live after npm has the version.
- Once published, registry-mode `cross-os-smoke` runs on the released version, and a docs sweep catches renamed or retired identifiers.
- Failures are noted as the walk goes and filed together at the end. A failed step is rechecked once its fix merges.
- The transcript of the passing walk is pasted on the release PR.

## Before the walk
- [ ] The release PR's checks are green on its head, `Packed intake` included.
- [ ] `Standalone CLI` dispatched on the base (`gh workflow run standalone.yml --ref <base>`; it runs on no push).
- [ ] `Desktop` on the base. The desktop part of the walk uses its artifact.
- [ ] Docs for this release's screens merged in `prismalens/prismalens.io`.

Flaky gate checks are tracked in #742 - Release-gate CI checks pass or fail on the same commit: App boot on Windows and Packed intake.

## Patch release
In 0.x every release is a patch (`0.N.P`), whatever its commits: fixes, features and breaking changes alike. `versioning: always-bump-patch` in `release-please-config.json` holds the line ([VERSIONING.md](VERSIONING.md)).

What a patch walk does:
- Walks only the steps the release's diff changed.
- Always walks a fixed core: install, a minimal run from an alert in to an investigation out, and `pnpm gate:side-checks`.
- Carries each unchanged step forward, with git-diff evidence that its files are untouched since the walk that last passed it.
- Runs the checks in `.github/release-checklists/patch.md`: the scoped walk, registry-mode `cross-os-smoke`, the docs sweep and the findings issue.

What a patch walk does not do:
- No full walk.
- No site review, scripted live test or close-out. Those belong to a minor.

## Minor release
A minor (`0.N.0`) happens only when a maintainer changes the `always-bump-patch` line on purpose, for a phase from the milestones ([VERSIONING.md](VERSIONING.md)).

What a minor adds to a patch:
- The full walk: every step, the fixed core included. Nothing carries forward.
- The site and docs checks in `.github/release-checklists/minor.md`: reference completeness on docs.prismalens.io, the adversarial docs review, the site's claims checked against the packed artifact, re-captured imagery when the pages it shows changed, and links validated on the built site.
- A scripted live test against the packed tarball. A deterministic script, not an agent-driven run.
- The close-out: update the pinned roadmap issue, #881 - Roadmap and handoff.

## Major release
Not decided yet. VERSIONING.md: "`1.0.0` is a deliberate stability promise, not just the number after `0.9`."

## Where findings go
Each walk records its findings in one GitHub issue titled `X.Y.Z walk findings`: one checkbox per finding with its evidence, screenshots attached with `gh issue comment --attach`.

## Where this came from
The operator scoped the walk to the release in a ruling on #673 - release gate: a packed-tarball session gates every release PR. Full walks of every feature had taken about nine rounds, with 37 to 50 findings each. The release-train model behind it: a change that misses one release catches the next ([Rust 1.0 trains](https://blog.rust-lang.org/2014/12/12/1.0-Timeline/), [RFC 507](https://rust-lang.github.io/rfcs/0507-release-channels.html)), and a study of feature-based versus time-based releases ([IFIP](https://dl.ifip.org/hal-01776290v1)).
