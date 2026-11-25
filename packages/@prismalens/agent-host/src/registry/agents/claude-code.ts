// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { customBaseUrl, probed, SUBAGENTS_ON_STOP_DEFAULT } from "../row.js";

export const claudeCode = {
	id: "claude-code",
	label: "Claude Code",
	binary: "claude-agent-acp",
	companionBinary: "claude",
	adapterPackage: "@agentclientprotocol/claude-agent-acp",
	acpArgs: () => [],
	acpEnv: ({ companionPath, anthropicBaseUrl }) => ({
		...(companionPath ? { CLAUDE_CODE_EXECUTABLE: companionPath } : {}),
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		// Since 2.1.319 Auto denies a call a gateway keeps the server from reviewing; 0 runs Claude Code's own classifier (#1155).
		...(customBaseUrl(anthropicBaseUrl)
			? { CLAUDE_CODE_AUTO_MODE_SERVER: "0" }
			: {}),
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
		...probed({
			loadSession: true,
			images: true,
			embeddedContext: true,
			directories: true,
		}),
		systemPromptVia: {
			value: "claude-meta",
			via: "source",
			verifiedAt: { cli: "2.1.329", adapter: "0.109.0" },
			where: "src/v1/acp-agent.ts params._meta?.systemPrompt",
		},
		subagentsOnStop: {
			value: {
				stop: true,
				finish: true,
				note: "A sub-agent the turn waits on always stops with it; one running in the background follows this setting.",
			},
			via: "source",
			verifiedAt: { cli: "2.1.329", adapter: "0.109.0" },
			where:
				"src/v1/acp-agent.ts perTaskStopAffordance, stopsWorkflowsOnCancel",
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
} satisfies AgentDescriptor;
