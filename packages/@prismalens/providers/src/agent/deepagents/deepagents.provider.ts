// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, installCommand, noModeLines } from "../family.ts";

const DEEPAGENTS_CHANNEL = {
	uv: ["deepagents-code", "deepagents-acp"],
} as const;

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
		install: installCommand(DEEPAGENTS_CHANNEL),
		channel: DEEPAGENTS_CHANNEL,
		lines: noModeLines("deepagents"),
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		tested: { version: "0.1.75", date: "2026-09-23" },
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
	},
});
