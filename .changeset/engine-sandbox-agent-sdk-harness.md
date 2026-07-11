---
"@prismalens/engine": minor
---

The Claude Code (Agent-SDK) harness now spawns through the engine's `Sandbox` port, so every Claude Code investigation runs inside at least the process-isolation floor — the same caller-owned lifecycle the ACP path already uses (ADR-0020, "floor always on"). The transport honors `sandbox` and resource `limits` config (the old guard that rejected sandboxing for `agent-sdk` is gone), and `RunFidelity.sandbox` is now reported for Claude Code exactly as it is for ACP.
