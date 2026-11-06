// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { agentTitle } from "../../threads/thread-titles.js";
import { withRules } from "./rules.js";
import { ANYWHERE, SCOPED } from "./serves.js";

/** A thread as a list shows it: enough to pick one to read. */
export interface ThreadSummary {
	id: string;
	kind: string;
	status: string;
	startedAt: string | null;
	finishedAt: string | null;
	agent: string | null;
	model: string | null;
	/** Only a finished thread has one. */
	summary?: string;
}

export interface ThreadReport {
	summary: string | null;
	rootCause: string | null;
	hypotheses: { statement: string; status: string }[];
	nextSteps: { title: string; detail: string }[];
	culprit: {
		service: string | null;
		changeRef: string | null;
		mechanism: string | null;
	} | null;
}

export interface ThreadView {
	id: string;
	kind: string;
	status: string;
	/** Set on a finished thread. */
	report: ThreadReport | null;
	/** The last agent-step texts of an unfinished thread, oldest first. */
	steps: string[];
	error: string | null;
	/** With `afterSeq` or `limit`: the next steps of any thread, and the seq to pass next. */
	page?: { steps: { seq: number; text: string }[]; nextSeq: number | null };
}

/** Threads are investigations and chats; a run reads only its incident's, project's and services'. */
export interface ThreadsData {
	list(q: {
		runId: string;
		service?: string;
		limit: number;
	}): Promise<{ threads: ThreadSummary[] } | { error: string }>;
	/**
	 * Null when there is no such thread, or it is outside this run's incident, project, services
	 * and tree. `page` reads a tree member's steps after `afterSeq`, oldest first (#1024).
	 */
	read(
		runId: string,
		threadId: string,
		page?: { afterSeq?: number; limit: number },
	): Promise<ThreadView | null>;
	/** Names this run's thread unless the user already did; `kept` is the user's name standing. */
	title(
		runId: string,
		title: string,
	): Promise<{ title: string; kept: boolean }>;
}

const limit = z.number().int().min(1).max(50).default(10);

export function threadTools(data: ThreadsData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "thread_list",
			title: "Threads on this incident, project or service",
			description: withRules(
				"Earlier investigations and chats (threads) on this run's incident, project or service, or across one of its services named in `service`, newest first: id, kind, status, start and finish time, agent and model, and a one-line summary when finished. Excludes this run. Use it to see what was already tried; read one with thread_read.",
				"this thread's own tree: use thread_roster.",
			),
			group: "knowledge",
			effect: "read",
			serves: SCOPED,
			input: z.object({
				service: z.string().trim().min(1).max(200).optional(),
				limit,
			}),
			run: async ({ service, limit }, ctx) => {
				const r = await data.list({
					runId: ctx.runId,
					...(service ? { service } : {}),
					limit,
				});
				if (!("error" in r)) return { value: { threads: r.threads } };
				return fail(
					"not_found",
					r.error,
					service
						? "Call thread_list without `service`, or pass a service service_get shows for this thread."
						: "Answer without earlier threads.",
				);
			},
		}),
		defineHarnessTool({
			name: "thread_read",
			title: "Read one thread",
			description: withRules(
				"One thread thread_list returned, by id. A finished one gives its report: summary, root cause, hypotheses with status, next steps and culprit. A failed or stopped one gives its status, error and last 20 agent-step texts; a running one gives only its status. Only threads on this run's incident, project or services, or in its own tree, can be read. Use it to see what a thread found; `afterSeq` and `limit` page a running tree member's steps, and `page.nextSeq` is the next `afterSeq`.",
				"this run itself.",
			),
			group: "knowledge",
			effect: "read",
			serves: { ...SCOPED, tree: true },
			input: z.object({
				threadId: z.string().trim().min(1).max(100),
				afterSeq: z.number().int().min(-1).optional(),
				limit: z.number().int().min(1).max(50).optional(),
			}),
			run: async ({ threadId, afterSeq, limit }, ctx) => {
				const paged = afterSeq !== undefined || limit !== undefined;
				const t = await data.read(
					ctx.runId,
					threadId,
					paged
						? {
								...(afterSeq !== undefined ? { afterSeq } : {}),
								limit: limit ?? 20,
							}
						: undefined,
				);
				if (!t)
					return fail(
						"not_found",
						`No thread "${threadId}" on this thread's incident, project or services.`,
						"Call thread_list and pass an id exactly as it returned it.",
					);
				const { report, steps, error, page, ...head } = t;
				return {
					value: {
						...(report
							? { ...head, ...report }
							: { ...head, ...(error ? { error } : {}), steps }),
						...(page ? { page } : {}),
					},
				};
			},
		}),
		defineHarnessTool({
			name: "thread_title",
			title: "Name this thread",
			description: withRules(
				"Give this thread a short title, 3 to 7 words and at most 80 characters, once you know what it is about; call it again if the subject changes. Plain words only. Once the user renames the thread, their name stays and this returns it with `kept: true`. Use it once you know the subject.",
				"status updates: the title is a name.",
			),
			group: "record",
			effect: "record",
			serves: ANYWHERE,
			input: z.object({
				title: z.string().min(1).max(200),
			}),
			run: async ({ title }, ctx) => {
				const checked = agentTitle(title);
				if ("error" in checked)
					return fail(
						"invalid_input",
						checked.error,
						"Name it in 3 to 7 plain words.",
					);
				return { value: await data.title(ctx.runId, checked.title) };
			},
		}),
	];
}
