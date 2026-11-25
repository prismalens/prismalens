// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, type Lines } from "../family.ts";

// Its Agent, Plan and Autopilot modes are its own, not levels; PrismaLens answers its asks.
const line = () =>
	"GitHub Copilot's modes are not permission levels; PrismaLens answers its asks by this level.";
const lines: Lines = {
	supervised: line,
	"auto-edits": line,
	auto: line,
	"full-access": line,
};

export const copilot = defineAgent({
	id: "agent.copilot",
	family: "agent",
	name: "GitHub Copilot",
	mark: { letters: "CP" },
	order: 45,
	launch: "copilot",
	skips: [
		{
			case: "install",
			reason:
				"No pin yet: its npm pin lands with a qualification leg against the scripted model",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "copilot" },
		{ column: "Schedule.harness", value: "copilot" },
	],
	// docs.github.com copilot-cli authenticate-copilot-cli; PrismaLens never reads the login it stores.
	auth: {
		methods: [
			{
				id: "login",
				label: "GitHub account",
				steps: ["terminal", "browser"],
				unattended: true,
			},
			{
				id: "api-key",
				label: "COPILOT_GITHUB_TOKEN",
				steps: ["credentials"],
				unattended: true,
			},
		],
	},
	facts: {
		// No Copilot source states a cache lifetime; it compacts at 0.8 of the window (`copilot help environment`).
		cacheTtlMinutes: null,
		autoCompactPercent: 80,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["github-copilot-cli"],
		usageReports: [],
		install: "npm i -g @github/copilot (or winget install GitHub.Copilot)",
		lines,
		noLevelReason:
			"GitHub Copilot's Agent, Plan and Autopilot modes are not permission levels.",
		loginHint: "`copilot login`, or `COPILOT_GITHUB_TOKEN` in env",
		signInArgs: ["login"],
		loginEnvKeys: ["COPILOT_HOME"],
	},
});
