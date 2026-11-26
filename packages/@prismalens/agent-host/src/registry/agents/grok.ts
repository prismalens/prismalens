// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { noMode, probed } from "../row.js";

// Grok Build on the user's own Grok sign-in or XAI_API_KEY (#1236).
export const grok = {
	id: "grok",
	label: "Grok Build",
	binary: "grok",
	acpArgs: () => ["agent", "stdio"],
	acpEnv: () => ({}),
	providerKeys: ["XAI_API_KEY"],
	// 1.0.93 refuses session/new until authenticate, lists only grok.com (its browser sign-in,
	// which reuses a saved login), and still takes xai.api_key when XAI_API_KEY is set.
	authenticate: [
		{ methodId: "xai.api_key", env: "XAI_API_KEY", unlisted: true },
		{ methodId: "grok.com" },
	],
	// 1.0.93 offers no modes over ACP, only model and reasoning_effort options; it asks per tool.
	levels: noMode(),
	modeNames: {},
	modeMechanism: "none",
	modelVia: "acp",
	configDir: { envKey: "GROK_HOME", shownDefault: "~/.grok" },
	facts: probed({
		loadSession: true,
		images: true,
		embeddedContext: true,
		directories: false,
	}),
} satisfies AgentDescriptor;
