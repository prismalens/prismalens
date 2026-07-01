/**
 * @prismalens/config/harness
 *
 * Harness backend metadata (SSOT). Maps each tier-2 harness the supervisor can
 * rent (ADR-0008) to the CLI binary it shells out to. Browser-safe: no Node.js
 * or zod dependencies.
 */

/** The tier-2 harness backends the supervisor can rent. */
export const HARNESS_IDS = ["deepagents", "claude-code", "codex"] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

/** Harness backend -> the CLI binary it shells out to. */
export const HARNESS_BINARY: Record<HarnessId, string> = {
	deepagents: "deepagents",
	"claude-code": "claude",
	codex: "codex",
};
