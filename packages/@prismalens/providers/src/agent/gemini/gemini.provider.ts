// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { channelOf, defineAgent, modeNamed, testedOf } from "../family.ts";
import pin from "./pin.json" with { type: "json" };

export const gemini = defineAgent({
	id: "agent.gemini",
	family: "agent",
	name: "Gemini CLI",
	// Its own published mark in its owner's colours: lobehub/lobe-icons (assets/brands.ts).
	mark: { brand: "gemini" },
	order: 40,
	launch: "gemini",
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "gemini" },
		{ column: "Schedule.harness", value: "gemini" },
	],
	auth: {
		methods: [
			{
				id: "login",
				label: "Google account",
				steps: ["terminal", "browser"],
				unattended: true,
			},
			{
				id: "api-key",
				label: "GEMINI_API_KEY",
				steps: ["credentials"],
				unattended: true,
			},
		],
	},
	facts: {
		// Gemini's implicit caching states no TTL (#1024).
		cacheTtlMinutes: null,
		// `model.compressionThreshold` defaults to 0.5 (chatCompressionService.ts, #1101).
		autoCompactPercent: 50,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		// Measured on the scripted-model matrix: about half the tool tokens per run, same pass rate (#848).
		harnessToolSearch: true,
		acpRegistryIds: ["gemini"],
		vendor: "google",
		usageReports: [],
		settingsFile: "~/.gemini/settings.json",
		// gemini-cli docs/reference/configuration.md, cli/trusted-folders.md (#1180).
		configLayout: {
			instructions: [
				{ path: "{$GEMINI_CLI_HOME|~}/.gemini/GEMINI.md", scope: "global" },
				{ path: "<ancestors>/GEMINI.md", scope: "repo" },
			],
			skills: [
				{ path: "{$GEMINI_CLI_HOME|~}/.gemini/skills", scope: "global" },
				{ path: "~/.agents/skills", scope: "global" },
				{ path: "<repo>/.gemini/skills", scope: "repo" },
			],
			mcp: [
				{
					path: "{$GEMINI_CLI_HOME|~}/.gemini/settings.json",
					scope: "global",
					format: "json",
					key: "mcpServers",
				},
				{
					path: "<repo>/.gemini/settings.json",
					scope: "repo",
					format: "json",
					key: "mcpServers",
				},
			],
			hooks: [
				{
					path: "{$GEMINI_CLI_HOME|~}/.gemini/settings.json",
					scope: "global",
					format: "json",
					key: "hooks",
				},
				{
					path: "<repo>/.gemini/settings.json",
					scope: "repo",
					format: "json",
					key: "hooks",
				},
			],
			plugins: [
				{
					path: "{$GEMINI_CLI_HOME|~}/.gemini/extensions",
					scope: "global",
					format: "dir",
				},
			],
			trust: {
				path: "{$GEMINI_CLI_HOME|~}/.gemini/trustedFolders.json",
				gate: "agent",
			},
		},
		ownSettingsNote: () =>
			"Gemini CLI's own folder trust and settings apply, as in your terminal.",
		channel: channelOf(pin),
		...testedOf(pin),
		install: "npm i -g @google/gemini-cli",
		lines: {
			supervised: (c) =>
				`Gemini CLI runs in ${modeNamed(c, "default", "Default")}.`,
			"auto-edits": (c) =>
				`Gemini CLI runs in ${modeNamed(c, "autoEdit", "Auto Edit")}.`,
			auto: (c) =>
				`Gemini CLI has no reviewer of its own; it runs in ${modeNamed(c, "default", "Default")}, as Ask always does.`,
			"full-access": (c) =>
				`Gemini CLI runs in ${modeNamed(c, "yolo", "YOLO")}.`,
		},
		loginHint: "`gemini` sign-in, or `GEMINI_API_KEY` in env",
		signInArgs: [],
		// No Sign out: with stale credentials Gemini opens its sign-in dialog before an `-i` prompt runs (#1180).
		switchAccountArgs: ["-i", "/auth signin"],
		brew: { formula: "gemini-cli" },
		updateLine:
			"Download the latest release from github.com/google-gemini/gemini-cli/releases",
		loginEnvKeys: ["GEMINI_CLI_HOME"],
		// No trust command is quoted: Gemini's own one is unconfirmed (#848 §11 Q4).
		toolsHint: {
			text: "If you use Gemini's folder trust, trust the runs folder to give it PrismaLens's tools",
		},
	},
});
