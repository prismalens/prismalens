# prismalens — domain context

The words the investigation engine uses, so modules and reviews name things the same way.

**Supervisor**: our thin, deterministic orchestrator. It starts a harness, reads its events and
synthesizes the report. No ReAct loop. _Avoid_: orchestrator-agent, controller.

**Harness**: a coding agent the user already runs (Claude Code, Codex, OpenCode, Gemini CLI),
as the supervisor drives it to perform one investigation in its own shell. _Avoid_: executor, worker.

**Branch**: one harness run, one slice of an investigation. Today an investigation has one.
_Avoid_: task, job.

**ACP**: the Agent Client Protocol (JSON-RPC over stdio). Every harness is driven over ACP, through
one client and one adapter (`packages/@prismalens/engine/src/adapter/acp-adapter.ts`). Adding an
ACP agent is a registry entry, not new adapter code.

**Adapter**: the module that turns a harness's ACP stream into canonical events.
_Avoid_: normalizer, mapper.

**Canonical event**: the one event shape every consumer (CLI, API, UI) reads: `agent_step`,
`tool_result`, `branch_done`, `error`, `report`. Defined in `@prismalens/contracts`.
_Avoid_: stream event, update.

**Ordered-evidence report**: the investigation's output, `ModelReportSchema` in
`packages/@prismalens/contracts/src/schemas/investigation.ts`. Hypotheses are ordered by array
position with a discrete status, never a numeric confidence. _Avoid_: confidence score, ranking.
