# prismalens — domain context

Project-specific vocabulary for the two-tier investigation engine. Used by architecture
reviews and the grilling loop so deepened modules are named consistently. Decisions live
in the mage hub (`prismalens-docs-hub`, project `prismalens-platform`) ADRs — this file
only sharpens the words those ADRs use. Where a term refines an ADR, it says so.

## Language

### Engine tiers

**Supervisor**:
Tier-1. Our own, thin, deterministic orchestrator (decompose → fan-out → reduce). No ReAct
loop. Drives harnesses and synthesizes the report. (ADR-0008)
_Avoid_: orchestrator-agent, controller, manager.

**Harness**:
The rented Tier-2 agent that actually performs an investigation through its own
shell. (ADR-0008)
_Avoid_: agent (too generic), executor, worker.

**Branch**:
One harness run — one decomposed slice of the investigation. The supervisor runs N and
reduces. Today N=1.
_Avoid_: task, job, thread.

### Harness integration — the load-bearing distinction

**Modality**:
*How* a harness is integrated — the transport + adapter family, not the agent itself. Exactly
two: **ACP** and **native-SDK**. The agent is chosen *within* a modality.
_Avoid_: backend, provider, protocol (when you mean the whole integration).

**ACP harness**:
A harness driven over the Agent Client Protocol (JSON-RPC over stdio). **One** ACP client +
**one** ACP adapter serve **many** ACP-compatible agents — deepagents is the first. Adding a
new ACP agent is **config, not code** (a binary + model + flags). Flat (path = []). (refines
ADR-0008)
_Avoid_: deepagents-harness (deepagents is one ACP agent, not the modality).

**Native-SDK harness**:
A harness driven through its own vendor SDK, used when that SDK exposes functionality its ACP
client doesn't. **One bespoke runner + adapter per agent.** Claude Code via the Claude Agent
SDK is the first (deep: `parent_tool_use_id` → subagent tree). Each new SDK harness is **new
code**, deliberately divergent. (refines ADR-0008)
_Avoid_: "Claude Code modality" (Claude Code is an agent in the SDK modality, not a modality).

**Adapter**:
The module that normalizes a harness's native event stream into **canonical events**. One per
modality-or-agent: the ACP adapter (shared across ACP agents) and one SDK adapter per SDK
agent. (Distinct from the architecture-glossary "adapter" = a thing satisfying a seam.)
_Avoid_: normalizer, mapper, translator.

### Output

**Canonical event**:
The single normalized event shape every adapter emits (`agent_step` / `tool_result` /
`branch_done` / `error` / `report`). The seam between any harness and every consumer
(CLI, JSON-RPC, UI). Lives in `@prismalens/contracts`.
_Avoid_: stream event, message, update.

**Ordered-evidence report**:
The RCA output — hypotheses ordered by array position with discrete status, **no numeric
confidence**. (ADR-0002)
_Avoid_: confidence score, ranking, RCA result.

## Flagged ambiguities

- **"ACP vs Claude Code" is wrong framing.** The axis is **ACP modality vs native-SDK
  modality**. deepagents is the first *ACP agent*; Claude Code is the first *SDK agent*. Future
  ACP agents share the ACP adapter (config-only); future SDK agents each get a bespoke adapter.
- **"Harness" vs "agent".** A harness is an agent *as the supervisor integrates it* (modality +
  config). The same underlying agent could in principle be reached via either modality.

## Example dialogue

> **Dev:** Is adding Codex a new adapter?
> **Expert:** Depends on the modality. If we drive Codex over ACP, it's a new **ACP harness** —
> just a registry entry (binary + model), no new adapter; it reuses the ACP adapter. If Codex's
> own SDK gives us more, it's a **native-SDK harness** — a bespoke runner + SDK adapter, new
> code, like Claude Code.
> **Dev:** So deepagents and Claude Code aren't the same kind of thing?
> **Expert:** Right. deepagents is one **ACP agent** behind the shared ACP adapter. Claude Code is
> an **SDK agent** with its own adapter. Both reduce to the same **canonical event** stream the
> supervisor reads — that's the seam that makes them interchangeable to Tier-1.
