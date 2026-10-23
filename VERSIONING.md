# Versioning

prismalens is pre-1.0. Versions use semver's shape, but read against the pinned
[Roadmap and handoff](https://github.com/prismalens/prismalens/issues/881) issue,
which says which theme each piece of work belongs to and which release holds it.
They are not a stability promise.

## 0.x

Every release bumps the patch (`0.N.P`), whatever its commits: fixes, features
and breaking changes alike. `versioning: always-bump-patch` in
`release-please-config.json` holds the line;
[release-please](https://github.com/googleapis/release-please) reads the
conventional-commit titles on `main` for the changelog and opens a release PR,
and merging that PR publishes the bump. A minor (`0.N.0`) happens only when a
maintainer changes that line on purpose, for a phase from the
[GitHub milestones](https://github.com/prismalens/prismalens/milestones) (see
[CONTRIBUTING.md](CONTRIBUTING.md#releases-and-package-publishing)).

## Alpha

prismalens is alpha. Any 0.x release, patch included, may change behaviour or
break a workflow. Read the
[release notes](https://github.com/prismalens/prismalens/releases) before you upgrade.

## Channels

Every release goes out on all of these at once:

- **npm**: the `latest` tag.
- **Install scripts**: `install.sh` and `install.ps1`, attached to each GitHub
  Release with the archives they download and `SHA256SUMS`.
- **Homebrew** (`prismalens/tap`) and **Scoop** (`prismalens/scoop-bucket`).
- **Desktop**: unsigned preview zips attached to each GitHub Release. Signed
  installers are #697.

There is no release-candidate track: release-please publishes straight to
`latest`, and each release is validated against the packed tarball
(`pnpm run pack`) first. There is no nightly channel either. Migrations are
append-only, so a nightly would ship every merged migration to real databases,
and a stable build refuses a database a nightly has migrated past it.

docs.prismalens.io describes the version `latest` installs: docs merged ahead
of a release go live when that release publishes.

## 1.0.0

`1.0.0` is a deliberate stability promise, not just the number after `0.9`. Its
criteria get set when Phase 5 ("The Team Release") is in sight — not before.
Until then, treat every `0.x` as free to change.
