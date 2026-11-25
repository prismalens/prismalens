// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent } from "../family.ts";

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
				unattended: true,
			},
			{
				id: "provider-key",
				label: "A provider key in env",
				steps: ["credentials"],
				unattended: true,
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
		noLevelReason: "OpenCode has per-tool rules, not one permission level.",
		ownSettingsNote: () =>
			"Your opencode.json rules stay; PrismaLens sets each tool's catch-all for the level.",
		// opencode.ai/docs/permissions: object rules merge, so the user's own patterns stay (#673 w21).
		permissionRulesNote:
			"A run sets each tool's default rule to match its permission level. Your other rules in opencode.json stay as they are.",
		// npm only: the curl installer ships releases npm and the pin have not reached (#1013).
		install: "npm i -g opencode-ai",
		channel: { npm: "opencode-ai" },
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
		// The pin-bump PR moved this on 2026-11-21: zero-token probe and aimock CI, no real-model run yet (#914).
		tested: { version: "1.19.6", date: "2026-11-21" },
		loginHint: "`opencode auth login`, or a provider key in env",
		signInArgs: ["auth", "login"],
		providerAuth: { args: ["auth", "list"], keyless: ["opencode"] },
		loginEnvKeys: ["XDG_DATA_HOME", "OPENCODE_DB"],
	},
});
