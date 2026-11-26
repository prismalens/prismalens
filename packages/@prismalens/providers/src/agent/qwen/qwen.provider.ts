// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { codingPlan, defineAgent, modeNamed } from "../family.ts";

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
				id: "login",
				label: "Qwen account",
				steps: ["terminal", "browser"],
				terms: {
					runs: "interactive-only",
					source: {
						url: "https://qwen.ai/termsservice",
						clause:
							"Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service.",
						readOn: "2026-11-26",
					},
					gaps: [
						"qwen.ai/termsservice renders only with JavaScript: read from its bundle g.alicdn.com/qwenweb/qwen-ai-fe/0.0.91/js/9253.js, no browser read",
					],
				},
			},
			codingPlan(["OPENAI_API_KEY"], "OPENAI_BASE_URL"),
			{
				id: "api-key",
				label: "OPENAI_API_KEY, OPENAI_MODEL and OPENAI_BASE_URL",
				steps: ["credentials"],
				env: [{ name: "OPENAI_API_KEY" }],
				acp: "openai",
				terms: {
					runs: "allowed",
					source: {
						url: "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md",
						clause:
							"Headless mode allows you to run Qwen Code programmatically from command line scripts and automation tools without any interactive UI.",
						readOn: "2026-11-26",
					},
					gaps: ["Alibaba Cloud Model Studio's legal agreement"],
				},
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
