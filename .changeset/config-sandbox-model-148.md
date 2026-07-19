---
"prismalens": minor
---

cli/config: normalize key casing, close the `serve` sandbox parity gap, and split the
harness/reduce model knobs (#180, #148 items 8-11).

- **Config key casing (item 8):** `telemetry` keys are now snake_case
  (`prometheus_url`, `alertmanager_url`, `api_url`) to match every other config key.
  No back-compat aliases (dev phase) — update your `prismalens.config.yaml`.
- **`serve` `--sandbox` parity (item 9):** the JSON-RPC `investigate` method now accepts
  `sandbox` (validated against the sandbox modes; invalid ⇒ a JSON-RPC error, never a
  silent floor) and `maxTurns`, matching the `investigate` command's `--sandbox` /
  `--max-turns` (ADR-0020).
- **`agent.model` split (item 11):** `agent.model` now sets the Tier-2 HARNESS model
  only; the Tier-1 reduce model is `synth.model` (ADR-0013/0016). `agent.model` no
  longer falls back into the reduce call, so a harness on one provider can't misroute
  the reduce call to another.
