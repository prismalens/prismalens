/**
 * @prismalens/config/harness
 *
 * Harness registry (SSOT, ADR-0017). Each tier-2 harness the supervisor can rent
 * (ADR-0008) is described here: the CLI binary, the transport, whether its model id
 * needs a provider prefix, and — crucially — the HONEST guarantee its read-only
 * posture actually provides. The registry drives the per-harness config UX in the
 * CLI + app and selects the runner/adapter. Browser-safe: no Node.js or zod.
 */

/** The tier-2 harness backends the supervisor can rent. */
export const HARNESS_IDS = ["deepagents", "claude-code", "codex"] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

/** How prismalens drives the harness. */
export type HarnessTransport = "acp" | "agent-sdk" | "subprocess-jsonl";

/**
 * The guarantee a harness's read-only realization ACTUALLY provides (ADR-0017 §4 —
 * "honest fidelity"). We report this per run so the user sees what was guaranteed,
 * not just what they asked for:
 *  - `enforced`    — a hard programmatic/OS gate (Claude deny-list/canUseTool; codex sandbox)
 *  - `cooperative` — honoured only if the model complies (deepagents auto-approve today)
 *  - `advisory`    — prompt-only, no mechanism
 */
export type PermissionFidelity = "enforced" | "cooperative" | "advisory";

/** Everything the platform needs to know about a rentable harness. */
export interface HarnessDescriptor {
	id: HarnessId;
	/** Human label for the config UX. */
	label: string;
	/** CLI binary the harness shells out to. */
	binary: string;
	transport: HarnessTransport;
	/**
	 * Prefix applied to the BARE `agent.model` id before handing it to this harness
	 * (deepagents wants `openai:`); null when the harness takes the bare id. Fixes
	 * the `openai:openai:` overload — `agent.model` is canonical-BARE everywhere.
	 */
	modelPrefix: string | null;
	/** The guarantee the DEFAULT read-only posture achieves on this harness. */
	readOnlyFidelity: PermissionFidelity;
	/** One-line description of HOW read-only is realized (shown in doctor/UI). */
	readOnlyMechanism: string;
	/** Wired end-to-end today? (codex is a reserved slot — ADR-0017 §5.) */
	implemented: boolean;
}

/** The registry — the single source of truth for harness capabilities. */
export const HARNESS_REGISTRY: Record<HarnessId, HarnessDescriptor> = {
	deepagents: {
		id: "deepagents",
		label: "deepagents (ACP)",
		binary: "deepagents",
		transport: "acp",
		modelPrefix: "openai:",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism:
			"ACP session/request_permission auto-approved (prompt-only); enforce with -S / --sandbox",
		implemented: true,
	},
	"claude-code": {
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		binary: "claude",
		transport: "agent-sdk",
		modelPrefix: null,
		readOnlyFidelity: "enforced",
		readOnlyMechanism:
			"Agent SDK disallowedTools deny-list (Edit/Write/MultiEdit/NotebookEdit) + permissionMode",
		implemented: true,
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex",
		transport: "subprocess-jsonl",
		modelPrefix: null,
		readOnlyFidelity: "enforced",
		readOnlyMechanism: "OS sandbox (seccomp/landlock) — not yet wired",
		implemented: false,
	},
};

/** Harness backend -> the CLI binary it shells out to (derived from the registry). */
export const HARNESS_BINARY: Record<HarnessId, string> = {
	deepagents: HARNESS_REGISTRY.deepagents.binary,
	"claude-code": HARNESS_REGISTRY["claude-code"].binary,
	codex: HARNESS_REGISTRY.codex.binary,
};

/**
 * The single posture dial (ADR-0017): prismalens does not build a permission policy
 * engine — it exposes this one dial, translates it to each harness's native config,
 * and reports the HONEST fidelity that resulted (see `resolvePermissionOutcome`).
 */
export const PERMISSION_MODES = [
	"read-only",
	"supervised",
	"auto",
	"dangerous",
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** The resolved permission fidelity for a given harness + posture (ADR-0017 §4). */
export interface PermissionOutcome {
	mode: PermissionMode;
	fidelity: PermissionFidelity;
	mechanism: string;
}

/**
 * Resolve the HONEST fidelity a harness delivers for a posture (ADR-0017 §4). Pure —
 * ignores any harness `native` passthrough. `read-only`/`supervised` defer to the
 * registry's read-only guarantee for this harness; `auto`/`dangerous` apply no
 * read-only floor and are always `advisory`.
 */
export function resolvePermissionOutcome(
	harnessId: HarnessId,
	mode: PermissionMode,
): PermissionOutcome {
	const registry = HARNESS_REGISTRY[harnessId];
	if (mode === "read-only" || mode === "supervised") {
		return {
			mode,
			fidelity: registry.readOnlyFidelity,
			mechanism: registry.readOnlyMechanism,
		};
	}
	return {
		mode,
		fidelity: "advisory",
		mechanism:
			mode === "dangerous"
				? "full access — no restrictions applied"
				: "writes auto-accepted — no read-only floor",
	};
}
