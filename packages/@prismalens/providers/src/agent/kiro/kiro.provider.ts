// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, noModeLines } from "../family.ts";

export const kiro = defineAgent({
	id: "agent.kiro",
	family: "agent",
	name: "Kiro",
	mark: { letters: "KR" },
	order: 46,
	launch: "kiro",
	skips: [
		{
			case: "install",
			reason: "Kiro ships its CLI from its own installer, not npm or PyPI",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "kiro" },
		{ column: "Schedule.harness", value: "kiro" },
	],
	// kiro.dev/docs/cli/authentication; KIRO_API_KEY is for paid plans (kiro.dev/docs/cli/headless).
	auth: {
		methods: [
			{
				id: "login",
				label: "Kiro account",
				steps: ["terminal", "browser"],
				unattended: true,
			},
			{
				id: "api-key",
				label: "KIRO_API_KEY",
				steps: ["credentials"],
				unattended: true,
			},
		],
	},
	facts: {
		// No Kiro source states a cache lifetime, an auto-compact point or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["kiro"],
		usageReports: [],
		install:
			"curl -fsSL https://cli.kiro.dev/install | bash (Windows: the installer at kiro.dev/docs/cli)",
		lines: noModeLines("Kiro"),
		loginHint: "`kiro-cli login`, or `KIRO_API_KEY` in env",
		signInArgs: ["login"],
		loginEnvKeys: ["KIRO_HOME"],
	},
});
