// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, noModeLines } from "../family.ts";

export const grok = defineAgent({
	id: "agent.grok",
	family: "agent",
	name: "Grok Build",
	mark: { letters: "GR" },
	order: 47,
	launch: "grok",
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
		{ column: "Run.harness", value: "grok" },
		{ column: "Schedule.harness", value: "grok" },
	],
	// docs.x.ai/build/overview; PrismaLens never reads the login it stores.
	auth: {
		methods: [
			{
				id: "login",
				label: "Grok account",
				steps: ["terminal", "browser"],
				acp: "grok.com",
				terms: {
					runs: "allowed",
					source: {
						url: "https://docs.x.ai/build/cli/headless-scripting.md",
						clause:
							"Use headless mode for scripts, bots, or other machine-friendly tasks.",
						readOn: "2026-11-26",
					},
					against: {
						url: "https://x.ai/legal/acceptable-use-policy",
						clause:
							"Accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise",
						readOn: "2026-11-26",
					},
					gaps: [
						"x.ai/legal refuses automated fetches; its AUP was read from the Wayback copy of 2026-11-25",
					],
				},
			},
			{
				id: "api-key",
				label: "XAI_API_KEY",
				steps: ["credentials"],
				env: [{ name: "XAI_API_KEY" }],
				acp: "xai.api_key",
				terms: {
					runs: "allowed",
					source: {
						url: "https://docs.x.ai/build/cli/headless-scripting.md",
						clause:
							"Use headless mode for scripts, bots, or other machine-friendly tasks.",
						readOn: "2026-11-26",
					},
				},
			},
		],
	},
	facts: {
		// No Grok Build source states a cache lifetime, an auto-compact point or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["grok-build"],
		usageReports: [],
		install: "npm i -g @xai-official/grok (or the installer at x.ai/cli)",
		lines: noModeLines("Grok Build"),
		loginHint: "`grok login`, or `XAI_API_KEY` in env",
		signInArgs: ["login"],
		loginEnvKeys: ["GROK_HOME"],
	},
});
