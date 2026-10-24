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
	"local",
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

/** The four permission levels, in display order; each row names its agent's own mode for each. */
export const ACCESS_LEVELS = [
	"supervised",
	"auto-edits",
	"auto",
	"full-access",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const DEFAULT_ACCESS_LEVEL: AccessLevel = "supervised";

/** The sandbox check's key for an agent that offers no modes; never sent to an agent. */
export const NO_MODE_KEY = "agent-default";

/** How a mode reaches the agent: ACP `session/set_mode` (or its `mode` option), or not at all. */
export type ModeMechanism = "acp" | "none";

/** What the last readiness check offered, as much of it as a row line reads. */
export type CheckedModes = {
	modes: readonly { id: string; name: string }[] | null;
} | null;

/** One permission level on one agent: the agent's own mode, a config overlay, or nothing to set. */
export interface HarnessAccess {
	/** The agent's own mode id; null when there is nothing to set. */
	mode?: string | null;
	/** Run when `mode` is not offered, or the agent refuses it. */
	fallbackMode?: string;
	/** Deep-merged into the row's generated JSON config files; `user` is the user's own config the agent loads before them. */
	configPatch?: (user: Record<string, unknown>) => Record<string, unknown>;
	/** Recorded as `fidelity.mechanism`. */
	mechanism: string;
	/** The row line under the level: what this agent runs, by its own mode name when the check listed one. */
	line: (checked: CheckedModes) => string;
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
	/** The run starts the adapter PrismaLens ships, not one on PATH (#818). */
	shipped?: boolean;
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
	/**
	 * The npm package of the ACP adapter PrismaLens ships for this agent (#818): with
	 * no `binary` on PATH, it runs on the companion, so the companion is the prerequisite.
	 */
	adapterPackage?: string;
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
	/** Each permission level on this agent (#673 w21 ruling 2026-10-10). */
	access: Record<AccessLevel, HarnessAccess>;
	modeMechanism: ModeMechanism;
	/** Modes the agent runs under its OS sandbox with no network, per its source; a probe still decides `enforced` (#673 w51). */
	sandboxedModes?: readonly string[];
	/** The version a compatibility run passed on (ADR 0003 §10), or absent: never run. Written by hand from `scripts/acp-admission.ts` output; CI re-runs the OpenCode row on every push with a pinned model. */
	tested?: { version: string; date: string; companion?: string };
	/**
	 * How a chosen model reaches the harness (R4.2): `acp`, the session's own
	 * `model` config option, verified by its answer; or `unsupported`, so an
	 * operator-set model refuses the run before it starts (`refuseModel`).
	 */
	modelVia: "acp" | "unsupported";
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: string;
	/** Its handshake answers signed out: credentials are checked at the first prompt turn, so a doctor pass proves no sign-in. */
	signInAtFirstTurn?: boolean;
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
	/** The env var naming the agent's own config folder, set from Settings → Agent → Config directory (#907). */
	configDir?: { envKey: string; shownDefault: string };
}

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
	!!v && typeof v === "object" && !Array.isArray(v);

/** A mode by the agent's own name in the last check, else `fallback`. */
function modeNamed(
	checked: CheckedModes,
	id: string,
	fallback: string,
): string {
	return checked?.modes?.find((m) => m.id === id)?.name ?? fallback;
}

function offers(checked: CheckedModes, id: string): boolean {
	return !!checked?.modes?.some((m) => m.id === id);
}

const OPENCODE_TOOLS = [
	"edit",
	"bash",
	"webfetch",
	"websearch",
	"external_directory",
] as const;
/** Tools OpenCode 1.18.30 types as one action, never a pattern map (core v1/config/permission.ts). */
const OPENCODE_ACTION_ONLY = new Set<string>(["webfetch", "websearch"]);
/** The built-in agents that run tools: the run's own, and the subagents it can start. */
const OPENCODE_AGENTS = ["build", "plan", "general", "explore"];

/** A user's rule for one tool: its patterns, and its catch-all only when it denies. */
function userPatterns(rule: unknown): JsonObject {
	if (rule === "deny") return { "*": "deny" };
	if (!isObject(rule)) return {};
	const { "*": all, ...patterns } = rule;
	return all === "deny" ? { "*": "deny", ...patterns } : patterns;
}

/**
 * A level's catch-all per tool, with the user's own patterns listed again after it on every agent:
 * OpenCode uses the last matching rule and merges this file after theirs in their key order (#809).
 */
function opencodePermission(
	edit: "ask" | "allow",
	rest: "ask" | "allow",
): (user: JsonObject) => JsonObject {
	const level: Record<(typeof OPENCODE_TOOLS)[number], string> = {
		edit,
		bash: rest,
		webfetch: rest,
		websearch: rest,
		external_directory: rest,
	};
	return (user) => {
		const top = isObject(user.permission) ? user.permission : {};
		const agents = isObject(user.agent) ? user.agent : {};
		const forAgent = (name: string) => {
			const own = agents[name];
			const rules =
				isObject(own) && isObject(own.permission) ? own.permission : {};
			return Object.fromEntries(
				OPENCODE_TOOLS.map((tool) => {
					const mine = rules[tool];
					if (OPENCODE_ACTION_ONLY.has(tool))
						return [
							tool,
							top[tool] === "deny" || mine === "deny" ? "deny" : level[tool],
						];
					// Their own map without "*" keeps its order, so the top-level catch-all stands in.
					const all =
						isObject(mine) && !("*" in mine) ? {} : { "*": level[tool] };
					return [
						tool,
						{ ...all, ...userPatterns(top[tool]), ...userPatterns(mine) },
					];
				}),
			);
		};
		const names = new Set([...OPENCODE_AGENTS, ...Object.keys(agents)]);
		return {
			permission: Object.fromEntries(
				OPENCODE_TOOLS.map((tool) => [
					tool,
					OPENCODE_ACTION_ONLY.has(tool) ? level[tool] : { "*": level[tool] },
				]),
			),
			agent: Object.fromEntries(
				[...names].map((name) => [name, { permission: forAgent(name) }]),
			),
		};
	};
}

function geminiMode(mode: string, line: HarnessAccess["line"]): HarnessAccess {
	return { mode, mechanism: "acp-mode", line };
}

function noMode(label: string): HarnessAccess {
	return {
		mode: null,
		mechanism: "none",
		line: () =>
			`${label} has no modes; PrismaLens answers its asks by this level.`,
	};
}
const NO_MODE = noMode("deepagents");
const LOCAL_NO_MODE = noMode("Local agent");

export const HARNESS_REGISTRY: Record<HarnessId, HarnessDescriptor> = {
	opencode: {
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		acpArgs: ({ cwd }) => ["acp", "--cwd", cwd],
		// XDG_CONFIG_HOME stays the user's: a run takes their model, providers, MCP servers and agents.
		// The repo's own opencode config loads too and is its owner's responsibility (#817). #791
		// OPENCODE_CONFIG_DIR holds this run's own opencode.json (configFiles below).
		acpEnv: ({ configDir }) => ({
			OPENCODE_CONFIG_DIR: configDir,
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
		// OpenCode offers its agents as the ACP `mode` config option; a level is a catch-all overlay on its rules.
		access: {
			supervised: {
				mode: "build",
				configPatch: opencodePermission("ask", "ask"),
				mechanism: "opencode-permission",
				line: () =>
					"OpenCode runs its build agent; each tool's catch-all asks.",
			},
			"auto-edits": {
				mode: "build",
				configPatch: opencodePermission("allow", "ask"),
				mechanism: "opencode-permission",
				line: () =>
					"OpenCode runs its build agent; edits are allowed and other tools ask.",
			},
			auto: {
				mode: "build",
				configPatch: opencodePermission("ask", "ask"),
				mechanism: "opencode-permission",
				line: () =>
					"OpenCode has no reviewer of its own; its build agent keeps the Ask always rules.",
			},
			"full-access": {
				mode: "build",
				configPatch: opencodePermission("allow", "allow"),
				mechanism: "opencode-permission",
				line: () =>
					"OpenCode runs its build agent with each tool's catch-all allowed; your own deny rules stay.",
			},
		},
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
		adapterPackage: "@agentclientprotocol/claude-agent-acp",
		acpArgs: () => [],
		acpEnv: ({ companionPath }) => ({
			...(companionPath ? { CLAUDE_CODE_EXECUTABLE: companionPath } : {}),
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		}),
		// The user's settings plus the repo's own: nothing of the user's setup is overridden (#817).
		// Without the plan-mode tools the agent cannot leave the run's mode at all (#673 w7-4).
		sessionMeta: () => ({
			claudeCode: {
				options: {
					settingSources: ["user", "project", "local"],
					disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
				},
			},
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
			"curl -fsSL https://claude.ai/install.sh | bash  (or: npm i -g @anthropic-ai/claude-code; then `claude /login`, or set ANTHROPIC_API_KEY)",
		// claude-agent-acp 0.81.1 modes. It reports `acceptEdits` when the model has no `auto`, and
		// leaves `bypassPermissions` unoffered when the user's settings turn it off (#673 w21).
		access: {
			supervised: {
				mode: "default",
				mechanism: "acp-mode",
				line: (c) =>
					`Claude Code runs in ${modeNamed(c, "default", "Manual")}.`,
			},
			"auto-edits": {
				mode: "acceptEdits",
				mechanism: "acp-mode",
				line: (c) =>
					`Claude Code runs in ${modeNamed(c, "acceptEdits", "Accept Edits")}.`,
			},
			auto: {
				mode: "auto",
				// A custom model id is outside the adapter's model list, so the CLI itself can refuse Auto (#809).
				fallbackMode: "acceptEdits",
				mechanism: "acp-mode",
				line: (c) =>
					`Claude Code runs in ${modeNamed(c, "auto", "Auto")}; with a model that has no Auto it runs ${modeNamed(c, "acceptEdits", "Accept Edits")}.`,
			},
			"full-access": {
				mode: "bypassPermissions",
				fallbackMode: "acceptEdits",
				mechanism: "acp-mode",
				line: (c) => {
					const bypass = modeNamed(
						c,
						"bypassPermissions",
						"Bypass Permissions",
					);
					const edits = modeNamed(c, "acceptEdits", "Accept Edits");
					return c?.modes && !offers(c, "bypassPermissions")
						? `Claude Code runs in ${edits}: your settings turn ${bypass} off.`
						: `Claude Code runs in ${bypass}, or ${edits} where your settings turn it off.`;
				},
			},
		},
		modeMechanism: "acp",
		// scripts/acp-admission.ts through the shipped adapter on claude 2.1.296, Haiku (#818). Must equal @prismalens/agent-adapters' pin.
		tested: { version: "0.81.1", date: "2026-10-11", companion: "2.1.296" },
		modelVia: "acp",
		loginHint: "`claude /login`, or `ANTHROPIC_API_KEY` in env",
		signInAtFirstTurn: true,
		resume: true,
		configDir: { envKey: "CLAUDE_CONFIG_DIR", shownDefault: "~/.claude" },
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex-acp",
		companionBinary: "codex",
		adapterPackage: "@agentclientprotocol/codex-acp",
		acpArgs: () => [],
		acpEnv: ({ companionPath, shipped }) => ({
			// codex-acp reads an env key only once the client picks its api-key method;
			// without this it answers -32000 when no login exists (codex-acp 1.13.1, #634).
			DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
			// The shipped adapter has no codex of its own; a PATH install keeps its bundled one (#818).
			...(shipped && companionPath ? { CODEX_PATH: companionPath } : {}),
		}),
		// codex-acp README: CODEX_API_KEY wins over OPENAI_API_KEY for the api-key method.
		providerKeys: ["CODEX_API_KEY", "OPENAI_API_KEY"],
		install:
			"npm i -g @openai/codex  (then `codex login`, or set OPENAI_API_KEY)",
		// codex-acp src/AgentMode.ts: read-only, workspace-write and agent run in Codex's sandbox with no network; agent-full-access in none.
		// Set through its `mode` config option, the reply verified. Before 2.0 read-only let workspace edits through
		// and there was no workspace-write (codex-acp#480); the fallback keeps an older PATH install working.
		access: {
			supervised: {
				mode: "read-only",
				mechanism: "acp-config",
				line: (c) =>
					`Codex runs in ${modeNamed(c, "read-only", "Ask for approval")}.`,
			},
			"auto-edits": {
				mode: "workspace-write",
				fallbackMode: "read-only",
				mechanism: "acp-config",
				line: (c) => {
					const ask = modeNamed(c, "read-only", "Ask for approval");
					if (offers(c, "workspace-write"))
						return `Codex runs in ${modeNamed(c, "workspace-write", "Workspace write")}.`;
					return c?.modes
						? `Codex runs in ${ask}, the same mode as Ask always on this version.`
						: `Codex runs in Workspace write, or ${ask} on a version without it.`;
				},
			},
			auto: {
				mode: "agent",
				mechanism: "acp-config",
				line: (c) =>
					`Codex runs in ${modeNamed(c, "agent", "Approve for me")}, its own reviewer.`,
			},
			"full-access": {
				mode: "agent-full-access",
				mechanism: "acp-config",
				line: (c) =>
					`Codex runs in ${modeNamed(c, "agent-full-access", "Full access")}, outside its sandbox.`,
			},
		},
		modeMechanism: "acp",
		sandboxedModes: ["read-only", "workspace-write", "agent"],
		// scripts/acp-admission.ts 3 of 3 through the shipped adapter on codex 0.163.0, gpt-6-luna (#846). Must equal @prismalens/agent-adapters' pin.
		tested: { version: "2.2.2", date: "2026-10-23" },
		// codex-acp offers model and reasoning effort as config options; a run verifies the answer.
		modelVia: "acp",
		loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
		resume: true,
		configDir: { envKey: "CODEX_HOME", shownDefault: "~/.codex" },
	},
	gemini: {
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		acpArgs: () => ["--experimental-acp"],
		// Trust is the user's own folderTrust setting; this row forces neither way (#817).
		acpEnv: () => ({}),
		// Gemini CLI's documented API-key env var.
		providerKeys: ["GEMINI_API_KEY"],
		install: "npm i -g @google/gemini-cli",
		// Mode ids from gemini-cli 0.64.0 buildAvailableModes: default, autoEdit, yolo (and plan).
		// Folder trust is the user's (#817); Gemini has no reviewer, so Auto runs `default` (#907).
		access: {
			supervised: geminiMode(
				"default",
				(c) => `Gemini CLI runs in ${modeNamed(c, "default", "Default")}.`,
			),
			"auto-edits": geminiMode(
				"autoEdit",
				(c) => `Gemini CLI runs in ${modeNamed(c, "autoEdit", "Auto Edit")}.`,
			),
			auto: geminiMode(
				"default",
				(c) =>
					`Gemini CLI has no reviewer of its own; it runs in ${modeNamed(c, "default", "Default")}, as Ask always does.`,
			),
			"full-access": geminiMode(
				"yolo",
				(c) => `Gemini CLI runs in ${modeNamed(c, "yolo", "YOLO")}.`,
			),
		},
		modeMechanism: "acp",
		modelVia: "unsupported",
		loginHint: "`gemini` sign-in, or `GEMINI_API_KEY` in env",
		resume: true,
		configDir: {
			envKey: "GEMINI_CLI_HOME",
			shownDefault: "your home folder (holds .gemini)",
		},
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
		access: {
			supervised: NO_MODE,
			"auto-edits": NO_MODE,
			auto: NO_MODE,
			"full-access": NO_MODE,
		},
		modeMechanism: "none",
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		tested: { version: "0.1.75", date: "2026-09-23" },
		modelVia: "unsupported",
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
		resume: false,
	},
	// One operator-set ACP command (#907): it reports no modes, so PrismaLens's ask policy decides each ask.
	local: {
		id: "local",
		label: "Local agent",
		binary: "",
		acpArgs: () => [],
		acpEnv: () => ({}),
		install: "Add it under Settings → Agent → Add agent → Local ACP command.",
		access: {
			supervised: LOCAL_NO_MODE,
			"auto-edits": LOCAL_NO_MODE,
			auto: LOCAL_NO_MODE,
			"full-access": LOCAL_NO_MODE,
		},
		modeMechanism: "none",
		modelVia: "acp",
		loginHint: "It signs in on its own.",
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
export function isSafeGatewayUrl(raw: string): boolean {
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
	"local",
];

/** Env names PrismaLens sets itself on this agent's child; Settings refuses them (#907). */
export function reservedEnvNames(id: HarnessId): string[] {
	const d = HARNESS_REGISTRY[id];
	const names = new Set(
		Object.keys(
			d.acpEnv({
				configDir: "x",
				dataDir: "x",
				cwd: "x",
				companionPath: "x",
				shipped: true,
			}),
		),
	);
	if (d.configDir) names.add(d.configDir.envKey);
	if (d.customModelEnvKey) names.add(d.customModelEnvKey);
	return [...names];
}

export const HARNESS_BINARY: Record<HarnessId, string> = Object.fromEntries(
	HARNESS_IDS.map((id) => [id, HARNESS_REGISTRY[id].binary]),
) as Record<HarnessId, string>;

/** A permission level on one agent (#673 w21 ruling 2026-10-10). */
export function resolveAccess(
	harnessId: HarnessId,
	level: AccessLevel,
): HarnessAccess {
	return HARNESS_REGISTRY[harnessId].access[level];
}

/** The first level whose mode is `modeId`; null for an id no level sets. */
export function levelOfAgentMode(
	harnessId: HarnessId,
	modeId: string | null,
): AccessLevel | null {
	if (!modeId) return null;
	const row = HARNESS_REGISTRY[harnessId];
	return ACCESS_LEVELS.find((l) => row.access[l].mode === modeId) ?? null;
}

/** `patch` over `base`, objects merged key by key, so keys the patch does not name stay. */
export function mergeConfigPatch(
	base: JsonObject,
	patch: JsonObject,
): JsonObject {
	const out: JsonObject = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const prev = out[key];
		out[key] =
			isObject(prev) && isObject(value) ? mergeConfigPatch(prev, value) : value;
	}
	return out;
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
	return `${row.label} picks its own model. Unstar ${model.trim()} in the picker above.`;
}

/** Why a finished run on `harnessId` cannot be continued, or null when it can (#747). */
export function resumeBlockedReason(harnessId: HarnessId): string | null {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.resume) return null;
	return `${row.label} can't reopen a finished session, so a new run starts from the report.`;
}
