// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	channelOf,
	codingPlan,
	defineAgent,
	installCommand,
	noModeLines,
	testedOf,
} from "../family.ts";
import pin from "./pin.json" with { type: "json" };

export const deepagents = defineAgent({
	id: "agent.deepagents",
	family: "agent",
	name: "deepagents",
	mark: { brand: "deepagents" },
	order: 50,
	launch: "deepagents",
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "deepagents" },
		{ column: "Schedule.harness", value: "deepagents" },
	],
	auth: {
		methods: [
			codingPlan(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]),
			{
				id: "api-key",
				label: "ANTHROPIC_API_KEY or OPENAI_API_KEY",
				steps: ["credentials"],
				env: [{ name: "ANTHROPIC_API_KEY" }, { name: "OPENAI_API_KEY" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://www.anthropic.com/legal/consumer-terms",
						clause:
							"Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.",
						readOn: "2026-11-26",
					},
					gaps: [
						"OpenAI's terms for an OPENAI_API_KEY, read for Codex and not for this agent",
					],
				},
			},
		],
	},
	facts: {
		// No source states a cache lifetime or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		// Measured on the scripted-model matrix: about half the tool tokens per run, same pass rate (#848).
		harnessToolSearch: true,
		acpRegistryIds: ["deepagents"],
		// Its own published tile: langchain-ai/deepagents .github/images (assets/brands.ts).
		picksOwnModel: true,
		channel: channelOf(pin),
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		...testedOf(pin),
		install: installCommand(channelOf(pin)),
		lines: noModeLines("deepagents"),
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
	},
});
