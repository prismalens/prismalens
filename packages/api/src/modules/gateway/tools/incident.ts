// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";

export interface TimelineItem {
	type: string;
	source: "operator" | "agent" | "system";
	text: string;
	at: string;
}

export interface ChangeItem {
	type: string;
	source: string;
	at: string;
	service: string | null;
	description: string | null;
	environment: string | null;
	version: string | null;
}

/** What the run's incident holds beyond `incident_get`: its timeline and its services' changes. */
export interface IncidentRecordData {
	/** The latest `limit` entries; null when the run has no incident. */
	timeline(
		runId: string,
		limit: number,
	): Promise<{
		incident: number;
		total: number;
		entries: TimelineItem[];
	} | null>;
	/** The run's incident and the names of its services; null when it has none. */
	scope(runId: string): Promise<{
		number: number;
		triggeredAt: string;
		services: string[];
	} | null>;
	/** Newest first. `unknown` names the services PrismaLens does not have. */
	changes(q: {
		services: string[];
		from: string;
		to: string;
		limit: number;
	}): Promise<{ unknown: string[]; changes: ChangeItem[] }>;
}

const DAY_MS = 24 * 3_600_000;
/** The longest window `changes_list` reads. */
const WINDOW_MS = 7 * DAY_MS;

const limit = z.number().int().min(1).max(50).default(10);
const time = z.iso.datetime({ offset: true });

export function incidentTools(data: IncidentRecordData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "timeline_read",
			title: "This incident's timeline",
			description:
				"The timeline PrismaLens keeps for this run's incident, oldest first: type, who wrote it (operator, agent or system), text and time. Returns the latest `limit` entries and the total. Use it to see what the operator and earlier runs did.",
			group: "knowledge",
			effect: "read",
			input: z.object({ limit }),
			run: async ({ limit }, ctx) => {
				const t = await data.timeline(ctx.runId, limit);
				return t
					? { value: t }
					: fail(
							"not_found",
							"This run has no incident recorded, so there is no timeline.",
							"Continue from the alerts in your prompt.",
						);
			},
		}),
		defineHarnessTool({
			name: "changes_list",
			title: "Changes and deploys in a window",
			description:
				"Change and deploy events PrismaLens recorded, newest first: type, source, time, service, description, environment, version. Defaults to this incident's services, from a day before it started until now. `from` and `to` are ISO times and the window is at most 7 days. Use it to find what changed before a failure.",
			group: "knowledge",
			effect: "read",
			input: z.object({
				services: z
					.array(z.string().trim().min(1).max(200))
					.min(1)
					.max(20)
					.optional(),
				from: time.optional(),
				to: time.optional(),
				limit,
			}),
			run: async ({ services, from, to, limit }, ctx) => {
				const scope = await data.scope(ctx.runId);
				const names = services ?? scope?.services ?? [];
				if (!names.length)
					return fail(
						"not_found",
						scope
							? "This incident has no service recorded."
							: "This run has no incident recorded.",
						"Pass `services` with names from incident_get or service_get.",
					);
				const now = Date.now();
				const base = (scope ? Date.parse(scope.triggeredAt) : now) - DAY_MS;
				const start = from
					? Date.parse(from)
					: to
						? Math.max(base, Date.parse(to) - WINDOW_MS)
						: base;
				const end = to ? Date.parse(to) : Math.min(now, start + WINDOW_MS);
				if (end <= start)
					return fail(
						"invalid_input",
						"The window ends before it starts.",
						"Pass `from` earlier than `to`.",
					);
				if (end - start > WINDOW_MS)
					return fail(
						"invalid_input",
						"The window is longer than 7 days.",
						"Narrow `from` and `to` to at most 7 days; call again for another window.",
					);
				const window = {
					from: new Date(start).toISOString(),
					to: new Date(end).toISOString(),
				};
				const r = await data.changes({ services: names, ...window, limit });
				if (r.unknown.length)
					return fail(
						"not_found",
						`PrismaLens has no service named ${r.unknown.map((n) => `"${n}"`).join(", ")}.`,
						"Use service names from incident_get, or omit `services` for this incident's.",
					);
				return {
					value: { window, services: names, changes: r.changes },
				};
			},
		}),
	];
}
