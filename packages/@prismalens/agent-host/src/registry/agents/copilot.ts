// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { noMode, probed } from "../row.js";

// GitHub Copilot CLI on the user's own login (#1236). It reads GH_TOKEN and GITHUB_TOKEN too and
// lets them override that login, so only its own key passes: a host's git token never signs it in.
export const copilot = {
	id: "copilot",
	label: "GitHub Copilot",
	binary: "copilot",
	acpArgs: () => ["--acp"],
	acpEnv: () => ({}),
	providerKeys: ["COPILOT_GITHUB_TOKEN"],
	// 1.0.114's Agent, Plan and Autopilot modes are not permission levels; it asks through session/request_permission.
	levels: noMode(),
	modeNames: {
		"https://agentclientprotocol.com/protocol/session-modes#agent": "Agent",
		"https://agentclientprotocol.com/protocol/session-modes#plan": "Plan",
		"https://agentclientprotocol.com/protocol/session-modes#autopilot":
			"Autopilot",
	},
	modeMechanism: "none",
	// 1.0.114 session/new offers no `model` option; COPILOT_MODEL in the user's env still applies.
	modelVia: "unsupported",
	configDir: { envKey: "COPILOT_HOME", shownDefault: "~/.copilot" },
	facts: probed({
		loadSession: true,
		images: true,
		embeddedContext: true,
		directories: false,
	}),
} satisfies AgentDescriptor;
