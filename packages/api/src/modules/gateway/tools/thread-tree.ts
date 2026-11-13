// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	AccessLevelSchema,
	THREAD_MESSAGE_CHARS,
	ThreadMessageModeSchema,
} from "@prismalens/contracts/schemas";
import {
	defineHarnessTool,
	type HarnessTool,
	registered,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { ANYWHERE } from "./serves.js";

/** The caller's own key for a call; a retry with the same key never repeats it. */
const REQUEST_ID = z.string().trim().min(1).max(100);
/** A thread's link or id, or `starter`. */
const THREAD = z.string().trim().min(1).max(300);

export const ThreadStartInput = z.object({
	title: z.string().trim().min(3).max(80),
	brief: z.string().trim().min(20).max(6_000),
	agent: z.string().trim().min(1).max(64).optional(),
	model: z.string().trim().min(1).max(200).optional(),
	effort: z.string().trim().min(1).max(64).optional(),
	access: AccessLevelSchema.optional(),
	workspace: z
		.object({
			kind: z.enum(["new_from_parent", "new_from_ref", "same_project_fresh"]),
			ref: z
				.string()
				.regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/)
				.optional(),
		})
		.refine((w) => w.kind !== "new_from_ref" || !!w.ref, {
			message: "new_from_ref needs `ref`",
			path: ["ref"],
		})
		.default({ kind: "new_from_parent" }),
	requestId: REQUEST_ID,
});

export const ThreadSendInput = z.object({
	to: THREAD,
	text: z.string().trim().min(1).max(THREAD_MESSAGE_CHARS),
	mode: ThreadMessageModeSchema.default("queue"),
	requestId: REQUEST_ID,
});

/** What the thread tools do; the api answers, gated by the host's approval. */
export interface ThreadTreeData {
	start(
		runId: string,
		input: z.output<typeof ThreadStartInput>,
	): Promise<ToolOutcome>;
	send(
		runId: string,
		input: z.output<typeof ThreadSendInput>,
	): Promise<ToolOutcome>;
	cancel(
		runId: string,
		id: string,
		reason: string,
		requestId: string,
	): Promise<ToolOutcome>;
}

/** Threads that start threads (#1101 cat 10): start, message and stop sibling threads. */
export function threadTreeTools(data: ThreadTreeData): HarnessTool[] {
	return [
		defineHarnessTool({
			...registered("pl_thread_start"),
			group: "core",
			serves: ANYWHERE,
			input: ThreadStartInput,
			run: (input, ctx) => data.start(ctx.runId, input),
		}),
		defineHarnessTool({
			...registered("pl_thread_send"),
			group: "core",
			serves: ANYWHERE,
			input: ThreadSendInput,
			run: (input, ctx) => data.send(ctx.runId, input),
		}),
		defineHarnessTool({
			...registered("pl_thread_cancel"),
			group: "core",
			serves: ANYWHERE,
			input: z.object({
				id: THREAD,
				reason: z.string().trim().min(1).max(500),
				requestId: REQUEST_ID,
			}),
			run: ({ id, reason, requestId }, ctx) =>
				data.cancel(ctx.runId, id, reason, requestId),
		}),
	];
}
