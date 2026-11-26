// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const agentAgents = define.setting({
	id: "agent.agents",
	page: "agent",
	anchor: "harness-registry",
	label: "Agents",
	sentence: "The coding agents on this computer; add one or check it.",
	also: "claude code codex opencode gemini install sign in",
});

export const agentSubAgentDepthAndConcurrency = define.setting({
	id: "agent.subAgentDepthAndConcurrency",
	page: "agent",
	anchor: "harness-subagents",
	label: "Sub-agents",
	sentence: "Limits on the sub-agents inside one agent's turn.",
	also: "subagent sub-agent",
});

export const agentResumeAfterAUsageLimit = define.setting({
	id: "agent.resumeAfterAUsageLimit",
	page: "agent",
	anchor: "harness-resume-after-limit-row",
	label: "Resume after a usage limit",
	sentence: "The run carries on when the limit resets.",
	also: "limit quota",
});

export const agentResumeAfterARestart = define.setting({
	id: "agent.resumeAfterARestart",
	page: "agent",
	anchor: "harness-resume-after-restart-row",
	label: "Resume after a restart",
	sentence:
		"Runs a restart cut off carry on when PrismaLens starts again within a day.",
});

export const agentWhenAConversationHasGoneCold = define.setting({
	id: "agent.whenAConversationHasGoneCold",
	page: "agent",
	anchor: "harness-cold-resume-row",
	label: "When a conversation has gone cold",
	sentence: "Large conversations re-read everything once idle.",
	also: "cache expired resume cold",
});

export const agentOnlyPassNamedVariables = define.setting({
	id: "agent.onlyPassNamedVariables",
	page: "agent",
	anchor: "harness-strict-env-row",
	label: "Only pass named variables",
	sentence: "Agents get named variables only, not your environment.",
	also: "environment env secrets",
});

export const agentSharedSet = define.setting({
	id: "agent.sharedSet",
	page: "agent",
	anchor: "agent-shared-set",
	label: "PrismaLens set",
	sentence:
		"Instructions and MCP servers PrismaLens sends to the agents you pick.",
	also: "shared mcp server instructions setup",
});

/** Drawn on each agent's own page, so search opens the Agents page's top. */
export const agentUseSharedSet = define.setting({
	id: "agent.useSharedSet",
	page: "agent",
	label: "Use PrismaLens set",
	sentence: "This agent gets the PrismaLens set's instructions and servers.",
	also: "shared mcp server instructions",
});

export const agentCheckEvery = define.setting({
	id: "agent.checkEvery",
	page: "agent",
	anchor: "harness-check-every-row",
	label: "Check every",
	sentence: "Agents with a safe check are checked in the background.",
	also: "refresh background check interval",
});

export const agentCleanProfile = define.setting({
	id: "agent.cleanProfile",
	page: "agent",
	anchor: "agent-clean-profile-row",
	label: "Clean profile",
	sentence: "Skips your hooks and plugins.",
	also: "hooks plugins mcp isolate",
});
