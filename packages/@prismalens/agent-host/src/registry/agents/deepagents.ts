// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AgentDescriptor } from "../agents.js";
import { GATEWAY_RUN_FILE, inConfigDir, noMode, probed } from "../row.js";

export const deepagents = {
	id: "deepagents",
	label: "deepagents",
	// deepagents-code's `dcode --acp` is the ACP server (#634). It ignores ACP mcpServers:
	// the gateway goes in by --mcp-config, beside the user's own servers (#848).
	binary: "dcode",
	gatewayDelivery: "mcp-config-file",
	// Shared servers go in the same file; dcode expands their ${PL_SV_...} references (#1180 §3.3).
	acpArgs: (env) =>
		env.gateway || env.runFileServers
			? ["--acp", "--mcp-config", inConfigDir(env, GATEWAY_RUN_FILE)]
			: ["--acp"],
	acpEnv: () => ({}),
	configFiles: (env): Record<string, string> =>
		env.gateway || env.runFileServers
			? {
					[GATEWAY_RUN_FILE]: JSON.stringify({
						mcpServers: {
							...env.runFileServers,
							...(env.gateway
								? {
										[env.gateway.name]: {
											type: "http",
											url: env.gateway.url,
											headers: {
												Authorization: `Bearer ${env.gateway.token}`,
											},
										},
									}
								: {}),
						},
					}),
				}
			: {},
	providerKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
	// No modes over ACP (deepagents #4254): the host answers each ask by the level.
	levels: noMode(),
	modeNames: {},
	modeMechanism: "none",
	modelVia: "unsupported",
	facts: {
		...probed({
			loadSession: true,
			images: true,
			embeddedContext: false,
			directories: false,
		}),
		rewindVia: {
			value: "replay",
			via: "source",
			verifiedAt: { cli: "0.2.1", adapter: null },
			where: "libs/acp/deepagents_acp/server.py initialize: load_session only",
		},
	},
} satisfies AgentDescriptor;
