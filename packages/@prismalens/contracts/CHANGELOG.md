# @prismalens/contracts

## 0.1.0

### Minor Changes

- 6bbc048: New `llm_call` canonical event records each tier-1 model call (phase, model, token usage, latency, outcome + failure cause), and the Claude Code harness result's cost/usage accounting (`total_cost_usd`, `usage`, `modelUsage`, `num_turns`, `duration_ms`) is now captured on `branch_done` instead of discarded (#162).

### Patch Changes

- Updated dependencies [4636c9c]
- Updated dependencies [4636c9c]
  - @prismalens/config@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [a79f5ef]
- Updated dependencies [f9dfc13]
  - @prismalens/config@0.1.0

## 0.0.1

### Patch Changes

- 0621354: First public release. The `prismalens` CLI (bins `prismalens` + `pl`) and its
  library closure — `@prismalens/engine`, `@prismalens/contracts`,
  `@prismalens/config` — publish to npm as 0.0.1 under Apache-2.0.
- Updated dependencies [0621354]
  - @prismalens/config@0.0.1
