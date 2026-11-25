// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { noMode } from "../row.js";

// One user-set ACP command (#907): no modes, so the host's ask policy decides each ask.
export const local = {
	id: "local",
	label: "Local agent",
	binary: "",
	acpArgs: () => [],
	acpEnv: () => ({}),
	providerKeys: [],
	levels: noMode(),
	modeNames: {},
	modeMechanism: "none",
	modelVia: "acp",
} satisfies AgentDescriptor;
