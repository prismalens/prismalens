// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { probed } from "../row.js";

// Google's unmodified ACP server (registry id `antigravity-acp`) on the user's own Google sign-in or key (#1235).
export const antigravity = {
	id: "antigravity",
	label: "Antigravity",
	binary: "agy_acp_server",
	acpArgs: () => [],
	acpEnv: () => ({}),
	providerKeys: ["GEMINI_API_KEY"],
	// 1.5.2 answers session/new "Authentication required" until a client picks a method. It keeps
	// the Google sign-in itself; signed out, `oauth-personal` opens Google's own sign-in page.
	authenticate: [
		{ methodId: "gemini-api-key", env: "GEMINI_API_KEY" },
		{ methodId: "oauth-personal" },
	],
	// 1.5.2 session/new modes; it has no reviewer, so Auto runs `default`, as Gemini CLI does.
	levels: {
		supervised: { mode: "default", mechanism: "acp-mode" },
		"auto-edits": { mode: "auto_edit", mechanism: "acp-mode" },
		auto: { mode: "default", mechanism: "acp-mode" },
		"full-access": { mode: "yolo", mechanism: "acp-mode" },
	},
	modeNames: { default: "Default", auto_edit: "Auto Edit", yolo: "YOLO" },
	modeMechanism: "acp",
	modelVia: "acp",
	configDir: { envKey: "GEMINI_HOME", shownDefault: "~/.gemini" },
	facts: probed({
		loadSession: true,
		images: true,
		embeddedContext: true,
		directories: true,
	}),
} satisfies AgentDescriptor;
