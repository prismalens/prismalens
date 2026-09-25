# Versioning

prismalens is pre-1.0. Versions use semver's shape, but read against the
[GitHub milestones](https://github.com/prismalens/prismalens/milestones). They track *which phase shipped*, not a stability
promise.

## 0.x

- **Minor (`0.N.0`)**, a phase release from the [GitHub milestones](https://github.com/prismalens/prismalens/milestones). Each
  phase ships as one minor: `0.1.0` is Phase 1, "The 3 AM Release". The next
  phase is the next minor.
- **Patch (`0.N.P`)** — fixes and small corrections landed between phases, in a
  package that's already been released.

The version comes from conventional-commit titles on `main` — a `feat:` bumps
minor, a `fix:` bumps patch (see
[CONTRIBUTING.md](CONTRIBUTING.md#releases-and-package-publishing)).
[release-please](https://github.com/googleapis/release-please) computes it and
opens a release PR; merging that PR publishes the bump.

## Alpha

prismalens is alpha. Any 0.x release, patch included, may change behaviour or
break a workflow: release-please bumps the patch for every release between
phases (`always-bump-patch`), breaking changes too. Read the
[release notes](https://github.com/prismalens/prismalens/releases) before you upgrade.

## Channels

- **`latest`** on npm: every release.
- No release-candidate track: 0.5.0's `rc` builds came from the retired
  changesets flow, and release-please publishes straight to `latest`. We
  validate against the packed tarball (`pnpm run pack`) before a release.
- **Desktop**: unsigned preview zips attached to each GitHub Release from
  0.5.1. Signed installers and package managers are #697.

There is no nightly channel yet. Migrations are append-only, so a nightly would
ship every merged migration to real databases, and a stable build refuses a
database a nightly has migrated past it.

docs.prismalens.io describes the version `latest` installs: docs merged ahead
of a release go live when that release publishes.

## 1.0.0

`1.0.0` is a deliberate stability promise, not just the number after `0.9`. Its
criteria get set when Phase 5 ("The Team Release") is in sight — not before.
Until then, treat every `0.x` as free to change.
