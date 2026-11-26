// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, modeNamed } from "../family.ts";

export const qwen = defineAgent({
	id: "agent.qwen",
	family: "agent",
	name: "Qwen Code",
	mark: { letters: "QW" },
	order: 48,
	launch: "qwen",
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
		{ column: "Run.harness", value: "qwen" },
		{ column: "Schedule.harness", value: "qwen" },
	],
	// QwenLM/qwen-code docs/users/configuration/auth.md; its free OAuth tier ended 2026-04-15.
	auth: {
		methods: [
			{
				id: "api-key",
				label: "OPENAI_API_KEY, OPENAI_MODEL and OPENAI_BASE_URL",
				steps: ["credentials"],
				unattended: true,
			},
		],
	},
	facts: {
		// No Qwen Code source states a cache lifetime, an auto-compact point or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["qwen-code"],
		usageReports: [],
		// Alibaba Cloud's Coding Plan page: "Do not use the plan's API key for automated scripts" (#1236).
		ownSettingsNote: () =>
			"An Alibaba Cloud Coding Plan key is for interactive use only; runs an alert starts need another key.",
		settingsFile: "~/.qwen/settings.json",
		install: "npm i -g @qwen-code/qwen-code",
		lines: {
			supervised: (c) =>
				`Qwen Code runs in ${modeNamed(c, "default", "Default")}.`,
			"auto-edits": (c) =>
				`Qwen Code runs in ${modeNamed(c, "auto-edit", "Auto Edit")}.`,
			auto: (c) =>
				`Qwen Code runs in ${modeNamed(c, "auto", "Auto")}, where its own classifier approves safe actions.`,
			"full-access": (c) =>
				`Qwen Code runs in ${modeNamed(c, "yolo", "YOLO")}.`,
		},
		loginHint:
			"`OPENAI_API_KEY`, `OPENAI_MODEL` and `OPENAI_BASE_URL` in env, or a model set in `qwen`",
		loginEnvKeys: ["QWEN_HOME"],
	},
});
