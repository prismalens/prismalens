// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { noMode, probed } from "../row.js";

// Kiro CLI on the user's own login or KIRO_API_KEY (#1236). Signed out, 3.0.0 refuses session/new
// with "Authentication required"; its modes are unread here, so the host answers its asks by level.
export const kiro = {
	id: "kiro",
	label: "Kiro",
	binary: "kiro-cli",
	acpArgs: () => ["acp"],
	acpEnv: () => ({}),
	providerKeys: ["KIRO_API_KEY"],
	levels: noMode(),
	modeNames: {},
	modeMechanism: "none",
	modelVia: "unsupported",
	configDir: { envKey: "KIRO_HOME", shownDefault: "~/.kiro" },
	facts: probed({
		loadSession: false,
		images: false,
		embeddedContext: false,
		directories: false,
	}),
} satisfies AgentDescriptor;
