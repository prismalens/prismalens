// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens's own MCP gateway as an agent sees it (#848): one streamable-HTTP
 * entry in ACP `mcpServers`, or a run file for an agent that ignores that field.
 * Only HTTP is offered, since every agent that honours the field takes it.
 */
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk";

/** Where the run's gateway answers, the bearer valid for this run only, and what it offers. */
export interface GatewayEntry {
	url: string;
	token: string;
	/** The prompt's tools paragraph, built at lease without probes. */
	promptLine: string;
	/** PrismaLens's own tool names; proxied `<server>__<tool>` names are never here. */
	tools: readonly string[];
	/** True once a request carrying the run's token reached the gateway. */
	confirmed(): boolean;
	waitConfirmed(ms: number): Promise<boolean>;
}

/** Agents name a tool `mcp__<server>__<tool>`; the run's events show this name. */
export const GATEWAY_SERVER_NAME = "prismalens";

export const GATEWAY_NOT_LOADED =
	"The agent did not load PrismaLens tools; a server named `prismalens` in your agent config can hide them.";

export function gatewayServer(entry: GatewayEntry): McpServer {
	return {
		type: "http",
		name: GATEWAY_SERVER_NAME,
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
	taken: () => boolean;
} {
	return {
		pick: (capabilities) =>
			delivery !== "mcp-config-file" && capabilities?.http === true
				? [gatewayServer(entry)]
				: [],
		taken: () => entry.confirmed(),
	};
}
