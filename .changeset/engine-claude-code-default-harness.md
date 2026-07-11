---
"@prismalens/engine": minor
---

`claude-code` is now the default harness, replacing `deepagents` (ADR-0021's hero-harness lane). Harness runner construction moves off a hardcoded switch onto an engine-side `HARNESS_RUNNERS` map — the single source of truth for how each harness's runner is built — while the data-only registry keeps describing what each harness can do. The three harness errors (unknown id, not implemented, no runner wired) are unchanged, and `deepagents` stays selectable via config or `--harness`.
