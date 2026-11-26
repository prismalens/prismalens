// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	channelOf,
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
				unattended: true,
			},
			{
				id: "api-key",
				label: "OPENAI_API_KEY",
				steps: ["credentials"],
				unattended: true,
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
