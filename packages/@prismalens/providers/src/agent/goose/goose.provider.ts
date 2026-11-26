// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { codingPlan, defineAgent, modeNamed } from "../family.ts";

export const goose = defineAgent({
	id: "agent.goose",
	family: "agent",
	name: "goose",
	mark: { letters: "GO" },
	order: 49,
	launch: "goose",
	skips: [
		{
			case: "install",
			reason: "goose ships its CLI as a release archive, not on npm or PyPI",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "goose" },
		{ column: "Schedule.harness", value: "goose" },
	],
	// goose has no account of its own: it runs on the provider and key the user configures.
	auth: {
		methods: [
			{
				id: "login",
				label: "goose configure",
				steps: ["terminal"],
				terms: {
					runs: "allowed",
					source: {
						url: "https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/goose-cli-commands.md",
						clause: "Create a new scheduled job.",
						readOn: "2026-11-26",
					},
					gaps: ["the terms of the provider goose is configured to use"],
				},
			},
			codingPlan([
				{
					name: "ANTHROPIC_API_KEY",
					when: { name: "GOOSE_PROVIDER", is: "anthropic" },
				},
				{
					name: "OPENAI_API_KEY",
					when: { name: "GOOSE_PROVIDER", is: "openai" },
				},
			]),
			{
				id: "api-key",
				label: "GOOSE_PROVIDER and that provider's key",
				steps: ["credentials"],
				env: [{ name: "GOOSE_PROVIDER" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/goose-cli-commands.md",
						clause: "Create a new scheduled job.",
						readOn: "2026-11-26",
					},
					gaps: ["the terms of the provider goose is configured to use"],
				},
			},
		],
	},
	facts: {
		// No goose source states a cache lifetime, an auto-compact point or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["goose"],
		usageReports: [],
		ownSettingsNote: () =>
			"goose runs on the provider you configured for it, under that provider's terms.",
		install:
			"curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash",
		lines: {
			supervised: (c) => `goose runs in ${modeNamed(c, "approve", "approve")}.`,
			"auto-edits": (c) =>
				`goose has no mode for edits alone; it runs in ${modeNamed(c, "approve", "approve")}, as Ask does.`,
			auto: (c) =>
				`goose runs in ${modeNamed(c, "smart_approve", "smart_approve")}, where it asks for the calls it judges sensitive.`,
			"full-access": (c) => `goose runs in ${modeNamed(c, "auto", "auto")}.`,
		},
		loginHint: "`goose configure`, or `GOOSE_PROVIDER` and its key in env",
		signInArgs: ["configure"],
		loginEnvKeys: ["GOOSE_PATH_ROOT"],
	},
});
