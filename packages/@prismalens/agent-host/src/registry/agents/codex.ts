// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { PROBED_AT, probed } from "../row.js";

export const codex = {
	id: "codex",
	label: "Codex",
	binary: "codex-acp",
	companionBinary: "codex",
	adapterPackage: "@agentclientprotocol/codex-acp",
	acpArgs: () => [],
	acpEnv: ({ companionPath, shipped }) => ({
		// codex-acp reads an env key only once the client picks its api-key method (#634).
		DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
		// The shipped adapter has no codex of its own; a PATH install keeps its bundled one (#818).
		...(shipped && companionPath ? { CODEX_PATH: companionPath } : {}),
	}),
	// codex-acp README: CODEX_API_KEY wins over OPENAI_API_KEY for the api-key method.
	providerKeys: ["CODEX_API_KEY", "OPENAI_API_KEY"],
	// codex-acp 2.2.2 src/AgentMode.ts, set through its `mode` config option. Before 2.0 there was
	// no workspace-write (codex-acp#480); the fallback keeps an older PATH install working.
	levels: {
		supervised: { mode: "read-only", mechanism: "acp-config" },
		"auto-edits": {
			mode: "workspace-write",
			fallbackMode: "read-only",
			mechanism: "acp-config",
		},
		auto: { mode: "agent", mechanism: "acp-config" },
		"full-access": { mode: "agent-full-access", mechanism: "acp-config" },
	},
	modeNames: {
		"read-only": "Read-only",
		"workspace-write": "Workspace access",
		agent: "Auto review",
		"agent-full-access": "Full access",
	},
	modeMechanism: "acp",
	sandboxedModes: ["read-only", "workspace-write", "agent"],
	modelVia: "acp",
	configDir: { envKey: "CODEX_HOME", shownDefault: "~/.codex" },
	// codex-acp takes Codex's `agents.max_depth` / `max_threads` through CODEX_CONFIG, not `-c` (README, Runtime options).
	subagentLimits: {
		depth: { jsonEnv: "CODEX_CONFIG", path: ["agents", "max_depth"] },
		concurrency: { jsonEnv: "CODEX_CONFIG", path: ["agents", "max_threads"] },
	},
	facts: {
		...probed(PROBED_AT.codex, {
			loadSession: true,
			images: true,
			embeddedContext: true,
			directories: true,
		}),
		subagentsOnStop: {
			value: {
				stop: false,
				finish: false,
				note: "Codex decides: a stop interrupts its main conversation and every sub-agent turn running under it.",
			},
			via: "source",
			verifiedAt: { cli: "0.171.0", adapter: "2.8.0" },
			where:
				"src/CodexAcpServer.ts cancel(), interruptSessionTurn, interruptStandardChildren",
		},
	},
} satisfies AgentDescriptor;
