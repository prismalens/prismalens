// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineAgent, type Lines } from "../family.ts";

// Its Agent, Plan and Autopilot modes are its own, not levels; PrismaLens answers its asks.
const line = () =>
	"GitHub Copilot's modes are not permission levels; PrismaLens answers its asks by this level.";
const lines: Lines = {
	supervised: line,
	"auto-edits": line,
	auto: line,
	"full-access": line,
};

export const copilot = defineAgent({
	id: "agent.copilot",
	family: "agent",
	name: "GitHub Copilot",
	mark: { letters: "CP" },
	order: 45,
	launch: "copilot",
	skips: [
		{
			case: "install",
			reason:
				"No pin yet: its npm pin lands with a qualification leg against the scripted model",
		},
	],
	entryPoints: [
		"settings.agents",
		"composer.agent-picker",
		"incidents.first-run",
	],
	stored: [
		{ column: "Run.harness", value: "copilot" },
		{ column: "Schedule.harness", value: "copilot" },
	],
	// docs.github.com copilot-cli authenticate-copilot-cli; PrismaLens never reads the login it stores.
	auth: {
		methods: [
			{
				id: "login",
				label: "GitHub account",
				steps: ["terminal", "browser"],
				terms: {
					runs: "allowed",
					source: {
						url: "https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically",
						clause:
							"This allows you to use Copilot directly from the terminal, but also allows you to use the CLI programmatically in scripts, CI/CD pipelines, and automation workflows.",
						readOn: "2026-11-26",
					},
					against: {
						url: "https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies",
						clause:
							"using our servers for any form of excessive automated bulk activity",
						readOn: "2026-11-26",
					},
					gaps: [
						"GitHub's Generative AI Services Terms, for Copilot Business and Enterprise",
					],
				},
			},
			{
				id: "api-key",
				label: "COPILOT_GITHUB_TOKEN",
				steps: ["credentials"],
				env: [{ name: "COPILOT_GITHUB_TOKEN" }],
				terms: {
					runs: "allowed",
					source: {
						url: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli",
						clause:
							"Recommended for CI/CD pipelines, containers, and non-interactive environments.",
						readOn: "2026-11-26",
					},
				},
			},
		],
	},
	facts: {
		// No Copilot source states a cache lifetime; it compacts at 0.8 of the window (`copilot help environment`).
		cacheTtlMinutes: null,
		autoCompactPercent: 80,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		acpRegistryIds: ["github-copilot-cli"],
		usageReports: [],
		install: "npm i -g @github/copilot (or winget install GitHub.Copilot)",
		lines,
		noLevelReason:
			"GitHub Copilot's Agent, Plan and Autopilot modes are not permission levels.",
		loginHint: "`copilot login`, or `COPILOT_GITHUB_TOKEN` in env",
		signInArgs: ["login"],
		loginEnvKeys: ["COPILOT_HOME"],
	},
});
