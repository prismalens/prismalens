/**
 * @prismalens/engine
 *
 * Tier-1 prismalens supervisor + harness adapters for the two-tier investigation
 * engine (ADR-0008). Normalises rented agent harnesses (default: deepagents) into
 * the canonical stream the UI consumes (@prismalens/contracts).
 */

export * from "./adapter/deepagents-adapter.js";
export * from "./runner/run-branch.js";
export * from "./runner/deepagents-harness.js";
