// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";

export interface SimilarIncident {
	number: number;
	title: string;
	service: string | null;
	status: string;
	resolvedAt: string | null;
	/** What the operator recorded as the real cause on close. */
	actualCause: { cause: string; category: string | null } | null;
	/** 0 to 100, as the similarity table stores it. */
	similarityScore: number;
	matchedOn: string[];
}

export interface PastFix {
	id: string;
	title: string;
	detail: string | null;
	/** The number of the incident the investigation ran on. */
	incident: number;
	investigationId: string;
	/** `applied` for a completed recommendation; otherwise as stored. */
	status: string;
	priority: string;
	category: string | null;
	appliedAt: string | null;
	/** The latest fix check since it was applied. */
	lastCheck: { verdict: string; at: string } | null;
}

/** What PrismaLens remembers of other incidents; null when the run has no incident. */
export interface HistoryData {
	similar(
		runId: string,
		limit: number,
	): Promise<{ incident: number; similar: SimilarIncident[] } | null>;
	fixes(
		runId: string,
		limit: number,
	): Promise<{ incident: number; fixes: PastFix[] } | null>;
}

const noIncident = () =>
	fail(
		"not_found",
		"This run has no incident recorded.",
		"Continue from the alerts in your prompt.",
	);

export function historyTools(data: HistoryData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "incidents_similar",
			title: "Past incidents like this one",
			description:
				"The past incidents PrismaLens scored most like this run's incident, best first: number, title, service, status, when resolved, the cause the operator recorded if any, the stored similarity score (0 to 100) and what it matched on. Use it to find a precedent, then read its threads with thread_list.",
			group: "knowledge",
			effect: "read",
			input: z.object({
				limit: z.number().int().min(1).max(20).default(5),
			}),
			run: async ({ limit }, ctx) => {
				const r = await data.similar(ctx.runId, limit);
				return r ? { value: r } : noIncident();
			},
		}),
		defineHarnessTool({
			name: "fixes_list",
			title: "Fixes proposed on past investigations",
			description:
				"Fixes and recommendations from past investigations on this incident's services, newest first: title, detail, incident, status (applied, rejected, deferred, pending), priority, when applied and the latest fix-check verdict if any. Use it to see what was proposed and whether it worked.",
			group: "knowledge",
			effect: "read",
			input: z.object({
				limit: z.number().int().min(1).max(50).default(10),
			}),
			run: async ({ limit }, ctx) => {
				const r = await data.fixes(ctx.runId, limit);
				return r ? { value: r } : noIncident();
			},
		}),
	];
}
