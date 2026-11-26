// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { channelOf, codingPlan, defineAgent, testedOf } from "../family.ts";
import pin from "./pin.json" with { type: "json" };

export const opencode = defineAgent({
	id: "agent.opencode",
	family: "agent",
	name: "OpenCode",
	// Its own published logo in both themes: opencode.ai/brand (assets/brands.ts).
	mark: { brand: "opencode" },
	order: 10,
	launch: "opencode",
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "opencode" },
		{ column: "Schedule.harness", value: "opencode" },
	],
	auth: {
		methods: [
			{
				id: "login",
				label: "OpenCode auth login",
				steps: ["terminal", "browser"],
				terms: {
					runs: "allowed",
					source: {
						url: "https://opencode.ai/docs/cli/",
						clause:
							"It is designed for scripts, CI jobs, and other workflows that need model output directly in the terminal.",
						readOn: "2026-11-26",
					},
					gaps: ["the terms of the provider it is signed in to"],
				},
			},
			codingPlan(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]),
			{
				id: "provider-key",
				label: "A provider key in env",
				steps: ["credentials"],
				env: [
					{ name: "ANTHROPIC_API_KEY" },
					{ name: "OPENAI_API_KEY" },
					{ name: "GEMINI_API_KEY" },
					{ name: "GOOGLE_GENERATIVE_AI_API_KEY" },
					{ name: "GOOGLE_API_KEY" },
					{ name: "OPENROUTER_API_KEY" },
				],
				terms: {
					runs: "allowed",
					source: {
						url: "https://opencode.ai/docs/cli/",
						clause:
							"It is designed for scripts, CI jobs, and other workflows that need model output directly in the terminal.",
						readOn: "2026-11-26",
					},
					gaps: ["the terms of the provider that key belongs to"],
				},
			},
		],
	},
	facts: {
		// Retention depends on the provider and model behind it, so nothing is known (#1024).
		cacheTtlMinutes: null,
		// A 15% reserve below the window by default (compaction.ts, #1101).
		autoCompactPercent: 85,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		// Measured on the scripted-model matrix: about half the tool tokens per run, same pass rate (#848).
		harnessToolSearch: true,
		acpRegistryIds: ["opencode", "opencode-v2"],
		usageReports: [],
		settingsFile: "~/.config/opencode/opencode.json",
		// opencode.ai/docs/{rules,skills,plugins,config}; Claude's files only where no AGENTS.md (#1180).
		configLayout: {
			instructions: [
				{
					path: "{$XDG_CONFIG_HOME|~/.config}/opencode/AGENTS.md",
					scope: "global",
				},
				{
					path: "~/.claude/CLAUDE.md",
					scope: "global",
					via: "claude-code",
					onlyIfMissing: "{$XDG_CONFIG_HOME|~/.config}/opencode/AGENTS.md",
				},
				{ path: "<ancestors>/AGENTS.md", scope: "repo" },
				{
					path: "<ancestors>/CLAUDE.md",
					scope: "repo",
					via: "claude-code",
					onlyIfMissing: "<ancestors>/AGENTS.md",
				},
			],
			skills: [
				{
					path: "{$XDG_CONFIG_HOME|~/.config}/opencode/skills",
					scope: "global",
				},
				{ path: "~/.claude/skills", scope: "global", via: "claude-code" },
				{ path: "~/.agents/skills", scope: "global" },
				{ path: "<ancestors>/.opencode/skills", scope: "repo" },
				{
					path: "<ancestors>/.claude/skills",
					scope: "repo",
					via: "claude-code",
				},
				{ path: "<ancestors>/.agents/skills", scope: "repo" },
			],
			mcp: [
				...["opencode.json", "opencode.jsonc", "config.json"].map(
					(f) =>
						({
							path: `{$XDG_CONFIG_HOME|~/.config}/opencode/${f}`,
							scope: "global",
							format: "jsonc",
							key: "mcp",
						}) as const,
				),
				...["opencode.json", "opencode.jsonc"].map(
					(f) =>
						({
							path: `<repo>/${f}`,
							scope: "repo",
							format: "jsonc",
							key: "mcp",
						}) as const,
				),
			],
			hooks: [],
			plugins: [
				{
					path: "{$XDG_CONFIG_HOME|~/.config}/opencode/opencode.json",
					scope: "global",
					format: "jsonc",
					key: "plugin",
				},
				{
					path: "<repo>/opencode.json",
					scope: "repo",
					format: "jsonc",
					key: "plugin",
				},
			],
		},
		noLevelReason: "OpenCode has per-tool rules, not one permission level.",
		ownSettingsNote: () =>
			"Your opencode.json rules stay; PrismaLens sets each tool's catch-all for the level.",
		// opencode.ai/docs/permissions: object rules merge, so the user's own patterns stay (#673 w21).
		permissionRulesNote:
			"A run sets each tool's default rule to match its permission level. Your other rules in opencode.json stay as they are.",
		// npm only: the curl installer ships releases npm and the pin have not reached (#1013).
		channel: channelOf(pin),
		...testedOf(pin),
		install: "npm i -g opencode-ai",
		// OpenCode 2's docs install it as `npm install -g @opencode/cli`.
		nextChannel: { npm: "@opencode/cli" },
		// @opencode/cli 2.3.2 answers `additionalDirectories`; opencode-ai 1.19.x does not.
		nextFacts: { directories: true },
		lines: {
			supervised: () =>
				"OpenCode runs its build agent; each tool's catch-all asks.",
			"auto-edits": () =>
				"OpenCode runs its build agent; edits are allowed and other tools ask.",
			auto: () =>
				"OpenCode has no reviewer of its own; its build agent keeps the Ask always rules.",
			"full-access": () =>
				"OpenCode runs its build agent with each tool's catch-all allowed; your own deny rules stay.",
		},
		loginHint: "`opencode auth login`, or a provider key in env",
		signInArgs: ["auth", "login"],
		signOutArgs: ["auth", "logout"],
		updateArgs: ["upgrade"],
		providerAuth: { args: ["auth", "list"], keyless: ["opencode"] },
		loginEnvKeys: ["XDG_DATA_HOME", "OPENCODE_DB"],
	},
});
