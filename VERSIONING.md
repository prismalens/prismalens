# Versioning

prismalens is pre-1.0. Versions use semver's shape, but read against the
[roadmap](ROADMAP.md) — they track *which phase shipped*, not a stability
promise.

## 0.x

- **Minor (`0.N.0`)** — a phase release from the [roadmap](ROADMAP.md). Each
  phase ships as one minor: `0.1.0` is Phase 1, "The 3 AM Release". The next
  phase is the next minor.
- **Patch (`0.N.P`)** — fixes and small corrections landed between phases, in a
  package that's already been released.

Every change to a publishable package carries a
[changeset](CONTRIBUTING.md#releases-and-package-publishing) — `minor` for a
feature, `patch` for a fix. The release workflow batches pending changesets into
one version PR; merging it publishes the bump.

## Pre-releases

**Not yet wired — planned.** There is no release-candidate track today; every
release publishes to npm's `latest` dist-tag. Pre-1.0 with no external RC
consumers, we validate against the packed tarball (`pnpm pack`) — the artifact
users actually install — and cut the final version directly.

When a phase first genuinely needs live validation before it's final, we'll add
it then: Changesets' [pre mode](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)
(`-rc.N`) **plus** publishing under the `next` dist-tag (`pnpm publish --tag next`)
so a candidate never lands on `latest`. Until that's wired, do **not** run
`changeset pre enter` — an RC would publish straight to `latest`.

## 1.0.0

`1.0.0` is a deliberate stability promise, not just the number after `0.9`. Its
criteria get set when Phase 5 ("The Team Release") is in sight — not before.
Until then, treat every `0.x` as free to change.
