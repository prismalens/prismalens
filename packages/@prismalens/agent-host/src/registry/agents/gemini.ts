// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { probed } from "../row.js";

export const gemini = {
	id: "gemini",
	label: "Gemini CLI",
	binary: "gemini",
	acpArgs: () => ["--acp"],
	// Trust is the user's own folderTrust setting; this row forces neither way (#817).
	acpEnv: () => ({}),
	providerKeys: ["GEMINI_API_KEY"],
	// gemini-cli buildAvailableModes (packages/cli/src/acp/acpUtils.ts); no reviewer, so Auto runs `default` (#907).
	levels: {
		supervised: { mode: "default", mechanism: "acp-mode" },
		"auto-edits": { mode: "autoEdit", mechanism: "acp-mode" },
		auto: { mode: "default", mechanism: "acp-mode" },
		"full-access": { mode: "yolo", mechanism: "acp-mode" },
	},
	modeNames: { default: "Default", autoEdit: "Auto Edit", yolo: "YOLO" },
	modeMechanism: "acp",
	modelVia: "unsupported",
	configDir: {
		envKey: "GEMINI_CLI_HOME",
		shownDefault: "your home folder (holds .gemini)",
	},
	facts: {
		...probed({
			loadSession: true,
			images: true,
			embeddedContext: true,
			directories: false,
		}),
		regroupsLinks: {
			value: true,
			via: "source",
			verifiedAt: { cli: "0.65.0", adapter: null },
			where:
				"packages/cli/src/acp/acpSession.ts #resolvePrompt atPathCommandParts",
		},
		subagentsOnStop: {
			value: {
				stop: true,
				finish: false,
				note: "Its sub-agents always stop with the turn.",
			},
			via: "source",
			verifiedAt: { cli: "0.65.0", adapter: null },
			where:
				"packages/cli/src/acp/acpSession.ts pendingSend.signal into runTool",
		},
	},
} satisfies AgentDescriptor;
