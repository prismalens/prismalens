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

export const codex = defineAgent({
	id: "agent.codex",
	family: "agent",
	name: "Codex",
	// Its own published mark in its owner's colours: lobehub/lobe-icons (assets/brands.ts).
	mark: { brand: "codex" },
	order: 30,
	launch: "codex",
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "codex" },
		{ column: "Schedule.harness", value: "codex" },
	],
	auth: {
		methods: [
			{
				id: "login",
				label: "ChatGPT account",
				steps: ["terminal", "browser"],
				terms: {
					runs: "allowed",
					source: {
						url: "https://learn.chatgpt.com/docs/auth",
						clause:
							"Access tokens are intended for trusted scripts, schedulers, and private CI runners.",
						readOn: "2026-11-26",
					},
				},
			},
			codingPlan(["OPENAI_API_KEY", "CODEX_API_KEY"]),
			{
				id: "api-key",
				label: "OPENAI_API_KEY",
				steps: ["credentials"],
				env: [{ name: "CODEX_API_KEY" }, { name: "OPENAI_API_KEY" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://learn.chatgpt.com/docs/auth",
						clause:
							"API keys are still the recommended default for automation.",
						readOn: "2026-11-26",
					},
				},
			},
		],
	},
	facts: {
		// codex-acp 2.5.0 advertises `compact`, taking no input; retention depends on the model and request (#1024).
		cacheTtlMinutes: null,
		// 90% of the window unless the model sets less (openai_models.rs, #1101).
		autoCompactPercent: 90,
		compactsWhenIdle: false,
		compactCommand: "compact",
		// codex-acp maps `compact` to Op::Compact, which takes no input.
		compactTakesFocus: false,
		// No harnessToolSearch: the agent defers MCP tools itself on its own API, which the scripted model cannot measure (#848).
		acpRegistryIds: ["codex-acp"],
		vendor: "openai",
		usageReports: ["cache"],
		limitsBeforeRun: "codex-app-server",
		settingsFile: "~/.codex/config.toml",
		// Codex docs agents-md, config-advanced, hooks, build-skills; project config only when trusted (#1180).
		// config/read, skills/list, hooks/list and plugin/installed in 0.171.0's app-server schema (#1180).
		loadoutReport: "codex-app-server",
		configLayout: {
			instructions: [
				{ path: "{$CODEX_HOME|~/.codex}/AGENTS.override.md", scope: "global" },
				{
					path: "{$CODEX_HOME|~/.codex}/AGENTS.md",
					scope: "global",
					onlyIfMissing: "{$CODEX_HOME|~/.codex}/AGENTS.override.md",
				},
				{ path: "<ancestors>/AGENTS.override.md", scope: "repo" },
				{
					path: "<ancestors>/AGENTS.md",
					scope: "repo",
					onlyIfMissing: "<ancestors>/AGENTS.override.md",
				},
			],
			skills: [
				{ path: "{$CODEX_HOME|~/.codex}/skills", scope: "global" },
				{ path: "~/.agents/skills", scope: "global" },
				{ path: "<ancestors>/.agents/skills", scope: "repo" },
			],
			mcp: [
				{
					path: "{$CODEX_HOME|~/.codex}/config.toml",
					scope: "global",
					format: "toml",
					key: "mcp_servers",
				},
				{
					path: "<repo>/.codex/config.toml",
					scope: "repo",
					format: "toml",
					key: "mcp_servers",
				},
			],
			hooks: [
				{
					path: "{$CODEX_HOME|~/.codex}/hooks.json",
					scope: "global",
					format: "json",
					key: "hooks",
				},
				{
					path: "<repo>/.codex/hooks.json",
					scope: "repo",
					format: "json",
					key: "hooks",
				},
			],
			plugins: [
				{
					path: "{$CODEX_HOME|~/.codex}/config.toml",
					scope: "global",
					format: "toml",
					key: "plugins",
				},
			],
			trust: { path: "{$CODEX_HOME|~/.codex}/config.toml", gate: "agent" },
		},
		ownSettingsNote: (c) =>
			c?.modes && !offers(c, "workspace-write")
				? "This codex-acp runs Ask always and Auto-accept edits in the same mode, Ask for approval; edits inside the copy need no ask."
				: null,
		channel: channelOf(pin),
		...testedOf(pin),
		install:
			"npm i -g @openai/codex  (then `codex login`, or set OPENAI_API_KEY)",
		lines: {
			supervised: (c) =>
				`Codex runs in ${modeNamed(c, "read-only", "Ask for approval")}.`,
			"auto-edits": (c) => {
				const ask = modeNamed(c, "read-only", "Ask for approval");
				if (offers(c, "workspace-write"))
					return `Codex runs in ${modeNamed(c, "workspace-write", "Workspace write")}.`;
				return c?.modes
					? `Codex runs in ${ask}, the same mode as Ask always on this version.`
					: `Codex runs in Workspace write, or ${ask} on a version without it.`;
			},
			auto: (c) =>
				`Codex runs in ${modeNamed(c, "agent", "Approve for me")}, its own reviewer.`,
			"full-access": (c) =>
				`Codex runs in ${modeNamed(c, "agent-full-access", "Full access")}, outside its sandbox.`,
		},
		// Real-model runs were on codex 0.163.0: scripts/acp-admission.ts 3 of 3, gpt-6-luna (#846), and #848 live runs. Must equal @prismalens/agent-adapters' pin.
		loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
		signInArgs: ["login"],
		signOutArgs: ["logout"],
		switchAccountArgs: ["login"],
		updateFallbackArgs: ["update"],
		brew: { cask: "codex" },
		updateLine:
			"Download the latest release from github.com/openai/codex/releases",
		loginEnvKeys: ["CODEX_HOME"],
	},
});
