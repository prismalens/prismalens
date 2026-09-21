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
 * Where `pl up` runs decides the harness credential and isolation (ADR 0003 §9).
 * `laptop`: the user's own config dir and sign-in. `server` (VM, cloud, CI): an
 * empty per-run config dir and an API key in env; a subscription never runs there.
 */
export const PLACEMENTS = ["laptop", "server"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** `PRISMALENS_PLACEMENT` wins; otherwise CI is a server and anything else a laptop. */
export function resolvePlacement(
	env: NodeJS.ProcessEnv = process.env,
): Placement {
	const explicit = env.PRISMALENS_PLACEMENT?.trim();
	if (explicit === "laptop" || explicit === "server") return explicit;
	return env.CI && env.CI !== "false" ? "server" : "laptop";
}

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
	placement: Placement;
	/** Absolute path of the row's `companionBinary` on PATH, when found. */
	companionPath?: string;
}

export interface HarnessDescriptor {
	id: HarnessId;
	label: string;
	/** Binary looked up on PATH for detection. */
	binary: string;
	/**
	 * The vendor's own CLI the adapter drives, when it is a separate install. The
	 * doctor names it when the adapter is missing, and the run hands its PATH copy
	 * to the adapter so the adapter never ships a second one.
	 */
	companionBinary?: string;
	/** argv for `binary` that starts an ACP server on stdio in `cwd`. */
	acpArgs: (env: HarnessRunEnv) => string[];
	/** Env vars that point the harness at prismalens's per-run config, never the user's. */
	acpEnv: (env: HarnessRunEnv) => Record<string, string>;
	/** Files prismalens writes under configDir before the run; the harness reads nothing else. */
	configFiles?: (env: HarnessRunEnv) => Record<string, string>;
	/** `_meta` on ACP `session/new`, for isolation a harness takes only there. */
	sessionMeta?: () => Record<string, unknown>;
	/** One line the doctor prints when the binary is missing. */
	install: string;
	/**
	 * The model prismalens asks for when the operator set none: the id the
	 * row's admission run passed on. Absent means the harness's own default,
	 * which nobody verified (#337 run e: OpenCode's default ignored the report
	 * schema twice). Recorded per run with its source in `RunFidelity`.
	 */
	defaultModel?: string;
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
			// The repo's own opencode.json, plugins and CLAUDE.md-style files stay inert (ADR 0004 §1; #639 R4).
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		}),
		configFiles: ({ model }) => ({
			"opencode.json": JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					...(model ? { model } : {}),
					permission: {
						edit: "ask",
						bash: "ask",
						webfetch: "deny",
						websearch: "deny",
						external_directory: "deny",
					},
					// Without it a refused tool ends the turn, so a read-only run rarely reaches its report (#639 finding 1).
					experimental: { continue_loop_on_deny: true },
					share: "disabled",
				},
				null,
				2,
			),
		}),
		// opencode resolves ~75 provider catalogs via models.dev (models.dev/api.json);
		// most first-class ones also support `/connect`, whose auth.json lives under the
		// XDG data dir (Global.Path.data). XDG_DATA_HOME is not overridden here, so the
		// user's `/connect` login survives and no host env is needed for those. This
		// lists only the BYO-key env vars for the providers this repo documents elsewhere
		// in the registry (Anthropic,
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
		// The keyless model every #337 walk and the CI admission run used.
		defaultModel: "opencode/muse-spark-1.3-contributor-free",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: true,
	},
	"claude-code": {
		id: "claude-code",
		label: "Claude Code",
		binary: "claude-agent-acp",
		companionBinary: "claude",
		acpArgs: () => [],
		acpEnv: ({ dataDir, model, placement, companionPath }) => ({
			// A laptop keeps the user's own config dir, so their `claude /login` is what
			// runs; isolation comes from `settingSources: []` below (ADR 0003 §9, #650).
			...(placement === "server" ? { CLAUDE_CONFIG_DIR: dataDir } : {}),
			...(companionPath ? { CLAUDE_CODE_EXECUTABLE: companionPath } : {}),
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			// Claude Code reads the model from env; one model for every tier and sub-agent.
			...(model
				? {
						ANTHROPIC_MODEL: model,
						ANTHROPIC_DEFAULT_OPUS_MODEL: model,
						ANTHROPIC_DEFAULT_SONNET_MODEL: model,
						ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
						CLAUDE_CODE_SUBAGENT_MODEL: model,
					}
				: {}),
		}),
		// No project hooks, settings or .mcp.json from the snapshot (ADR 0004 §1; #639 R4).
		sessionMeta: () => ({ claudeCode: { options: { settingSources: [] } } }),
		// Anthropic SDK default env var (docs.anthropic.com); the only credential on a server
		// placement, where CLAUDE_CONFIG_DIR is the empty per-run dir.
		// ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN: Claude Code's documented gateway pair (LLM gateway, Ollama).
		providerKeys: [
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_BASE_URL",
			"ANTHROPIC_AUTH_TOKEN",
		],
		install:
			"npm i -g @agentclientprotocol/claude-agent-acp --omit=optional  (then `claude /login`, or set ANTHROPIC_API_KEY on a server)",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex-acp",
		acpArgs: () => [],
		acpEnv: ({ dataDir }) => ({
			CODEX_HOME: dataDir,
			// codex-acp's own read-only mode, so the harness refuses writes before
			// prismalens's permission answer is asked (codex-acp readme-dev.md, #634).
			INITIAL_AGENT_MODE: "read-only",
		}),
		// codex-acp's own install line names this as its env-based login fallback.
		providerKeys: ["OPENAI_API_KEY"],
		install: "npm i -g @agentclientprotocol/codex-acp  (set OPENAI_API_KEY)",
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
		// deepagents-acp ships no console script; deepagents-code's `dcode --acp` is
		// the ACP server (entry points of deepagents-code 0.1.71 on PyPI, #634).
		// --no-mcp: no MCP servers from the snapshot or the user's config.
		binary: "dcode",
		acpArgs: () => ["--acp", "--no-mcp"],
		acpEnv: () => ({}),
		// The two keys `deepagents-acp --help` listed under ENVIRONMENT VARIABLES;
		// not yet re-checked against `dcode`, which may read more providers.
		providerKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
		install: "uv tool install -U deepagents-code --with deepagents-acp",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: READ_ONLY_MECHANISM,
		verified: false,
	},
};

/**
 * The child env for a harness invocation: the row's own `providerKeys` read out
 * of `sourceEnv` (the process floor's allowlist is layered on separately by
 * `buildChildEnv`). Never widens to "everything but PRISMALENS_*" (ADR 0004 §5)
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
	const base = result.ANTHROPIC_BASE_URL;
	if (base && !isSafeGatewayUrl(base))
		throw new Error(
			`ANTHROPIC_BASE_URL must be https unless it points at this machine: ${base}`,
		);
	return result;
}

/** A gateway receives the auth token, so plain http is allowed only on loopback. */
function isSafeGatewayUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	return (
		url.protocol === "http:" &&
		(host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host))
	);
}

/** Where a run's model id came from; recorded in `RunFidelity` (#337 run e, G11). */
export const MODEL_SOURCES = [
	"operator",
	"product-default",
	"harness-default",
] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface ResolvedModel {
	/** The id passed to the harness; undefined leaves the harness to its own default. */
	model?: string;
	source: ModelSource;
}

/** Operator setting first, then the row's verified default, then the harness's own. */
export function resolveHarnessModel(
	harnessId: HarnessId,
	operatorModel?: string,
): ResolvedModel {
	const operator = operatorModel?.trim();
	if (operator) return { model: operator, source: "operator" };
	const row = HARNESS_REGISTRY[harnessId]?.defaultModel;
	if (row) return { model: row, source: "product-default" };
	return { source: "harness-default" };
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
