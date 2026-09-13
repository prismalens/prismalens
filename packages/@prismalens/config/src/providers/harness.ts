// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness registry: every harness speaks ACP over stdio (ADR 0003). A row is
 * `verified` only after the unattended CI run on a real clone passes; unverified
 * rows are shown by `pl doctor` and selectable only through PRISMALENS_HARNESS.
 */
export const HARNESS_IDS = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * Every way `resolveHarnessSelection` can refuse, and the only ones the API can
 * put in a PRECONDITION_FAILED payload. This is the single source of truth:
 * `HarnessSelectionFailure` and the contract's `HarnessSelectionFailureSchema`
 * are both derived from it, so the two cannot drift apart again. It lives here,
 * beside the registry, because this module is pure data — the selection logic
 * imports `node:fs`, and the contracts package is bundled for the browser.
 */
export const HARNESS_SELECTION_FAILURES = [
	/** PRISMALENS_HARNESS names something that is not a registry id. */
	"invalid-env-harness",
	/** A pin (env or persisted) names a real harness whose binary is absent. */
	"pinned-harness-missing",
	/** Nothing verified is on PATH. */
	"no-harness",
] as const;
export type HarnessSelectionFailure =
	(typeof HARNESS_SELECTION_FAILURES)[number];

export type PermissionFidelity = "enforced" | "cooperative" | "advisory";

/**
 * Per-run environment for the harness child. Config is isolated to what
 * prismalens generates; the user's own login and data home stay reachable
 * (ADR 0003 §2: prismalens never touches harness credentials).
 */
export interface HarnessRunEnv {
	configDir: string;
	/** Empty per-run dir a harness can be pointed at for config it would otherwise read from the user's home. */
	dataDir: string;
	cwd: string;
	/** Model id in the harness's own format, when the operator set one; otherwise the harness default. */
	model?: string;
}

export interface HarnessDescriptor {
	id: HarnessId;
	label: string;
	/** Binary looked up on PATH for detection. */
	binary: string;
	/** argv for `binary` that starts an ACP server on stdio in `cwd`. */
	acpArgs: (env: HarnessRunEnv) => string[];
	/** Env vars that point the harness at prismalens's per-run config, never the user's. */
	acpEnv: (env: HarnessRunEnv) => Record<string, string>;
	/** Files prismalens writes under configDir before the run; the harness reads nothing else. */
	configFiles?: (env: HarnessRunEnv) => Record<string, string>;
	/** One line the doctor prints when the binary is missing. */
	install: string;
	readOnlyFidelity: PermissionFidelity;
	readOnlyMechanism: string;
	/** True once the registry admission run (ACP spike, prismalens#561) is green in CI. */
	verified: boolean;
	/**
	 * Provider API-key env vars this harness actually reads from the host
	 * (ADR 0004 §5: allowlist, never `process.env`). Never a bare wildcard —
	 * each name is cited in the row's own doc pointer below.
	 */
	providerKeys?: readonly string[];
}

const READ_ONLY_MECHANISM =
	"ACP session/request_permission answered by prismalens: edit, delete and move rejected, mutating shell commands rejected";

export const HARNESS_REGISTRY: Record<HarnessId, HarnessDescriptor> = {
	opencode: {
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		acpArgs: ({ cwd }) => ["acp", "--pure", "--cwd", cwd],
		acpEnv: ({ configDir, dataDir }) => ({
			XDG_CONFIG_HOME: dataDir,
			OPENCODE_CONFIG_DIR: configDir,
		}),
		configFiles: ({ model }) => ({
			"opencode.json": JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					...(model ? { model } : {}),
					permission: { edit: "ask", bash: "ask", webfetch: "deny" },
					share: "disabled",
				},
				null,
				2,
			),
		}),
		// opencode resolves ~75 provider catalogs via models.dev (models.dev/api.json);
		// most first-class ones also support `/connect` OAuth stored under the
		// isolated dataDir this row already sets (XDG_CONFIG_HOME), so no host env
		// is needed for those. This lists only the BYO-key env vars for the
		// providers this repo documents elsewhere in the registry (Anthropic,
		// OpenAI, Google/Gemini), per each provider's `env` field in that catalog,
		// plus OpenRouter as the common self-hosted gateway. Not exhaustive by
		// design (ADR 0004 §5 is an allowlist, not "every provider key that
		// exists"); extend this list deliberately, never with a wildcard.
		providerKeys: [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GEMINI_API_KEY",
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"GOOGLE_API_KEY",
			"OPENROUTER_API_KEY",
		],
		install:
			"curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai)",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: true,
	},
	"claude-code": {
		id: "claude-code",
		label: "Claude Code",
		binary: "claude-agent-acp",
		acpArgs: () => [],
		acpEnv: ({ dataDir }) => ({ CLAUDE_CONFIG_DIR: dataDir }),
		// Anthropic SDK default env var (docs.anthropic.com); `claude login` OAuth
		// state lives under CLAUDE_CONFIG_DIR above, not the host env.
		providerKeys: ["ANTHROPIC_API_KEY"],
		install:
			"npm i -g @agentclientprotocol/claude-agent-acp  (needs `claude login`)",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex-acp",
		acpArgs: () => [],
		acpEnv: ({ dataDir }) => ({ CODEX_HOME: dataDir }),
		// codex-acp's own install line names this as its env-based login fallback.
		providerKeys: ["OPENAI_API_KEY"],
		install:
			"npm i -g @agentclientprotocol/codex-acp  (needs `codex login` or OPENAI_API_KEY)",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
	gemini: {
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		acpArgs: () => ["--experimental-acp"],
		acpEnv: () => ({}),
		// Gemini CLI's documented API-key env var.
		providerKeys: ["GEMINI_API_KEY"],
		install: "npm i -g @google/gemini-cli",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
	deepagents: {
		id: "deepagents",
		label: "deepagents",
		binary: "deepagents-acp",
		acpArgs: () => [],
		acpEnv: () => ({}),
		// `deepagents-acp --help` lists exactly these two under ENVIRONMENT
		// VARIABLES (verified against the installed binary, v0.x); its DEBUG and
		// DEEPAGENTS_LOG_FILE knobs are not secrets and are not provider keys.
		providerKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
		install: "pip install deepagents-acp",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
};

/**
 * The child env for a harness invocation: the row's own `providerKeys` read out
 * of `sourceEnv` (the process floor's allowlist is layered on separately by
 * `buildFloorEnv`). Never widens to "everything but PRISMALENS_*" (ADR 0004 §5)
 * and always drops a `PRISMALENS_*` name even if a row were ever misconfigured
 * to list one.
 */
export function getHarnessProviderKeys(
	harnessId: HarnessId,
	sourceEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const keys = HARNESS_REGISTRY[harnessId]?.providerKeys ?? [];
	const result: Record<string, string> = {};
	for (const key of keys) {
		if (key.startsWith("PRISMALENS_")) continue;
		const value = sourceEnv[key];
		if (value !== undefined) result[key] = value;
	}
	return result;
}

/** Auto-selection order; only `verified` rows are eligible without a pin. */
export const HARNESS_AUTO_ORDER: readonly HarnessId[] = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
];

export const HARNESS_BINARY: Record<HarnessId, string> = Object.fromEntries(
	HARNESS_IDS.map((id) => [id, HARNESS_REGISTRY[id].binary]),
) as Record<HarnessId, string>;

export const PERMISSION_MODES = ["read-only"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface PermissionOutcome {
	mode: PermissionMode;
	fidelity: PermissionFidelity;
	mechanism: string;
}

export function resolvePermissionOutcome(
	harnessId: HarnessId,
	mode: PermissionMode = "read-only",
): PermissionOutcome {
	const registry = HARNESS_REGISTRY[harnessId];
	return {
		mode,
		fidelity: registry.readOnlyFidelity,
		mechanism: registry.readOnlyMechanism,
	};
}
