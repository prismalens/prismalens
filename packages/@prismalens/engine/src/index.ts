/**
 * @prismalens/engine
 *
 * Tier-1 prismalens supervisor + harness adapters for the two-tier investigation
 * engine (ADR-0008). Drives rented agent harnesses (default: deepagents over ACP)
 * and normalises their native event streams into the canonical stream the UI
 * consumes (@prismalens/contracts).
 */

export * from "./adapter/acp-adapter.js";
export * from "./adapter/claude-code-adapter.js";
export * from "./config/resolve.js";
export * from "./runner/acp-client.js";
export * from "./runner/claude-code-runner.js";
export * from "./runner/acp-run-branch.js";
export * from "./supervisor/alert-source.js";
export * from "./supervisor/conductor.js";
export * from "./supervisor/investigate.js";
export * from "./supervisor/synthesize.js";
export * from "./tools/types.js";
export * from "./tools/provisioning.js";
