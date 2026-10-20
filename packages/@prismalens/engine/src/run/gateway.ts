// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens's own MCP gateway as an agent sees it (#848): one streamable-HTTP
 * entry in ACP `mcpServers`, with the run's bearer. Only HTTP is offered, since
 * every agent that honours the field takes it and opencode refuses SSE.
 */
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk";

/** Where the run's gateway answers and the bearer valid for this run only. */
export interface GatewayEntry {
	url: string;
	token: string;
}

/** Agents name a tool `mcp__<server>__<tool>`; the run's events show this name. */
export const GATEWAY_SERVER_NAME = "prismalens";

export const GATEWAY_PROMPT_LINE =
	"PrismaLens tools (MCP server `prismalens`, read-only): `sources_list` says which data sources this run can reach; `investigations_search` finds past investigations and the causes operators recorded; `prometheus_query`, `prometheus_query_range`, `prometheus_alerts`, `alertmanager_alerts` and `loki_query_range` read connected sources with the credentials PrismaLens holds.";

export function gatewayServer(entry: GatewayEntry): McpServer {
	return {
		type: "http",
		name: GATEWAY_SERVER_NAME,
		url: entry.url,
		headers: [{ name: "Authorization", value: `Bearer ${entry.token}` }],
	};
}

/** Picks `mcpServers` from `initialize`'s capabilities and remembers whether the agent took the gateway. */
export function gatewayOffer(entry: GatewayEntry): {
	pick: (capabilities: McpCapabilities | undefined) => McpServer[];
	taken: () => boolean;
} {
	let taken = false;
	return {
		pick: (capabilities) => {
			taken = capabilities?.http === true;
			return taken ? [gatewayServer(entry)] : [];
		},
		taken: () => taken,
	};
}
