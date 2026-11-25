// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineEntryPoint } from "../descriptor.ts";

export const settingsAgents = defineEntryPoint({
	id: "settings.agents",
	family: "agent",
	required: true,
	about:
		"Settings → Agents: each agent's readiness, sign-in and permission level.",
	screen: "packages/frontend/src/components/settings/HarnessSettings.tsx",
});

export const agentPicker = defineEntryPoint({
	id: "composer.agent-picker",
	family: "agent",
	required: true,
	about:
		"The agent picker on every composer and schedule, where a run chooses its agent.",
	screen: "packages/frontend/src/components/agent/AgentPicker.tsx",
});

export const firstRun = defineEntryPoint({
	id: "incidents.first-run",
	family: "agent",
	required: true,
	about:
		"The first-run checklist, done once the selected agent answers a check.",
	screen: "packages/frontend/src/components/incidents/FirstRunPanel.tsx",
});
