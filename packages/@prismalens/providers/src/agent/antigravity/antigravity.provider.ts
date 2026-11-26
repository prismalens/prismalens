// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, modeNamed } from "../family.ts";

export const antigravity = defineAgent({
	id: "agent.antigravity",
	family: "agent",
	name: "Antigravity",
	mark: { letters: "AG" },
	order: 44,
	launch: "antigravity",
	skips: [
		{
			case: "install",
			reason:
				"Google ships its ACP server as a zip per platform, not on npm or PyPI",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "antigravity" },
		{ column: "Schedule.harness", value: "antigravity" },
	],
	auth: {
		methods: [
			{
				id: "login",
				label: "Google account",
				steps: ["terminal", "browser"],
				terms: {
					runs: "never",
					source: {
						url: "https://antigravity.google/faq.md",
						clause:
							"Wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans.",
						readOn: "2026-11-26",
					},
				},
			},
			{
				id: "api-key",
				label: "GEMINI_API_KEY",
				steps: ["credentials"],
				env: [{ name: "GEMINI_API_KEY" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://antigravity.google/faq.md",
						clause:
							"To use a third-party coding agent with Gemini, we recommend using a Gemini Enterprise or Google AI Studio API key.",
						readOn: "2026-11-26",
					},
				},
			},
		],
		precedence: {
			first: "login",
			source: {
				url: "https://antigravity.google/docs/ide/extensions/acp.md",
				clause:
					"`agy acp` uses the credentials you cached with an interactive `agy` session.",
				readOn: "2026-11-26",
			},
		},
	},
	facts: {
		// No Antigravity source states a cache lifetime, an auto-compact point or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["antigravity-acp"],
		vendor: "google",
		usageReports: [],
		ownSettingsNote: () =>
			"Antigravity's own settings apply, as in your terminal; which runs each sign-in may start is under Sign-in.",
		install:
			"Download Google Antigravity's ACP server for your platform (agentclientprotocol.com registry, antigravity-acp) and put agy_acp_server on PATH",
		lines: {
			supervised: (c) =>
				`Antigravity runs in ${modeNamed(c, "default", "Default")}.`,
			"auto-edits": (c) =>
				`Antigravity runs in ${modeNamed(c, "auto_edit", "Auto Edit")}.`,
			auto: (c) =>
				`Antigravity has no reviewer of its own; it runs in ${modeNamed(c, "default", "Default")}, as Ask always does.`,
			"full-access": (c) =>
				`Antigravity runs in ${modeNamed(c, "yolo", "YOLO")}.`,
		},
		loginHint:
			"Google sign-in, which Antigravity opens in your browser on its first check, or `GEMINI_API_KEY` in env",
		loginEnvKeys: ["GEMINI_HOME"],
	},
});
