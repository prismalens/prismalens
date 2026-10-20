// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The gateway's view of vendor MCP servers (#848): a run's tool snapshot, live
 * status, and forwarding. The api binds the real proxy; `noProxy` offers nothing.
 */

export type DroppedWhy =
	| "tool-count"
	| "schema-bytes"
	| "total-tools"
	| "total-bytes"
	| "received-bytes";

export interface ProxySnapshot {
	connections: {
		id: string;
		name: string;
		description: string;
		status: "connected" | "unreachable";
		reason?: string;
		dropped?: { count: number; why: DroppedWhy }[];
		tools: {
			offered: string;
			upstream: string;
			description: string;
			inputSchema: Record<string, unknown>;
		}[];
	}[];
}

export interface ProxyCallResult {
	content: unknown[];
	structuredContent?: unknown;
	isError?: boolean;
}

export interface ProxyPort {
	snapshot(runId: string, budgetMs: number): Promise<ProxySnapshot>;
	/** Live status on every `sources_list` (OBJ-010). */
	ping(
		runId: string,
		connectionId: string,
		timeoutMs: number,
	): Promise<{ ok: boolean; reason?: string }>;
	call(
		runId: string,
		offered: string,
		args: unknown,
		signal: AbortSignal,
	): Promise<ProxyCallResult>;
	close(runId: string): void;
}

export const noProxy: ProxyPort = {
	snapshot: async () => ({ connections: [] }),
	ping: async () => ({ ok: false, reason: "no MCP proxy is bound" }),
	call: async () => ({
		isError: true,
		content: [{ type: "text", text: "No such PrismaLens tool" }],
	}),
	close: () => {},
};
