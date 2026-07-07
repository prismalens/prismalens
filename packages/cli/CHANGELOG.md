# prismalens

## 0.0.2

### Patch Changes

- a336543: Harness failure containment + WSL-aware sandbox selection. A mid-run harness abort
  (e.g. deepagents killing its whole turn on one tool exception) no longer kills a
  single-branch run: the branch is respawned once in a fresh session, and if that also
  aborts, the failure becomes the branch's terminal `error` event and the reduce step
  still synthesizes a partial report from the evidence already gathered. Setup failures
  before the first event (binary missing, init handshake) still propagate. The
  investigation prompt now pins file reads/searches to the repository working directory
  (deepagents' filesystem tools follow model-supplied absolute paths outside the
  workspace root), and `deepagents-acp` is invoked with an explicit `-w <repo>` since it
  ignores the ACP `session/new` cwd. On WSL, the `auto` sandbox now floors directly as
  an expected degrade (calm info log, no per-run warning, no wasted egress probe — srt's
  bridge is unreliable under WSL in both networking modes); `--sandbox srt` still forces
  enforcement.
- Updated dependencies [a336543]
  - @prismalens/engine@0.0.2

## 0.0.1

### Patch Changes

- 0621354: First public release. The `prismalens` CLI (bins `prismalens` + `pl`) and its
  library closure — `@prismalens/engine`, `@prismalens/contracts`,
  `@prismalens/config` — publish to npm as 0.0.1 under Apache-2.0.
- Updated dependencies [0621354]
  - @prismalens/engine@0.0.1
  - @prismalens/contracts@0.0.1
  - @prismalens/config@0.0.1
