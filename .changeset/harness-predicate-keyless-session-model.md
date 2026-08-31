---
"prismalens": patch
---

One harness-run predicate for keyless providers, signed-in CLI sessions, and model passing (#519, #525, ADR-0031).

- **Keyless providers admitted (#519).** Local Ollama and custom endpoints declaring `requiresApiKey: false` now satisfy the harness gate's `api-key` route for `deepagents` without demanding a key.
- **Signed-in CLI session auto-selection (#525).** Removed provider pre-filtering in auto-selection so a signed-in Claude Code CLI session (`cli-session` route) is selected regardless of the active synthesis provider.
- **Harness-scoped model injection (#525).** Top-level harness request `model` is passed only when the active provider is one the selected harness speaks, preventing foreign model IDs (e.g. `gpt-...`) from being handed to Claude Code.
