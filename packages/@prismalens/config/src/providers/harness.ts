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
	/** A run asked for another agent than the one PRISMALENS_HARNESS pins (#673 w52). */
	"env-pinned-other",
] as const;
export type HarnessSelectionFailure =
	(typeof HARNESS_SELECTION_FAILURES)[number];

export type PermissionFidelity = "enforced" | "cooperative" | "advisory";

/** Does the agent's own OS sandbox hold a mode on this machine: shown by a local probe, absent, or not shown (#673 w51). */
export const SANDBOX_STATES = ["enforced", "none", "unknown"] as const;
export type SandboxState = (typeof SANDBOX_STATES)[number];
export interface SandboxCheck {
	state: SandboxState;
	/** One line: what the check saw, or why it could not tell. */
	reason: string;
}

/**
 * The reserved mode id that asks for no mode: `session/set_mode` is never
 * called and the run records what the agent reports as current (#673 w21).
 */
export const AGENT_DEFAULT_MODE = "agent-default";

/**
 * The four access levels a run can ask for, after t3code's runtime modes
 * (pingdotgg/t3code @454b94a): each row names its agent's own mode for each (#673 w21).
 */
export const ACCESS_TIERS = [
	"supervised",
	"auto-edits",
	"auto",
	"full-access",
] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

/** How a mode reaches the agent: ACP `session/set_mode` (or its `mode` option), an env var at spawn, or not at all. */
export type ModeMechanism = "acp" | "env" | "none";

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
	/** The agent's own permission mode a run asks for when the operator set none: its supervised one (#673 w21). */
	defaultMode: string;
	/** The agent's own mode id for each access tier it has (#673 w21). */
	modeTiers: Partial<Record<AccessTier, string>>;
	/** Plan-style modes: never offered, never run; a stored one reads as `defaultMode` (#673 w21). */
	planModes?: readonly string[];
	modeMechanism: ModeMechanism;
	/** For `env`: the variable the mode id is written to before spawn. */
	modeEnvKey?: string;
	/** Modes the agent runs under its OS sandbox with no network, per its source; a probe still decides `enforced` (#673 w51). */
	sandboxedModes?: readonly string[];
	/** The version a compatibility run passed on (ADR 0003 §10), or absent: never run. Written by hand from `scripts/acp-admission.ts` output; CI re-runs the OpenCode row on every push with a pinned model. */
	tested?: { version: string; date: string };
	/**
	 * How a chosen model reaches the harness (R4.2): `acp`, the session's own
	 * `model` config option, verified by its answer; or `unsupported`, so an
	 * operator-set model refuses the run before it starts (`refuseModel`).
	 */
	modelVia: "acp" | "unsupported";
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: string;
	/** The host env var naming the model the harness runs when PrismaLens sets none. */
	envModelKey?: string;
	/** The env var that adds one model id to the agent's own list, so its model option takes it (#673 w57). */
	customModelEnvKey?: string;
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
		// XDG_CONFIG_HOME stays the user's: a run takes their model, providers, MCP servers and agents.
		// The boundary is the untrusted repo (ADR 0004), and every run works in a throwaway clone. #791
		acpEnv: ({ configDir }) => ({
			OPENCODE_CONFIG_DIR: configDir,
			// The repo's own opencode.json, plugins and CLAUDE.md-style files stay inert (ADR 0004 §1; #639 R4).
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		}),
		configFiles: () => ({
			"opencode.json": JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					// Without it a refused tool ends the turn, so a run with a denied ask rarely reaches its report (#639 finding 1).
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
		// OpenCode offers its agents as the ACP `mode` config option; what `build` asks is the user's opencode.json.
		defaultMode: "build",
		modeTiers: { supervised: "build" },
		planModes: ["plan"],
		modeMechanism: "acp",
		tested: { version: "1.18.30", date: "2026-09-20" },
		modelVia: "acp",
		loginHint: "`opencode auth login`, or a provider key in env",
		resume: true,
	},
	"claude-code": {
		id: "claude-code",
		label: "Claude Code",
		binary: "claude-agent-acp",
		companionBinary: "claude",
		acpArgs: () => [],
		acpEnv: ({ companionPath }) => ({
			...(companionPath ? { CLAUDE_CODE_EXECUTABLE: companionPath } : {}),
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		}),
		// The user's own settings (allow/deny rules, sandbox, availableModels), never the
		// snapshot's: `project` and `local` would read the repo's CLAUDE.md (ADR 0004 §1; #673 w21).
		sessionMeta: () => ({
			claudeCode: { options: { settingSources: ["user"] } },
		}),
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
		// claude-agent-acp 0.81.1 takes an id outside its list only through this (#808 probe):
		// _meta settings.availableModels empties the list and set_config_option answers Invalid value.
		customModelEnvKey: "ANTHROPIC_CUSTOM_MODEL_OPTION",
		install:
			"npm i -g @agentclientprotocol/claude-agent-acp --omit=optional  (then `claude /login`, or set ANTHROPIC_API_KEY)",
		// claude-agent-acp's modes; `plan` rewrites the system prompt into planning (r4 R4.1).
		defaultMode: "default",
		modeTiers: {
			supervised: "default",
			"auto-edits": "acceptEdits",
			auto: "auto",
			"full-access": "bypassPermissions",
		},
		planModes: ["plan"],
		modeMechanism: "acp",
		// scripts/acp-admission.ts, 3 of 3 on Ollama gemma4:31b-cloud (#634).
		tested: { version: "0.81.1", date: "2026-09-23" },
		modelVia: "acp",
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
		// codex-acp src/AgentMode.ts: read-only, workspace-write and agent run in Codex's sandbox with no network; agent-full-access in none.
		defaultMode: "read-only",
		// codex-acp 2.x; 1.13.x has no workspace-write, and its read-only writes inside the workspace.
		modeTiers: {
			supervised: "read-only",
			"auto-edits": "workspace-write",
			auto: "agent",
			"full-access": "agent-full-access",
		},
		modeMechanism: "env",
		modeEnvKey: "INITIAL_AGENT_MODE",
		sandboxedModes: ["read-only", "workspace-write", "agent"],
		// 3 of 3 with a scratch HOME's ~/.codex on Ollama gemma4:31b-cloud (#634).
		tested: { version: "1.13.1", date: "2026-09-24" },
		// codex-acp offers model and reasoning effort as config options; a run verifies the answer.
		modelVia: "acp",
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
		// gemini-cli packages/core/src/policy/types.ts, ApprovalMode.
		defaultMode: "default",
		modeTiers: {
			supervised: "default",
			"auto-edits": "autoEdit",
			"full-access": "yolo",
		},
		planModes: ["plan"],
		modeMechanism: "acp",
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
		// No modes over ACP (deepagents #4254).
		defaultMode: AGENT_DEFAULT_MODE,
		modeTiers: {},
		modeMechanism: "none",
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

/** A plan-style mode, which no run starts in (#673 w21). */
export function isPlanMode(harnessId: HarnessId, mode: string | null): boolean {
	return !!mode && !!HARNESS_REGISTRY[harnessId].planModes?.includes(mode);
}

/** The modes a run may start in: every one the agent offered but a plan mode; null when none is left (#673 w21). */
export function runnableModes<M extends { id: string }>(
	harnessId: HarnessId,
	modes: readonly M[] | null | undefined,
): M[] | null {
	const left = (modes ?? []).filter((m) => !isPlanMode(harnessId, m.id));
	return left.length ? left : null;
}

/** The operator's per-agent setting, else the row's default; a stored plan mode reads as the default (#673 w21). */
export function resolveAgentMode(
	harnessId: HarnessId,
	setting?: string | null,
): string {
	const asked = setting?.trim();
	return asked && !isPlanMode(harnessId, asked)
		? asked
		: HARNESS_REGISTRY[harnessId].defaultMode;
}

/** Env a row with `modeMechanism: "env"` takes the mode through; empty otherwise. */
export function agentModeEnv(
	harnessId: HarnessId,
	mode: string,
): Record<string, string> {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.modeMechanism !== "env" || !row.modeEnvKey) return {};
	if (mode === AGENT_DEFAULT_MODE) return {};
	return { [row.modeEnvKey]: mode };
}

/** Whether the agent runs `mode` under its own OS sandbox at all; whether that sandbox works here is a probe's call. */
export function runsInSandbox(
	harnessId: HarnessId,
	mode: string | null,
): boolean {
	const sandboxed = HARNESS_REGISTRY[harnessId].sandboxedModes ?? [];
	return !!mode && sandboxed.includes(mode);
}

/** `enforced` only where a local check saw the agent's sandbox hold the run's mode; every other mode is the agent's word. */
export function modeFidelity(
	sandbox: SandboxCheck | undefined,
): PermissionFidelity {
	return sandbox?.state === "enforced" ? "enforced" : "cooperative";
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
