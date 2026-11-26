// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { probed } from "../row.js";

// Qwen Code on the user's own OpenAI-compatible key (#1236). 0.28.3 lists one sign-in, `openai`, and
// with no settings of its own refuses it unless OPENAI_MODEL and OPENAI_BASE_URL are set beside the key.
export const qwen = {
	id: "qwen",
	label: "Qwen Code",
	binary: "qwen",
	acpArgs: () => ["--acp"],
	acpEnv: () => ({}),
	providerKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"],
	authenticate: [{ methodId: "openai", env: "OPENAI_API_KEY" }],
	envModelKey: "OPENAI_MODEL",
	// 0.28.3 session/new modes; it starts in `auto`, its own classifier, so every level sets one.
	levels: {
		supervised: { mode: "default", mechanism: "acp-mode" },
		"auto-edits": { mode: "auto-edit", mechanism: "acp-mode" },
		auto: { mode: "auto", mechanism: "acp-mode" },
		"full-access": { mode: "yolo", mechanism: "acp-mode" },
	},
	modeNames: {
		plan: "Plan",
		default: "Default",
		"auto-edit": "Auto Edit",
		auto: "Auto",
		yolo: "YOLO",
	},
	modeMechanism: "acp",
	modelVia: "acp",
	configDir: { envKey: "QWEN_HOME", shownDefault: "~/.qwen" },
	facts: probed({
		loadSession: true,
		images: true,
		embeddedContext: true,
		directories: false,
	}),
} satisfies AgentDescriptor;
