// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	type QueryKind,
	type QuerySource,
	registerSourceTools,
	SOURCE_TOOL_NAMES,
} from "./source-tools.js";

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
	loki: "logs",
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
		/** Why a probe failed, in PrismaLens's own words. */
		reason?: string;
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
	querySources(kind: QueryKind): Promise<QuerySource[]>;
}

/** The tools that read each category (#848 Phase 1). */
export const CATEGORY_TOOLS: Readonly<
	Partial<Record<SourceCategory, string[]>>
> = {
	metrics: [
		"prometheus_query",
		"prometheus_query_range",
		"prometheus_alerts",
		"alertmanager_alerts",
	],
	logs: ["loki_query_range"],
	knowledge: ["investigations_search"],
};

export const GATEWAY_TOOL_NAMES = [
	"sources_list",
	"investigations_search",
	...SOURCE_TOOL_NAMES,
] as const;

const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
});

/** The gateway's MCP surface for one run: read-only tools only (#848). */
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
	registerSourceTools(server, (kind) => data.querySources(kind));
	return server;
}
