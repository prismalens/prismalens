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
	label: "Sub-agent depth and concurrency",
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
	sentence: "Runs a restart cut off carry on when PrismaLens starts again.",
});

export const agentWhenAConversationHasGoneCold = define.setting({
	id: "agent.whenAConversationHasGoneCold",
	page: "agent",
	anchor: "harness-cold-resume-row",
	label: "When a conversation has gone cold",
	sentence: "What sending does once the agent's cache has expired.",
	also: "cache compact",
});

export const agentOnlyPassNamedVariables = define.setting({
	id: "agent.onlyPassNamedVariables",
	page: "agent",
	anchor: "harness-strict-env-row",
	label: "Only pass named variables",
	sentence: "Agents get named variables only, not your environment.",
	also: "environment env secrets",
});
