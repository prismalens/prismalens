// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens's own MCP gateway as an agent sees it (#848): one streamable-HTTP
 * entry in ACP `mcpServers`, or a run file for an agent that ignores that field.
 * Only HTTP is offered, since every agent that honours the field takes it.
 */
import { randomBytes } from "node:crypto";
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk";

/** Where the run's gateway answers, the bearer valid for this run only, and what it offers. */
export interface GatewayEntry {
	url: string;
	token: string;
	/** The run's random server name; agents name its tools `mcp__<serverName>__<tool>`. */
	serverName: string;
	/** The prompt's tools paragraph, built at lease without probes. */
	promptLine: string;
	/** PrismaLens's own harness tool names, the only ones the gateway serves. */
	tools: readonly string[];
	/** True once a request carrying the run's token reached the gateway. */
	confirmed(): boolean;
	waitConfirmed(ms: number): Promise<boolean>;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Random per run and kept on it, so a server of the user's own never shares the name (#848). */
export function newGatewayServerName(): string {
	return `prismalens-${[...randomBytes(10)].map((b) => BASE32[b & 31]).join("")}`;
}

export function gatewayServer(entry: GatewayEntry): McpServer {
	return {
		type: "http",
		name: entry.serverName,
		url: entry.url,
		headers: [{ name: "Authorization", value: `Bearer ${entry.token}` }],
	};
}

/**
 * Picks `mcpServers` from `initialize`'s capabilities. "Taken" means confirmed: only an
 * authenticated request proves the agent loaded our server (OBJ-011).
 */
export function gatewayOffer(
	entry: GatewayEntry,
	delivery?: "mcp-config-file",
): {
	pick: (capabilities: McpCapabilities | undefined) => McpServer[];
	/** The agent was handed the server, so waiting for its first request can pay off. */
	offered: () => boolean;
	taken: () => boolean;
} {
	let offered = delivery === "mcp-config-file";
	return {
		pick: (capabilities) => {
			if (delivery === "mcp-config-file" || capabilities?.http !== true)
				return [];
			offered = true;
			return [gatewayServer(entry)];
		},
		offered: () => offered,
		taken: () => entry.confirmed(),
	};
}
