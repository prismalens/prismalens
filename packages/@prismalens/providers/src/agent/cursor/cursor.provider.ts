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
				unattended: true,
			},
			{
				id: "api-key",
				label: "CURSOR_API_KEY or CURSOR_AUTH_TOKEN",
				steps: ["credentials"],
				unattended: true,
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
