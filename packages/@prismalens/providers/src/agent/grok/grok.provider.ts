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
				unattended: true,
			},
			{
				id: "api-key",
				label: "XAI_API_KEY",
				steps: ["credentials"],
				unattended: true,
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
		// xAI's Acceptable Use Policy (2026-08-14) lists "using bots to access" its Service (#1236).
		ownSettingsNote: () =>
			"xAI's API key is made for programs; runs an alert starts on a Grok sign-in are your call under xAI's terms.",
		install: "npm i -g @xai-official/grok (or the installer at x.ai/cli)",
		lines: noModeLines("Grok Build"),
		loginHint: "`grok login`, or `XAI_API_KEY` in env",
		signInArgs: ["login"],
		loginEnvKeys: ["GROK_HOME"],
	},
});
