// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, noModeLines } from "../family.ts";

export const local = defineAgent({
	id: "agent.local",
	family: "agent",
	name: "Local agent",
	// An agent of the user's own has no owner's logo, so it takes letters.
	mark: { letters: "LA" },
	order: 60,
	launch: "local",
	skips: [
		{
			case: "install",
			reason:
				"the user sets its command in Settings; there is nothing to install",
		},
		{
			case: "unattended",
			reason: "it signs in on its own, outside PrismaLens",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "local" },
		{ column: "Schedule.harness", value: "local" },
	],
	facts: {
		// An agent PrismaLens knows nothing about.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		commandSetByUser: true,
		install: "Add it under Settings → Agents → Add agent → Local ACP command.",
		lines: noModeLines("Local agent"),
		loginHint: "It signs in on its own.",
	},
});
