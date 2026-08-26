---
"prismalens": patch
---

feat(release): RC/prerelease machinery via changesets pre mode (issue #329: "release: build and exercise RC/prerelease machinery — `changeset pre enter` has never been run")

- Support publishing to `rc` (and other prerelease) dist-tags in `scripts/pack-cli.mjs` via `--tag <tag>` argument or automatic detection from `.changeset/pre.json` / package version prerelease identifier.
- Support Changesets pre mode release PRs in `scripts/validate-changesets.mjs` by validating consumed changesets tracked in `.changeset/pre.json` alongside deleted changesets.
- Add test coverage for pre-mode release PRs in `scripts/validate-changesets.test.mjs`.
- Document the end-to-end Changesets pre mode and RC publishing workflow with worked terminal transcript in `CONTRIBUTING.md`.
