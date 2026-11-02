// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agents and their launch facts, copied from PrismaLens's harness registry
 * (`packages/@prismalens/config/src/providers/harness.ts`). Every agent speaks ACP
 * over stdio (ADR 0003). Copy, `tested` pins and model resolution stay in each product (#916).
 */
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
	/** `_meta` on ACP `session/new`. */
	sessionMeta?: () => Record<string, unknown>;
	/** The host's brief goes in as an appended system prompt (`_meta.systemPrompt.append`); otherwise in the first prompt (#817). */
	systemPromptVia?: "claude-meta";
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
	/** The row passed the resume probe, so a finished run can be continued with session/load (#747). */
	resume: boolean;
	/** The env var naming the agent's own config folder (#907). */
	configDir?: { envKey: string; shownDefault: string };
}

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
		// The user's settings plus the repo's own (#817); without the plan-mode tools it cannot leave the run's mode (#673 w7-4).
		sessionMeta: () => ({
			claudeCode: {
				options: {
					settingSources: ["user", "project", "local"],
					disallowedTools: ["EnterPlanMode", "ExitPlanMode"],
				},
			},
		}),
		// claude-agent-acp 0.81.1 reads `_meta.systemPrompt` on session/new and session/load
		// (acp-agent.js:6215-6232; load reaches it through getOrCreateSession, :6084-6112).
		systemPromptVia: "claude-meta",
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
		resume: true,
		configDir: { envKey: "CODEX_HOME", shownDefault: "~/.codex" },
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
		resume: true,
		configDir: {
			envKey: "GEMINI_CLI_HOME",
			shownDefault: "your home folder (holds .gemini)",
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
		resume: false,
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
		resume: false,
	},
};
