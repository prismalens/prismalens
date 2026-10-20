// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";

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

export function knowledgeTools(
	search: (q: InvestigationsQuery) => Promise<PastInvestigation[]>,
): SourceTool[] {
	return [
		defineSourceTool({
			name: "investigations_search",
			title: "Search past investigations",
			description:
				"Past PrismaLens investigations matching a text query, newest first. `agentFinding` is what the agent concluded; `operatorRecordedCause` is what the operator recorded as the real cause, and wins where they differ.",
			input: z.object({
				query: z.string().trim().min(1).max(200),
				service: z.string().trim().min(1).max(200).optional(),
				limit: z.number().int().min(1).max(20).default(5),
			}),
			category: "knowledge",
			sideEffect: "read_only",
			openWorld: false,
			run: async ({ query, service, limit }, ctx) => ({
				value: await search({
					query,
					...(service ? { service } : {}),
					limit,
					excludeRunId: ctx.runId,
				}),
			}),
		}),
	];
}
