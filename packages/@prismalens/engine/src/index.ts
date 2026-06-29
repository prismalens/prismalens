/**
 * @prismalens/engine
 *
 * Tier-1 prismalens supervisor + harness adapters for the two-tier investigation
 * engine (ADR-0008). Drives rented agent harnesses (default: deepagents over ACP)
 * and normalises their native event streams into the canonical stream the UI
 * consumes (@prismalens/contracts).
 */

export * from "./adapter/acp-adapter.js";
export * from "./runner/acp-client.js";
export * from "./runner/run-branch.js";
