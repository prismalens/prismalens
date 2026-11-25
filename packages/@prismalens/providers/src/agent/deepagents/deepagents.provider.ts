// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	channelOf,
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
			{
				id: "api-key",
				label: "ANTHROPIC_API_KEY or OPENAI_API_KEY",
				steps: ["credentials"],
				unattended: true,
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
