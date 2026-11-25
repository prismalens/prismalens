// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { probed } from "../row.js";

// goose on the user's own provider: `goose configure`, or GOOSE_PROVIDER and that provider's key (#1236).
export const goose = {
	id: "goose",
	label: "goose",
	binary: "goose",
	acpArgs: () => ["acp"],
	acpEnv: () => ({}),
	providerKeys: [
		"GOOSE_PROVIDER",
		"GOOSE_MODEL",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GOOGLE_API_KEY",
		"OPENROUTER_API_KEY",
	],
	envModelKey: "GOOSE_MODEL",
	// 1.60.2 with no provider set refuses session/new as an internal error naming GOOSE_PROVIDER.
	signedOutText: /Configuration value not found: GOOSE_PROVIDER/,
	// 1.60.2 starts in `auto` (approves every call). It has no edits-only mode, so Auto edits asks
	// for every call; smart_approve is its own judge of which calls are sensitive.
	levels: {
		supervised: { mode: "approve", mechanism: "acp-mode" },
		"auto-edits": { mode: "approve", mechanism: "acp-mode" },
		auto: { mode: "smart_approve", mechanism: "acp-mode" },
		"full-access": { mode: "auto", mechanism: "acp-mode" },
	},
	modeNames: {
		auto: "auto",
		approve: "approve",
		smart_approve: "smart_approve",
	},
	modeMechanism: "acp",
	modelVia: "acp",
	configDir: {
		envKey: "GOOSE_PATH_ROOT",
		shownDefault: "goose's own config folder",
	},
	facts: probed({
		loadSession: true,
		images: true,
		embeddedContext: true,
		directories: false,
	}),
} satisfies AgentDescriptor;
