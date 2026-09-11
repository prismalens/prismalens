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
		install: "pip install deepagents-acp",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
};

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
