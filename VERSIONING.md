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

## Pre-releases

There is no release-candidate track: every release publishes to npm's `latest`
dist-tag. We validate against the packed tarball (`pnpm run pack`) — the
artifact users actually install — and cut the final version directly.

## 1.0.0

`1.0.0` is a deliberate stability promise, not just the number after `0.9`. Its
criteria get set when Phase 5 ("The Team Release") is in sight — not before.
Until then, treat every `0.x` as free to change.
