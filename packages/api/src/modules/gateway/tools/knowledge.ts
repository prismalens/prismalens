// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";

export interface PastInvestigation {
	investigationId: string;
	/** Null for a service check no finding has linked to an incident (#979). */
	incident: { number: number; title: string; service: string | null } | null;
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

/** An incident as the agent reads it: what PrismaLens recorded, labelled as such. */
export interface IncidentView {
	number: number;
	title: string;
	status: string;
	severity: string;
	service: string | null;
	triggeredAt: string;
	description: string | null;
	alerts: {
		title: string;
		severity: string;
		labels: Record<string, unknown> | null;
		triggeredAt: string;
	}[];
	/** Deploy and change events PrismaLens recorded for its services, newest first (#848). */
	changes: {
		type: string;
		source: string;
		timestamp: string;
		service: string | null;
		description: string | null;
		environment: string | null;
		version: string | null;
	}[];
}

/** By number, or the run's own incident when none is given; null when there is no such incident. */
export type IncidentLookup = (q: {
	runId: string;
	number?: number;
}) => Promise<IncidentView | null>;

export interface InvestigationsQuery {
	query: string;
	service?: string;
	limit: number;
	excludeRunId: string;
}

export function knowledgeTools(
	search: (q: InvestigationsQuery) => Promise<PastInvestigation[]>,
	incident: IncidentLookup,
): SourceTool[] {
	return [
		defineSourceTool({
			name: "incident_get",
			title: "Look up an incident",
			description:
				"An incident PrismaLens recorded: title, status, severity and service, with the alerts, deploy and change events PrismaLens recorded for its services from a day before it started. Without `number`, the incident this run investigates.",
			input: z.object({
				number: z.number().int().min(1).optional(),
			}),
			category: "knowledge",
			openWorld: false,
			run: async ({ number }, ctx) => {
				const found = await incident({
					runId: ctx.runId,
					...(number ? { number } : {}),
				});
				return found
					? { value: found }
					: { isError: true, value: { error: "No such incident" } };
			},
		}),
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
