// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness registry: every harness speaks ACP over stdio (ADR 0003). Any row on
 * PATH is selectable; `tested` records the version a compatibility run passed on.
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
	/** No registry harness is on PATH. */
	"no-harness",
	/** A model is set for a harness that has no way to take one (#639 rec 4). */
	"model-unsupported",
] as const;
export type HarnessSelectionFailure =
	(typeof HARNESS_SELECTION_FAILURES)[number];

export type PermissionFidelity = "enforced" | "cooperative" | "advisory";

/** What the agent may touch, named by reach (r4 R4.1); the gate in `permission.ts` enforces each. */
export const PERMISSION_MODES = [
	"read-only",
	"read-only-tools",
	"workspace-write",
	"full-access",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** A harness's own second layer at one access level, set beside the gate. */
export interface HarnessAccess {
	/** The layer this level sets, recorded on the run as `fidelity.mechanism`. */
	mechanism: string;
	/** Merged over `acpEnv`. */
	env?: Record<string, string>;
	/** Deep-merged into every JSON file `configFiles` writes. */
	configPatch?: Record<string, unknown>;
	/** ACP session mode id set after `session/new` when offered; null when the harness has none. */
	mode?: string | null;
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
	 * row's compatibility run passed on. Absent means the harness's own default,
	 * which nobody tested (#337 run e: OpenCode's default ignored the report
	 * schema twice). Recorded per run with its source in `RunFidelity`.
	 */
	defaultModel?: string;
	readOnlyFidelity: PermissionFidelity;
	/** The harness's own layer per access level (r4 R4.1); the gate enforces every level regardless. */
	access: Record<PermissionMode, HarnessAccess>;
	/** An OS sandbox the operator can switch on at the read levels; off by default (r4 R4.1 rev, option B). */
	sandbox?: {
		settingKey: "codexSandbox";
		/** The env var `onMode` and `offMode` are written to. */
		envKey: "INITIAL_AGENT_MODE";
		onMode: "read-only";
		offMode: "agent-full-access";
		onMechanism: string;
	};
	/** The version a compatibility run passed on (ADR 0003 §10), or absent: never run. Written by hand from `scripts/acp-admission.ts` output; CI re-runs the OpenCode row on every push with a pinned model. */
	tested?: { version: string; date: string };
	/**
	 * How `HarnessRunEnv.model` reaches the harness: `config` (a file
	 * `configFiles` writes), `env` (a var `acpEnv` sets), or `unsupported` (the
	 * harness has no way to take it, so an operator-set model refuses the run
	 * before it starts; see `refuseModel`).
	 */
	modelVia: "config" | "env" | "unsupported";
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: string;
	/** The host env var naming the model the harness runs when PrismaLens sets none. */
	envModelKey?: string;
	/**
	 * Provider API-key env vars this harness actually reads from the host
	 * (ADR 0004 §5: allowlist, never `process.env`). Never a bare wildcard —
	 * each name is cited in the row's own doc pointer below.
	 */
	providerKeys?: readonly string[];
	/** The row passed the resume probe (scripts/acp-admission.ts R5), so a finished run can be continued with session/load (#747). */
	resume: boolean;
}

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
						edit: "deny",
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
		readOnlyFidelity: "cooperative",
		access: {
			"read-only": {
				mechanism:
					"opencode.json edit denied, bash=ask answered by PrismaLens; webfetch, websearch, external_directory denied; repo config disabled",
			},
			"read-only-tools": {
				mechanism:
					"opencode.json edit denied, bash=ask answered by PrismaLens; webfetch, websearch, external_directory denied; repo config disabled",
			},
			"workspace-write": {
				mechanism:
					"opencode.json edit/bash=ask answered by PrismaLens; webfetch, websearch, external_directory denied; repo config disabled",
				configPatch: { permission: { edit: "ask" } },
			},
			"full-access": {
				mechanism:
					"opencode.json edit, bash, webfetch, websearch, external_directory allowed; PrismaLens allows every request it sees and logs it",
				configPatch: {
					permission: {
						edit: "allow",
						bash: "allow",
						webfetch: "allow",
						websearch: "allow",
						external_directory: "allow",
					},
				},
			},
		},
		tested: { version: "1.18.30", date: "2026-09-20" },
		modelVia: "config",
		loginHint: "`opencode auth login`, or a provider key in env",
		resume: true,
	},
	"claude-code": {
		id: "claude-code",
		label: "Claude Code",
		binary: "claude-agent-acp",
		companionBinary: "claude",
		acpArgs: () => [],
		acpEnv: ({ model, companionPath }) => ({
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
		// Anthropic SDK default env var (docs.anthropic.com).
		// ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN: Claude Code's documented gateway pair (LLM gateway, Ollama).
		// The model keys too: a gateway serves its own model ids, not Anthropic's (walk f18).
		providerKeys: [
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_BASE_URL",
			"ANTHROPIC_AUTH_TOKEN",
			"ANTHROPIC_MODEL",
			"ANTHROPIC_DEFAULT_OPUS_MODEL",
			"ANTHROPIC_DEFAULT_SONNET_MODEL",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL",
			"CLAUDE_CODE_SUBAGENT_MODEL",
		],
		envModelKey: "ANTHROPIC_MODEL",
		install:
			"npm i -g @agentclientprotocol/claude-agent-acp --omit=optional  (then `claude /login`, or set ANTHROPIC_API_KEY)",
		readOnlyFidelity: "cooperative",
		// `plan` is never set: it rewrites the system prompt into planning (r4 R4.1).
		access: {
			"read-only": {
				mechanism:
					"mode default; ACP session/request_permission answered by PrismaLens; settingSources: [] keeps repo settings and hooks inert",
				mode: "default",
			},
			"read-only-tools": {
				mechanism:
					"mode default; ACP session/request_permission answered by PrismaLens; settingSources: [] keeps repo settings and hooks inert",
				mode: "default",
			},
			"workspace-write": {
				mechanism:
					"mode default; ACP session/request_permission answered by PrismaLens; settingSources: [] keeps repo settings and hooks inert",
				mode: "default",
			},
			"full-access": {
				mechanism:
					"mode bypassPermissions; PrismaLens allows every request it sees and logs it; settingSources: []",
				mode: "bypassPermissions",
			},
		},
		// scripts/acp-admission.ts, 3 of 3 on Ollama gemma4:31b-cloud (#634).
		tested: { version: "0.81.1", date: "2026-09-23" },
		modelVia: "env",
		loginHint: "`claude /login`, or `ANTHROPIC_API_KEY` in env",
		resume: true,
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex-acp",
		acpArgs: () => [],
		acpEnv: () => ({
			// codex-acp reads an env key only once the client picks its api-key method;
			// without this it answers -32000 when no login exists (codex-acp 1.13.1, #634).
			DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
		}),
		// codex-acp README: CODEX_API_KEY wins over OPENAI_API_KEY for the api-key method.
		providerKeys: ["CODEX_API_KEY", "OPENAI_API_KEY"],
		install:
			"npm i -g @agentclientprotocol/codex-acp  (then `codex login`, or set OPENAI_API_KEY)",
		readOnlyFidelity: "cooperative",
		// codex-acp 1.13.1 mode ids are read-only, agent and agent-full-access; its
		// read-only and agent modes are both a workspace-write sandbox with no network.
		access: {
			"read-only": {
				mechanism:
					"Codex sandbox off (agent-full-access); PrismaLens gate only",
				env: { INITIAL_AGENT_MODE: "agent-full-access" },
			},
			"read-only-tools": {
				mechanism:
					"Codex sandbox off (agent-full-access); PrismaLens gate only",
				env: { INITIAL_AGENT_MODE: "agent-full-access" },
			},
			"workspace-write": {
				mechanism:
					"Codex agent mode (workspace-write sandbox, no network) plus PrismaLens gate",
				env: { INITIAL_AGENT_MODE: "agent" },
			},
			"full-access": {
				mechanism:
					"Codex agent-full-access; PrismaLens allows every request it sees and logs it",
				env: { INITIAL_AGENT_MODE: "agent-full-access" },
			},
		},
		sandbox: {
			settingKey: "codexSandbox",
			envKey: "INITIAL_AGENT_MODE",
			onMode: "read-only",
			offMode: "agent-full-access",
			onMechanism: "Codex read-only sandbox (no network)",
		},
		// 3 of 3 with a scratch HOME's ~/.codex on Ollama gemma4:31b-cloud (#634).
		tested: { version: "1.13.1", date: "2026-09-24" },
		modelVia: "unsupported",
		loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
		resume: true,
	},
	gemini: {
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		acpArgs: () => ["--experimental-acp"],
		// Untrusted workspace gates .gemini/settings.json, commands, extensions,
		// MCP servers, and GEMINI.md while keeping ACP mode functional (#634).
		acpEnv: () => ({
			GEMINI_CLI_TRUST_WORKSPACE: "false",
		}),
		// Gemini CLI's documented API-key env var.
		providerKeys: ["GEMINI_API_KEY"],
		install: "npm i -g @google/gemini-cli",
		readOnlyFidelity: "cooperative",
		access: {
			"read-only": {
				mechanism:
					"approval mode plan when offered; ACP permission answers; GEMINI_CLI_TRUST_WORKSPACE=false keeps repo config inert",
				mode: "plan",
			},
			"read-only-tools": {
				mechanism:
					"approval mode plan when offered; ACP permission answers; GEMINI_CLI_TRUST_WORKSPACE=false keeps repo config inert",
				mode: "plan",
			},
			"workspace-write": {
				mechanism:
					"approval mode default when offered; ACP permission answers; GEMINI_CLI_TRUST_WORKSPACE=false keeps repo config inert",
				mode: "default",
			},
			"full-access": {
				mechanism:
					"approval mode yolo when offered; PrismaLens allows every request it sees and logs it",
				mode: "yolo",
			},
		},
		modelVia: "unsupported",
		loginHint: "`gemini` sign-in, or `GEMINI_API_KEY` in env",
		resume: true,
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
		// No modes over ACP (deepagents #4254): the gate is the only layer.
		access: {
			"read-only": { mechanism: "enforced by PrismaLens only; --no-mcp" },
			"read-only-tools": { mechanism: "enforced by PrismaLens only; --no-mcp" },
			"workspace-write": { mechanism: "enforced by PrismaLens only; --no-mcp" },
			"full-access": {
				mechanism:
					"PrismaLens allows every request it sees and logs it; --no-mcp",
			},
		},
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		tested: { version: "0.1.75", date: "2026-09-23" },
		modelVia: "unsupported",
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
		resume: false,
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
	"env",
] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface ResolvedModel {
	/** The id passed to the harness; undefined leaves the harness to its own default. */
	model?: string;
	source: ModelSource;
}

/** The model the host env names for this harness, when it reads one. */
export function harnessEnvModel(
	harnessId: HarnessId,
	env: Record<string, string | undefined>,
): { key: string; model: string } | null {
	const key = HARNESS_REGISTRY[harnessId]?.envModelKey;
	const model = key ? env[key]?.trim() : undefined;
	return key && model ? { key, model } : null;
}

/** Operator setting first, then the host env's model, then the row's tested default, then the harness's own. */
export function resolveHarnessModel(
	harnessId: HarnessId,
	operatorModel?: string,
	env: Record<string, string | undefined> = {},
): ResolvedModel {
	const operator = operatorModel?.trim();
	if (operator) return { model: operator, source: "operator" };
	const fromEnv = harnessEnvModel(harnessId, env);
	if (fromEnv) return { model: fromEnv.model, source: "env" };
	const row = HARNESS_REGISTRY[harnessId]?.defaultModel;
	if (row) return { model: row, source: "product-default" };
	return { source: "harness-default" };
}

/** Auto-selection order: the first one on PATH runs unless one is pinned. */
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

export interface PermissionOutcome {
	mode: PermissionMode;
	fidelity: PermissionFidelity;
	mechanism: string;
	env: Record<string, string>;
	configPatch?: Record<string, unknown>;
	agentMode: string | null;
}

/**
 * The sandbox switch when the operator has not set it: on. codex-acp 1.13.1's
 * agent-full-access mode runs with approvals "never", so Codex would ask the gate nothing; held at on pending the operator.
 */
export const SANDBOX_DEFAULT = true;

/** The read levels, where a harness sandbox switch applies. */
const READ_LEVELS: ReadonlySet<PermissionMode> = new Set([
	"read-only",
	"read-only-tools",
]);

/**
 * The second layer a run at `mode` gets on `harnessId`. `sandbox` is the
 * operator's switch for a row that has one; it changes the read levels only.
 */
export function resolvePermissionOutcome(
	harnessId: HarnessId,
	mode: PermissionMode = "read-only",
	options: { sandbox?: boolean } = {},
): PermissionOutcome {
	const row = HARNESS_REGISTRY[harnessId];
	const access = row.access[mode];
	const sandbox =
		(options.sandbox ?? SANDBOX_DEFAULT) && READ_LEVELS.has(mode)
			? row.sandbox
			: null;
	return {
		mode,
		// Only an OS sandbox the operator switched on is a boundary (r4 R4.1 rev).
		fidelity: sandbox ? "enforced" : row.readOnlyFidelity,
		mechanism: sandbox ? sandbox.onMechanism : access.mechanism,
		env: sandbox
			? { ...access.env, [sandbox.envKey]: sandbox.onMode }
			: { ...access.env },
		...(access.configPatch ? { configPatch: access.configPatch } : {}),
		agentMode: access.mode ?? null,
	};
}

/**
 * Why a run on `harnessId` must not start with `model` set, or null. A run
 * refuses what the row lacks rather than dropping it and running anyway
 * (ADR 0003 item 5, #639 rec 4).
 */
export function refuseModel(
	harnessId: HarnessId,
	model: string | undefined,
): string | null {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.modelVia !== "unsupported" || !model?.trim()) return null;
	return `${row.label} picks its own model. Clear ${model.trim()} in the picker above.`;
}

/** Why a finished run on `harnessId` cannot be continued, or null when it can (#747). */
export function resumeBlockedReason(harnessId: HarnessId): string | null {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.resume) return null;
	return `${row.label} can't reopen a finished session, so a new run starts from the report.`;
}
