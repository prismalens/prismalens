// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agents and their launch facts, copied from PrismaLens's harness registry
 * (`packages/@prismalens/config/src/providers/harness.ts`). Every agent speaks ACP
 * over stdio (ADR 0003). Copy, `tested` pins and model resolution stay in each product (#916).
 */
import type { AgentFact, AgentFacts, FactVersions } from "./facts.js";
import type { AccessLevel, LevelFacts, ModeMechanism } from "./levels.js";
import { opencodePermission } from "./opencode.js";

export const AGENT_IDS = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
	"local",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Per-run paths and facts a row's launch functions read. */
export interface AgentRunEnv {
	configDir: string;
	/** Empty per-run dir an agent can be pointed at for config it would otherwise read from the user's home. */
	dataDir: string;
	cwd: string;
	/** Absolute path of the row's `companionBinary` on PATH, when found. */
	companionPath?: string;
	/** The run starts the adapter the product ships, not one on PATH (#818). */
	shipped?: boolean;
	/** The product's MCP gateway and its per-run server name, set for a row with `gatewayDelivery` (#848). */
	gateway?: { url: string; token: string; name: string };
}

/**
 * Where an agent reads one sub-agent limit (#1024 spec B): an env var, a key inside a
 * JSON env var, or a key in one of the row's config files. Data, applied like `acpEnv`.
 */
export type SubagentLimitKey =
	| { env: string }
	| { jsonEnv: string; path: readonly string[] }
	| { configFile: string; path: readonly string[] };

/**
 * What happens to a turn's running in-session sub-agents when the user stops the turn
 * (#1101 cat 10, amendment 2026-11-13). Sub-agents are the agent's own helpers, never threads.
 */
export type SubagentStopChoice = "stop" | "finish";
export const SUBAGENTS_ON_STOP_DEFAULT: SubagentStopChoice = "stop";

/** The run file a `gatewayDelivery: "mcp-config-file"` row hands its agent. */
export const GATEWAY_RUN_FILE = "prismalens-mcp.json";

/** `configDir` joined without node:path, which this browser-safe module cannot import. */
const inConfigDir = (env: AgentRunEnv, file: string) =>
	`${env.configDir}${env.configDir.includes("\\") ? "\\" : "/"}${file}`;

export interface AgentDescriptor {
	id: AgentId;
	label: string;
	/** Binary looked up on PATH; empty for `local`, whose command the user sets. */
	binary: string;
	/** The vendor's own CLI the adapter drives, when it is a separate install. */
	companionBinary?: string;
	/** The npm package of the ACP adapter a product may ship for this agent (#818). */
	adapterPackage?: string;
	/** argv for `binary` that starts an ACP server on stdio in `cwd`. */
	acpArgs: (env: AgentRunEnv) => string[];
	/** Env vars the host sets on the child; Settings refuses them as stored values. */
	acpEnv: (env: AgentRunEnv) => Record<string, string>;
	/** Files written under configDir before the run. */
	configFiles?: (env: AgentRunEnv) => Record<string, string>;
	/** This config file goes inline in the env key instead, merged over a value the user set there. */
	configEnv?: { file: string; key: string };
	/** The agent ignores ACP `mcpServers`; the gateway goes in a run file instead (#848). */
	gatewayDelivery?: "mcp-config-file";
	/** `_meta` on ACP `session/new`; it may follow the user's sub-agent stop choice. */
	sessionMeta?: (o?: {
		subagentsOnStop?: SubagentStopChoice;
	}) => Record<string, unknown>;
	/** What PrismaLens relies on this agent to do, each with the versions it was checked on; absent, nothing. */
	facts?: AgentFacts;
	/** Each permission level on this agent (#673 w21 ruling 2026-10-10). */
	levels: Record<AccessLevel, LevelFacts>;
	/** The agent's own display name for each mode id a level uses, so no product shows a made-up label (#907). */
	modeNames: Readonly<Record<string, string>>;
	modeMechanism: ModeMechanism;
	/** Modes the agent runs under its OS sandbox with no network, per its source; a probe still decides `enforced`. */
	sandboxedModes?: readonly string[];
	/** `acp`: the session's own `model` config option; `unsupported`: a set model refuses the run. */
	modelVia: "acp" | "unsupported";
	/** Its handshake answers signed out: credentials are checked at the first prompt turn. */
	signInAtFirstTurn?: boolean;
	/** The host env var naming the model the agent runs when the host sets none. */
	envModelKey?: string;
	/** The env var that adds one model id to the agent's own list (#673 w57). */
	customModelEnvKey?: string;
	/** Provider env vars this agent reads from the host (ADR 0004 §3: an allowlist, never a wildcard). */
	providerKeys: readonly string[];
	/** The env var naming the agent's own config folder (#907). */
	configDir?: { envKey: string; shownDefault: string };
	/** The agent's documented keys for in-session sub-agent limits; absent, the agent sets its own. */
	subagentLimits?: {
		depth?: SubagentLimitKey;
		concurrency?: SubagentLimitKey;
	};
}

type ProbedValues = {
	[K in "loadSession" | "images" | "embeddedContext" | "directories"]: boolean;
};

/** A row's probed facts, all checked on the same versions: the nightly probe asserts them (#1101). */
function probed(at: FactVersions, values: ProbedValues) {
	const fact = (value: boolean): AgentFact<boolean, "probe"> => ({
		value,
		via: "probe",
		verifiedAt: at,
	});
	return {
		loadSession: fact(values.loadSession),
		images: fact(values.images),
		embeddedContext: fact(values.embeddedContext),
		directories: fact(values.directories),
	};
}

/**
 * The versions each row's probed facts were last checked on, one line a row: the pin-bump
 * PR moves a line once its probe passed (`scripts/agent-facts.mjs sync`).
 */
export const PROBED_AT = {
	opencode: { cli: "1.19.5", adapter: null },
	"claude-code": { cli: "2.1.318", adapter: "0.100.0" },
	codex: { cli: "0.166.0", adapter: "2.5.0" },
	gemini: { cli: "0.65.0", adapter: null },
} as const satisfies Partial<Record<string, FactVersions>>;

/** A finished run can be reopened with session/load or session/resume (#747). */
export const reopens = (row: Pick<AgentDescriptor, "facts">): boolean =>
	row.facts?.loadSession.value === true;

function noMode(): Record<AccessLevel, LevelFacts> {
	const facts: LevelFacts = { mode: null, mechanism: "none" };
	return {
		supervised: facts,
		"auto-edits": facts,
		auto: facts,
		"full-access": facts,
	};
}

export const AGENT_REGISTRY: Readonly<Record<AgentId, AgentDescriptor>> = {
	opencode: {
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		// No directory flag: OpenCode 2.x exits on one; the spawn and session/new name the folder (#1013).
		acpArgs: () => ["acp"],
		// The user's XDG_CONFIG_HOME and OPENCODE_CONFIG_DIR stay theirs; the run's config loads last, inline (#791, #817).
		acpEnv: () => ({}),
		configEnv: { file: "opencode.json", key: "OPENCODE_CONFIG_CONTENT" },
		configFiles: () => ({
			"opencode.json": JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					// Without it a refused tool ends the turn (#639 finding 1).
					experimental: { continue_loop_on_deny: true },
					share: "disabled",
				},
				null,
				2,
			),
		}),
		providerKeys: [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GEMINI_API_KEY",
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"GOOGLE_API_KEY",
			"OPENROUTER_API_KEY",
		],
		// OpenCode offers its agents as the ACP `mode` config option; a level is a catch-all overlay on its rules.
		levels: {
			supervised: {
				mode: "build",
				configPatch: opencodePermission("ask", "ask"),
				mechanism: "opencode-permission",
			},
			"auto-edits": {
				mode: "build",
				configPatch: opencodePermission("allow", "ask"),
				mechanism: "opencode-permission",
			},
			auto: {
				mode: "build",
				configPatch: opencodePermission("ask", "ask"),
				mechanism: "opencode-permission",
			},
			"full-access": {
				mode: "build",
				configPatch: opencodePermission("allow", "allow"),
				mechanism: "opencode-permission",
			},
		},
		modeNames: { build: "Build", plan: "Plan" },
		modeMechanism: "acp",
		modelVia: "acp",
		subagentLimits: {
			depth: {
				configFile: "opencode.json",
				path: ["experimental", "subagent_depth"],
			},
		},
		facts: {
			...probed(PROBED_AT.opencode, {
				loadSession: true,
				images: true,
				embeddedContext: true,
				directories: false,
			}),
			subagentsOnStop: {
				value: {
					stop: false,
					finish: false,
					note: "OpenCode decides: a sub-agent the turn waits on stops with it, and one it sent to the background finishes.",
				},
				via: "source",
				verifiedAt: { cli: "1.19.5", adapter: null },
				where: "packages/opencode/src/tool/task.ts onAbort, background.start",
			},
		},
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
		// The user's settings plus the repo's own (#817); without the plan-mode tools it cannot leave the run's mode (#673 w7-4).
		sessionMeta: (o) => ({
			claudeCode: {
				options: {
					settingSources: ["user", "project", "local"],
					disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
					// Off, a cancel's interrupt stops background sub-agents too (fact `subagentsOnStop`).
					perTaskStopAffordance:
						(o?.subagentsOnStop ?? SUBAGENTS_ON_STOP_DEFAULT) === "finish",
				},
			},
		}),
		facts: {
			...probed(PROBED_AT["claude-code"], {
				loadSession: true,
				images: true,
				embeddedContext: true,
				directories: true,
			}),
			systemPromptVia: {
				value: "claude-meta",
				via: "source",
				verifiedAt: { cli: "2.1.318", adapter: "0.100.0" },
				where: "src/acp-agent.ts params._meta?.systemPrompt",
			},
			subagentsOnStop: {
				value: {
					stop: true,
					finish: true,
					note: "A sub-agent the turn waits on always stops with it; one running in the background follows this setting.",
				},
				via: "source",
				verifiedAt: { cli: "2.1.318", adapter: "0.100.0" },
				where: "src/acp-agent.ts perTaskStopAffordance, stopsWorkflowsOnCancel",
			},
		},
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
		// claude-agent-acp 0.81.1 takes an id outside its list only through this (#808 probe).
		customModelEnvKey: "ANTHROPIC_CUSTOM_MODEL_OPTION",
		levels: {
			supervised: { mode: "default", mechanism: "acp-mode" },
			"auto-edits": { mode: "acceptEdits", mechanism: "acp-mode" },
			// A custom model id is outside the adapter's model list, so the CLI itself can refuse Auto (#809).
			auto: {
				mode: "auto",
				fallbackMode: "acceptEdits",
				mechanism: "acp-mode",
			},
			"full-access": {
				mode: "bypassPermissions",
				fallbackMode: "acceptEdits",
				mechanism: "acp-mode",
			},
		},
		modeNames: {
			default: "Manual",
			acceptEdits: "Accept Edits",
			auto: "Auto",
			bypassPermissions: "Bypass Permissions",
		},
		modeMechanism: "acp",
		modelVia: "acp",
		signInAtFirstTurn: true,
		configDir: { envKey: "CLAUDE_CONFIG_DIR", shownDefault: "~/.claude" },
		subagentLimits: {
			depth: { env: "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH" },
			concurrency: { env: "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS" },
		},
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex-acp",
		companionBinary: "codex",
		adapterPackage: "@agentclientprotocol/codex-acp",
		acpArgs: () => [],
		acpEnv: ({ companionPath, shipped }) => ({
			// codex-acp reads an env key only once the client picks its api-key method (#634).
			DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
			// The shipped adapter has no codex of its own; a PATH install keeps its bundled one (#818).
			...(shipped && companionPath ? { CODEX_PATH: companionPath } : {}),
		}),
		// codex-acp README: CODEX_API_KEY wins over OPENAI_API_KEY for the api-key method.
		providerKeys: ["CODEX_API_KEY", "OPENAI_API_KEY"],
		// codex-acp 2.2.2 src/AgentMode.ts, set through its `mode` config option. Before 2.0 there was
		// no workspace-write (codex-acp#480); the fallback keeps an older PATH install working.
		levels: {
			supervised: { mode: "read-only", mechanism: "acp-config" },
			"auto-edits": {
				mode: "workspace-write",
				fallbackMode: "read-only",
				mechanism: "acp-config",
			},
			auto: { mode: "agent", mechanism: "acp-config" },
			"full-access": { mode: "agent-full-access", mechanism: "acp-config" },
		},
		modeNames: {
			"read-only": "Read-only",
			"workspace-write": "Workspace access",
			agent: "Auto review",
			"agent-full-access": "Full access",
		},
		modeMechanism: "acp",
		sandboxedModes: ["read-only", "workspace-write", "agent"],
		modelVia: "acp",
		configDir: { envKey: "CODEX_HOME", shownDefault: "~/.codex" },
		// codex-acp takes Codex's `agents.max_depth` / `max_threads` through CODEX_CONFIG, not `-c` (README, Runtime options).
		subagentLimits: {
			depth: { jsonEnv: "CODEX_CONFIG", path: ["agents", "max_depth"] },
			concurrency: { jsonEnv: "CODEX_CONFIG", path: ["agents", "max_threads"] },
		},
		facts: {
			...probed(PROBED_AT.codex, {
				loadSession: true,
				images: true,
				embeddedContext: true,
				directories: true,
			}),
			subagentsOnStop: {
				value: {
					stop: false,
					finish: false,
					note: "Codex decides: a stop interrupts its main conversation, and nothing in its protocol chooses for its sub-agents.",
				},
				via: "source",
				verifiedAt: { cli: "0.166.0", adapter: "2.5.0" },
				where: "src/CodexAcpServer.ts cancel(), interruptSessionTurn",
			},
		},
	},
	gemini: {
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		acpArgs: () => ["--acp"],
		// Trust is the user's own folderTrust setting; this row forces neither way (#817).
		acpEnv: () => ({}),
		providerKeys: ["GEMINI_API_KEY"],
		// gemini-cli buildAvailableModes (packages/cli/src/acp/acpUtils.ts); no reviewer, so Auto runs `default` (#907).
		levels: {
			supervised: { mode: "default", mechanism: "acp-mode" },
			"auto-edits": { mode: "autoEdit", mechanism: "acp-mode" },
			auto: { mode: "default", mechanism: "acp-mode" },
			"full-access": { mode: "yolo", mechanism: "acp-mode" },
		},
		modeNames: { default: "Default", autoEdit: "Auto Edit", yolo: "YOLO" },
		modeMechanism: "acp",
		modelVia: "unsupported",
		configDir: {
			envKey: "GEMINI_CLI_HOME",
			shownDefault: "your home folder (holds .gemini)",
		},
		facts: {
			...probed(PROBED_AT.gemini, {
				loadSession: true,
				images: true,
				embeddedContext: true,
				directories: false,
			}),
			regroupsLinks: {
				value: true,
				via: "source",
				verifiedAt: { cli: "0.65.0", adapter: null },
				where:
					"packages/cli/src/acp/acpSession.ts #resolvePrompt atPathCommandParts",
			},
			subagentsOnStop: {
				value: {
					stop: true,
					finish: false,
					note: "Its sub-agents always stop with the turn.",
				},
				via: "source",
				verifiedAt: { cli: "0.65.0", adapter: null },
				where:
					"packages/cli/src/acp/acpSession.ts pendingSend.signal into runTool",
			},
		},
	},
	deepagents: {
		id: "deepagents",
		label: "deepagents",
		// deepagents-code's `dcode --acp` is the ACP server (#634). It ignores ACP mcpServers:
		// the gateway goes in by --mcp-config, beside the user's own servers (#848).
		binary: "dcode",
		gatewayDelivery: "mcp-config-file",
		acpArgs: (env) =>
			env.gateway
				? ["--acp", "--mcp-config", inConfigDir(env, GATEWAY_RUN_FILE)]
				: ["--acp"],
		acpEnv: () => ({}),
		configFiles: (env): Record<string, string> =>
			env.gateway
				? {
						[GATEWAY_RUN_FILE]: JSON.stringify({
							mcpServers: {
								[env.gateway.name]: {
									type: "http",
									url: env.gateway.url,
									headers: { Authorization: `Bearer ${env.gateway.token}` },
								},
							},
						}),
					}
				: {},
		providerKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
		// No modes over ACP (deepagents #4254): the host answers each ask by the level.
		levels: noMode(),
		modeNames: {},
		modeMechanism: "none",
		modelVia: "unsupported",
	},
	// One user-set ACP command (#907): no modes, so the host's ask policy decides each ask.
	local: {
		id: "local",
		label: "Local agent",
		binary: "",
		acpArgs: () => [],
		acpEnv: () => ({}),
		providerKeys: [],
		levels: noMode(),
		modeNames: {},
		modeMechanism: "none",
		modelVia: "acp",
	},
};
