// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { opencodePermission } from "../opencode.js";
import { probed } from "../row.js";

export const opencode = {
	id: "opencode",
	label: "OpenCode",
	binary: "opencode",
	// No directory flag: OpenCode 2.x exits on one; the spawn and session/new name the folder (#1013).
	acpArgs: () => ["acp"],
	// The user's XDG_CONFIG_HOME and OPENCODE_CONFIG_DIR stay theirs; the run's config loads last, inline (#791, #817).
	acpEnv: () => ({}),
	configEnv: { file: "opencode.json", key: "OPENCODE_CONFIG_CONTENT" },
	configFiles: () => ({
		"opencode.json": JSON.stringify(
			{
				$schema: "https://opencode.ai/config.json",
				// Without it a refused tool ends the turn (#639 finding 1).
				experimental: { continue_loop_on_deny: true },
				share: "disabled",
			},
			null,
			2,
		),
	}),
	providerKeys: [
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GEMINI_API_KEY",
		"GOOGLE_GENERATIVE_AI_API_KEY",
		"GOOGLE_API_KEY",
		"OPENROUTER_API_KEY",
	],
	// OpenCode offers its agents as the ACP `mode` config option; a level is a catch-all overlay on its rules.
	levels: {
		supervised: {
			mode: "build",
			configPatch: opencodePermission("ask", "ask"),
			mechanism: "opencode-permission",
		},
		"auto-edits": {
			mode: "build",
			configPatch: opencodePermission("allow", "ask"),
			mechanism: "opencode-permission",
		},
		auto: {
			mode: "build",
			configPatch: opencodePermission("ask", "ask"),
			mechanism: "opencode-permission",
		},
		"full-access": {
			mode: "build",
			configPatch: opencodePermission("allow", "allow"),
			mechanism: "opencode-permission",
		},
	},
	modeNames: { build: "Build", plan: "Plan" },
	modeMechanism: "acp",
	modelVia: "acp",
	subagentLimits: {
		depth: {
			configFile: "opencode.json",
			path: ["experimental", "subagent_depth"],
		},
	},
	facts: {
		...probed({
			loadSession: true,
			images: true,
			embeddedContext: true,
			directories: false,
		}),
		subagentsOnStop: {
			value: {
				stop: false,
				finish: false,
				note: "OpenCode decides: a sub-agent the turn waits on stops with it, and one it sent to the background finishes.",
			},
			via: "source",
			verifiedAt: { cli: "1.19.6", adapter: null },
			where: "packages/opencode/src/tool/task.ts onAbort, background.start",
		},
	},
} satisfies AgentDescriptor;
