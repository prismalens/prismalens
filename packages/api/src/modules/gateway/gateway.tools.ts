// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type SourceCategory =
	| "metrics"
	| "logs"
	| "scm"
	| "deploys"
	| "knowledge";
export type SourceStatus = "connected" | "not-configured" | "unreachable";

/** Which category a Connection's template feeds; a template not listed here is not a data source. */
export const TEMPLATE_CATEGORY: Readonly<Record<string, SourceCategory>> = {
	prometheus: "metrics",
	alertmanager: "metrics",
	"github-token": "scm",
	"git-host-token": "scm",
	render: "deploys",
};

export const SOURCE_CATEGORIES: readonly SourceCategory[] = [
	"metrics",
	"logs",
	"scm",
	"deploys",
	"knowledge",
];

export interface SourceView {
	category: SourceCategory;
	status: SourceStatus;
	sources: Array<{
		id: string;
		label: string;
		kind: string;
		status: SourceStatus;
		/** For `unreachable`: when the last error was recorded. Never the error text, which may echo a credential. */
		lastErrorAt?: string;
	}>;
	/** The tools on this gateway that read the category; empty until a phase adds them. */
	tools: string[];
	howToConnect?: string;
}

export interface PastInvestigation {
	investigationId: string;
	incident: { number: number; title: string; service: string | null };
	completedAt: string | null;
	/** What the agent concluded. */
	agentFinding: {
		summary: string | null;
		rootCause: string | null;
		category: string | null;
	};
	/** What the operator recorded as the real cause when closing; null when nobody did. */
	operatorRecordedCause: { cause: string; category: string | null } | null;
}

export interface InvestigationsQuery {
	query: string;
	service?: string;
	limit: number;
	excludeRunId: string;
}

/** What the tools read; the api answers from its own database. */
export interface GatewayData {
	sources(): Promise<SourceView[]>;
	searchInvestigations(q: InvestigationsQuery): Promise<PastInvestigation[]>;
}

export const GATEWAY_TOOL_NAMES = [
	"sources_list",
	"investigations_search",
] as const;

const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
});

/** The gateway's MCP surface for one run: exactly two read-only tools (#848 Phase 0). */
export function gatewayMcpServer(data: GatewayData, runId: string): McpServer {
	const server = new McpServer({ name: "prismalens", version: "0.1.0" });
	server.registerTool(
		"sources_list",
		{
			title: "PrismaLens data sources",
			description:
				"Every data category (metrics, logs, scm, deploys, knowledge) with its status: connected, not-configured or unreachable, and which tools read it. Call first to know what this run can reach.",
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => json(await data.sources()),
	);
	server.registerTool(
		"investigations_search",
		{
			title: "Search past investigations",
			description:
				"Past PrismaLens investigations matching a text query, newest first. `agentFinding` is what the agent concluded; `operatorRecordedCause` is what the operator recorded as the real cause, and wins where they differ.",
			inputSchema: z.object({
				query: z.string().trim().min(1).max(200),
				service: z.string().trim().min(1).max(200).optional(),
				limit: z.number().int().min(1).max(20).default(5),
			}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ query, service, limit }) =>
			json(
				await data.searchInvestigations({
					query,
					...(service ? { service } : {}),
					limit,
					excludeRunId: runId,
				}),
			),
	);
	return server;
}
