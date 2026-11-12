// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { agentTitle } from "../../threads/thread-titles.js";
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
			...registered("pl_thread_list"),
			group: "knowledge",
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
						? "Call pl_thread_list without `service`, or pass a service pl_service_get shows for this thread."
						: "Answer without earlier threads.",
				);
			},
		}),
		defineHarnessTool({
			...registered("pl_thread_read"),
			group: "knowledge",
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
						"Call pl_thread_list and pass an id exactly as it returned it.",
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
			...registered("pl_thread_title"),
			group: "record",
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
