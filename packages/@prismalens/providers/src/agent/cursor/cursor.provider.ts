// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, type Lines } from "../family.ts";

// Its agent, plan and ask modes are its own, not levels; PrismaLens answers its asks.
const line = () =>
	"Cursor's modes are not permission levels; PrismaLens answers its asks by this level.";
const lines: Lines = {
	supervised: line,
	"auto-edits": line,
	auto: line,
	"full-access": line,
};

export const cursor = defineAgent({
	id: "agent.cursor",
	family: "agent",
	name: "Cursor",
	mark: { letters: "CU" },
	order: 42,
	launch: "cursor",
	skips: [
		{
			case: "install",
			reason: "Cursor ships its CLI from its own installer, not npm or PyPI",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "cursor" },
		{ column: "Schedule.harness", value: "cursor" },
	],
	// cursor.com/docs/cli/reference/authentication; PrismaLens never reads the login it stores.
	auth: {
		methods: [
			{
				id: "login",
				label: "Cursor account",
				steps: ["terminal", "browser"],
				terms: {
					runs: "allowed",
					source: {
						url: "https://cursor.com/docs/cli/headless",
						clause:
							"Use Cursor CLI in scripts and automation workflows for code analysis, generation, and refactoring tasks.",
						readOn: "2026-11-26",
					},
					gaps: [
						"cursor.com/acceptable-use: renders no text without JavaScript",
					],
				},
			},
			{
				id: "api-key",
				label: "CURSOR_API_KEY or CURSOR_AUTH_TOKEN",
				steps: ["credentials"],
				env: [{ name: "CURSOR_API_KEY" }, { name: "CURSOR_AUTH_TOKEN" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://cursor.com/docs/cli/reference/authentication",
						clause:
							"For automation, scripts, or CI environments, use API key authentication",
						readOn: "2026-11-26",
					},
					gaps: [
						"cursor.com/acceptable-use: renders no text without JavaScript",
					],
				},
			},
		],
	},
	facts: {
		// No Cursor source states a cache lifetime, an auto-compact point or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["cursor"],
		usageReports: [],
		// Its `acp` command is hidden and unversioned: the install it was written against (#1235).
		install:
			"curl https://cursor.com/install -fsS | bash (Windows: irm 'https://cursor.com/install?win32=true' | iex)",
		lines,
		noLevelReason:
			"Cursor's Agent, Plan and Ask modes are not permission levels.",
		loginHint: "`cursor-agent login`, or `CURSOR_API_KEY` in env",
		signInArgs: ["login"],
	},
});
