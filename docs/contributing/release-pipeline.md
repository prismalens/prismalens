# Release pipeline

The mechanics behind a release. What a release manager does is in [RELEASING.md](../../RELEASING.md).

## What publishes

Three packages publish to npm: `prismalens` (the CLI), `@prismalens/agent-adapters` and `@prismalens/agent-host`. The other first-party libraries are `private: true` and bundled into the CLI tarball (#193). The last two publish by hand.

[release-please](https://github.com/googleapis/release-please) versions and publishes the CLI (`release-please-config.json`, `.github/workflows/release.yml`), driven by conventional-commit titles on `main`, with no changesets. The one prerelease is the nightly (RELEASING.md section 6).

## The flow

1. On push to `main`, release-please reads the conventional-commit titles and opens or updates a draft release PR (`draft-pull-request`) with the version and changelog. `CI gate` is red on purpose while it is a draft, so it cannot merge before a run on its own head. It runs only while the repository variable `RELEASE_ENABLED` is `true`.
2. Merging that PR runs the release draft-first, in one `release.yml` run, because the repository has immutable releases on and GitHub refuses any upload to a published release (#717):
   1. release-please creates the tag and a draft release (`draft` and `force-tag-creation` in `release-please-config.json`; a draft has no tag without the forced one).
   2. `build-standalone-cli.yml` and `build-desktop-app.yml`, called with the tag, attach the archives, SBOM, `install.sh`, `install.ps1` and desktop zips to the draft.
   3. The `sums` job writes one `SHA256SUMS` over every asset and one build-provenance attestation over it, then uploads `SHA256SUMS`.
   4. `publish-release` makes the release public, which makes it immutable.
   5. `npm` packs the launcher with `scripts/pack-launcher.mjs`, which refuses unless the public release downloads anonymously, complete and matching its `SHA256SUMS`, then publishes it with npm trusted publishing (OIDC) and `NPM_CONFIG_PROVENANCE=true`, so a publish without provenance fails. It runs after the release is public because the in-app update notice reads `releases/latest`.
   6. The Homebrew tap and Scoop bucket are updated from the published `SHA256SUMS`, failing when `PACKAGE_MANAGERS_TOKEN` is unset, then installed from on macOS and Windows runners.
3. Publishing the release with `RELEASE_PAT`, so the event reaches other workflows, also starts the registry-mode `cross-os-smoke` run against that version.

A hand-run `gh workflow run release.yml -f tag=<tag>` refuses a release that is not a draft. A version older than the latest release goes to npm under the `previous` dist-tag, unmarked as latest, and leaves the tap and bucket alone.

### When a job fails

For a `v0.5.3` release whose previous version is `0.5.2`:

| Job that failed | GitHub release | npm `latest` | Finish it with |
| :--- | :--- | :--- | :--- |
| `release-please`, after the tag and draft | draft, no assets | `0.5.2` | `gh workflow run release.yml -f tag=v0.5.3`; a re-run finds the release and builds nothing |
| Any job from `Resolve the draft release` through `Publish the release` | draft, some or all assets | `0.5.2` | **Re-run failed jobs**; an upload to a draft replaces what is there |
| `Publish to npm` | published, immutable | `0.5.2`, or `0.5.3` if the publish went through | **Re-run failed jobs**; npm is skipped when the version is already on it |
| The tap and bucket update, or the installs from them | published, immutable | `0.5.3` | **Re-run failed jobs**, once the tap or bucket has the new version; the update reads the published `SHA256SUMS` |

## Versions and tags

Every release is a patch: `versioning: always-bump-patch` in `release-please-config.json` holds the line whatever the commit types. A minor means changing that line on purpose. To force one specific version, set `"release-as": "<version>"` on the `"."` package entry and remove it once that version publishes. A `Release-As:` commit footer does not work here: squash commits end with attribution lines, and release-please reads footers only from the last paragraph.

Tags are `v<version>` from 0.5.0 on, `prismalens@<version>` before.

The release PR is created with the `RELEASE_PAT` repository secret, not the default `GITHUB_TOKEN`: the repository forbids Actions from creating PRs, and a PR opened with `GITHUB_TOKEN` never triggers CI.

## What each release artifact carries

A gate fails the PR or the release when an artifact misses its standard (#906):

| Artifact | Standard | Gate |
| :--- | :--- | :--- |
| npm `prismalens` | `files` allowlist, npm provenance, copied (not bundled) first-party tree (#237) | `scripts/check-artifact.mjs`, publint on the packed manifest, and a second pack that must match byte for byte, in `ci.yml` |
| npm `@prismalens/agent-adapters` | one esbuild file per adapter, licence texts of everything inlined | `bundle.test.mjs`, `check-artifact.mjs`, publint |
| Standalone archives (5) | the npm global tree relocated and pruned; Node is the binary and its LICENSE | `check-artifact.mjs` on every target, a PowerShell 5.1 install and a Scoop install with long paths off on Windows |
| `install.ps1`, `install.sh` | `.ps1` is ASCII only and `.sh` UTF-8, both without a BOM, because `iex` reads the body as text | `scripts/install/encoding.test.mjs` |
| Desktop zips | asar, unsigned (#697) | `packages/desktop/scripts/check-release-paths.mjs` |
| Every release asset | one `SHA256SUMS` and one build-provenance attestation | the `sums` job in `release.yml` |
| SBOM | CycloneDX from `npm sbom` over the linux-x64 app tree | `build-standalone-cli.yml` |

`scripts/artifact-budgets.json` holds bytes and files per artifact and unpacked size per desktop OS. A breach prints the five largest unpacked files. A breach is fixed by shrinking the artifact; raising a budget needs the reason in the PR.

### The Windows path limit

The limit is 260 - 40 = **220** characters for a 20-character username, on every Windows prefix an artifact lands under: the npm global prefix, the installer's `%LOCALAPPDATA%\prismalens\runtime\<v>\`, and Scoop, which unpacks the whole archive into `_tmp` first. The deepest path is a migration folder name in the database package (#335), so a longer name fails the PR that adds it once the headroom is spent. `check-artifact.mjs` prints the installer and Scoop lengths against 220, and checks a zip on Windows only.

## Publishing the packages by hand

Both publish with npm provenance from a dispatch workflow: `publish-agent-adapters.yml` and `publish-agent-host.yml`. The adapters' pins move with the agent registry, not with a CLI release; the host publishes when a consumer needs a new version (#916).

To inspect the adapters tarball locally, run `pnpm --filter @prismalens/agent-adapters pack:npm`; it writes the tarball under the package's gitignored `dist-pack` directory. The build bundles each pinned adapter into one ESM file and records what it inlined in `dist/adapters/bundled.json`. `@anthropic-ai/claude-agent-sdk` is not inlined, because its licence is not permissive: it ships as the one `bundleDependency`, so installing the package never downloads an agent binary.

## Gate side checks and the upgrade chain

`pnpm gate:side-checks [--tarball <path>] [--only <checks>] [--no-skip]` scripts the walk's side checks against a tarball, or packs the built CLI when none is given: telemetry and its off switches, the update notice, the workspace lock, reset racing an investigation, the Host allowlist when pairing, and `pl upgrade` through a local registry; on Linux also the trial rollback under `pl service`.

- Each check runs in its own throwaway HOME, workspace and port, with an agent-free PATH and the fake ACP agent; PostHog and GitHub requests go to a local stub.
- A SKIP fails the run under `--no-skip`, which CI passes.
- `rollback` is N/A off Linux, because the trial runs under systemd, and skipped on Linux without a systemd user manager or when a `prismalens.service` exists.
- `Gate side checks` in `proofs.yml` runs them on the three OSes nightly, on a release PR, on a PR that touches packaging or the gate scripts, and on a PR labelled `full-ci`.

`pnpm gate:upgrade-chain <dir-with-tarball>` is the chain behind `Packed upgrade smoke`. It runs a local registry that proxies npm and carries the tarball, installs the oldest stable release from 0.5.0 on, and upgrades it release by release to the tarball with each release's own `pl upgrade`, booting after every hop and checking that an incident written by the oldest release survives. The oldest release also upgrades straight to the tarball.

`Standalone CLI` runs the same chain over the installer channel: each old install runs its own `pl upgrade --version <build under test>`, with https://prismalens.io/install.sh served from this checkout. On Windows the installer script is re-run, because `pl upgrade` there fetches it with `irm`.
