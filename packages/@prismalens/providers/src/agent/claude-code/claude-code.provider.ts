// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	channelOf,
	codingPlan,
	defineAgent,
	modeNamed,
	offers,
	testedOf,
} from "../family.ts";
import pin from "./pin.json" with { type: "json" };

export const claudeCode = defineAgent({
	id: "agent.claude-code",
	family: "agent",
	name: "Claude Code",
	mark: { brand: "claude-code" },
	order: 20,
	launch: "claude-code",
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "claude-code" },
		{ column: "Schedule.harness", value: "claude-code" },
	],
	auth: {
		methods: [
			{
				id: "login",
				label: "Claude account",
				steps: ["terminal", "browser"],
				terms: {
					runs: "allowed",
					source: {
						url: "https://code.claude.com/docs/en/legal-and-compliance",
						clause:
							"Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.",
						readOn: "2026-11-26",
					},
					against: {
						url: "https://code.claude.com/docs/en/agent-sdk/overview",
						clause:
							"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.",
						readOn: "2026-11-26",
					},
				},
			},
			codingPlan(
				["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"],
				"ANTHROPIC_BASE_URL",
			),
			{
				id: "api-key",
				label: "ANTHROPIC_API_KEY",
				steps: ["credentials"],
				env: [{ name: "ANTHROPIC_API_KEY" }, { name: "ANTHROPIC_AUTH_TOKEN" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://www.anthropic.com/legal/consumer-terms",
						clause:
							"Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.",
						readOn: "2026-11-26",
					},
				},
			},
		],
	},
	facts: {
		// claude-agent-acp 0.99.1 handles `/compact` but has no idle self-compaction, and states no cache
		// lifetime; a later adapter compacts idle sessions before its one-hour cache expires (#1024).
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: "compact",
		// Claude Code documents `/compact [instructions]`; claude-agent-acp 0.100.0 passes the prompt text through.
		compactTakesFocus: true,
		// No harnessToolSearch: the agent defers MCP tools itself on its own API, which the scripted model cannot measure (#848).
		acpRegistryIds: ["claude-acp"],
		vendor: "anthropic",
		usageReports: ["cache", "cost", "limits"],
		modelWindow: { alias: "[1m]", base: "200k", large: "1M" },
		settingsFile: "~/.claude/settings.json",
		ownSettingsNote: () =>
			"Your ~/.claude/settings.json allow and deny rules, hooks and sandbox apply, as in your terminal. The terminal's own default may be Auto on Claude Code 2.1.228 and later; PrismaLens reads the key, not that default.",
		channel: channelOf(pin),
		...testedOf(pin),
		install:
			"curl -fsSL https://claude.ai/install.sh | bash  (or: npm i -g @anthropic-ai/claude-code; then `claude /login`, or set ANTHROPIC_API_KEY)",
		// claude-agent-acp 0.81.1 reports `acceptEdits` when the model has no `auto`, and
		// leaves `bypassPermissions` unoffered when the user's settings turn it off (#673 w21).
		lines: {
			supervised: (c) =>
				`Claude Code runs in ${modeNamed(c, "default", "Manual")}.`,
			"auto-edits": (c) =>
				`Claude Code runs in ${modeNamed(c, "acceptEdits", "Accept Edits")}.`,
			auto: (c) =>
				`Claude Code runs in ${modeNamed(c, "auto", "Auto")}; with a model that has no Auto it runs ${modeNamed(c, "acceptEdits", "Accept Edits")}.`,
			"full-access": (c) => {
				const bypass = modeNamed(c, "bypassPermissions", "Bypass Permissions");
				const edits = modeNamed(c, "acceptEdits", "Accept Edits");
				return c?.modes && !offers(c, "bypassPermissions")
					? `Claude Code runs in ${edits}: your settings turn ${bypass} off.`
					: `Claude Code runs in ${bypass}, or ${edits} where your settings turn it off.`;
			},
		},
		loginHint: "`claude auth login`, or `ANTHROPIC_API_KEY` in env",
		signInArgs: ["auth", "login"],
		signOutArgs: ["auth", "logout"],
		switchAccountArgs: ["auth", "login"],
		updateArgs: ["update"],
		loginEnvKeys: ["CLAUDE_CONFIG_DIR"],
		reportsLimits: true,
		limitsBeforeRun: "claude-sdk",
		routingEnvKeys: [
			"ANTHROPIC_BASE_URL",
			"CLAUDE_CODE_USE_BEDROCK",
			"CLAUDE_CODE_USE_VERTEX",
			"CLAUDE_CODE_USE_FOUNDRY",
		],
	},
});
