// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { noMode, probed } from "../row.js";

// Cursor's CLI on the user's own login or key; `acp` is a hidden command with no stability promise (#1235).
export const cursor = {
	id: "cursor",
	label: "Cursor",
	binary: "cursor-agent",
	acpArgs: () => ["acp"],
	// Signed out, cursor_login fails at once with its login URL instead of opening a browser
	// from a background child; the user signs in with `cursor-agent login` in a terminal.
	acpEnv: () => ({ NO_OPEN_BROWSER: "1" }),
	// cursor.com/docs/cli/reference/authentication: the CLI reads either from env itself.
	providerKeys: ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"],
	// session/new answers "Authentication required" until a client sends cursor_login (2026.11.22).
	authenticate: [{ methodId: "cursor_login" }],
	// Its agent/plan/ask modes are not permission levels; it asks through session/request_permission (cursor.com/docs/cli/acp).
	levels: noMode(),
	modeNames: { agent: "Agent", plan: "Plan", ask: "Ask" },
	modeMechanism: "none",
	modelVia: "acp",
	facts: probed({
		loadSession: true,
		images: false,
		embeddedContext: false,
		directories: false,
	}),
} satisfies AgentDescriptor;
