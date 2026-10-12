# @prismalens/agent-adapters

The ACP adapters PrismaLens ships so that an installed `claude` or `codex` is all a user needs. See https://prismalens.io.

## Published package

`pnpm --filter @prismalens/agent-adapters pack:npm` builds the npm tarball. It bundles the pinned adapters without their optional native agent copies, so an install of the package, or of anything that depends on it, never downloads an agent binary. Each adapter runs the user's own `claude` or `codex`. The tarball carries the licence texts of the adapters and the agent libraries they load, under `THIRD_PARTY_LICENSES/`.

The `Publish agent adapters` workflow publishes it by hand, with npm provenance.
