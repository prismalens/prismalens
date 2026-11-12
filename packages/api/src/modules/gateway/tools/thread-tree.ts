// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	AccessLevelSchema,
	THREAD_MESSAGE_CHARS,
	ThreadMessageModeSchema,
	ThreadMessageTypeSchema,
	ThreadRoleSchema,
} from "@prismalens/contracts/schemas";
import {
	defineHarnessTool,
	type HarnessTool,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { withRules } from "./rules.js";
import { ANYWHERE } from "./serves.js";

/** The caller's own key for a call; a retry with the same key never repeats it. */
const REQUEST_ID = z.string().trim().min(1).max(100);
const MEMBER = z.string().trim().min(1).max(300);

export const ThreadStartInput = z.object({
	title: z.string().trim().min(3).max(80),
	role: ThreadRoleSchema,
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
	to: MEMBER,
	type: ThreadMessageTypeSchema,
	text: z.string().trim().min(1).max(THREAD_MESSAGE_CHARS),
	mode: ThreadMessageModeSchema.default("queue"),
	requestId: REQUEST_ID,
});

/** What the tree tools do; the api answers from its thread tree, gated by the host's approval. */
export interface ThreadTreeData {
	start(
		runId: string,
		input: z.output<typeof ThreadStartInput>,
	): Promise<ToolOutcome>;
	send(
		runId: string,
		input: z.output<typeof ThreadSendInput>,
	): Promise<ToolOutcome>;
	wait(runId: string, ids: string[], mode: "any" | "all"): Promise<ToolOutcome>;
	cancel(
		runId: string,
		id: string,
		reason: string,
		requestId: string,
	): Promise<ToolOutcome>;
	roster(runId: string): Promise<ToolOutcome>;
}

/** Threads that start threads (#1024 spec F): start, message, wait on, cancel and list a tree. */
export function threadTreeTools(data: ThreadTreeData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "pl_thread_start",
			title: "Start a child thread",
			description: withRules(
				"Start a full thread for one line of work, such as one suspect service, with its own workspace and session. Use it when parallel work saves time. The brief is the child's only context: give the goal, the files, the command that must pass and what to return. Name agent, model and effort if they should differ from yours; access is never broader than yours. Asynchronous: it may answer `pending_approval` until the user approves on PrismaLens's card; do not poll, the result arrives as a message. `requestId` is your key: a retry with it never starts a second thread.",
				"small steps you can do here, or sub-tasks your own sub-agents handle.",
			),
			group: "core",
			effect: "act",
			serves: ANYWHERE,
			input: ThreadStartInput,
			run: (input, ctx) => data.start(ctx.runId, input),
		}),
		defineHarnessTool({
			name: "pl_thread_send",
			title: "Message a thread in this tree",
			description: withRules(
				"Send a typed message (handoff, blocker, fact, question, reply) to a member of this thread's tree, by its role, `parent` or `root`. Use it only for what changes the receiver's work; never acknowledge, and reply only to a question. Asynchronous: it is delivered at the receiver's next pause; do not poll for a reply. `steer` delivers now and is only for a parent's blocker to its own child. `requestId` is your key: a retry with it is not sent twice.",
				"threads outside this tree, or status updates.",
			),
			group: "core",
			effect: "record",
			serves: ANYWHERE,
			input: ThreadSendInput,
			run: (input, ctx) => data.send(ctx.runId, input),
		}),
		defineHarnessTool({
			name: "pl_thread_wait",
			title: "Be woken when children finish",
			description: withRules(
				"Register a wake on your children, by role, link or the `requestId` of a pl_thread_start still waiting for approval. It never blocks: end your turn, and each result arrives as a message at your next pause; if you have ended, your thread reopens for it (`all`: once every one has finished). Use it before you end a turn that needs a child's result. Do not poll pl_thread_roster or pl_thread_read instead.",
				"threads you did not start.",
			),
			group: "core",
			effect: "read",
			serves: ANYWHERE,
			input: z.object({
				ids: z.array(MEMBER).min(1).max(20),
				mode: z.enum(["any", "all"]).default("all"),
			}),
			run: ({ ids, mode }, ctx) => data.wait(ctx.runId, ids, mode),
		}),
		defineHarnessTool({
			name: "pl_thread_cancel",
			title: "Stop a thread you started",
			description: withRules(
				"Stop a thread this one started, directly or below it, by role or link, with the reason it gets. Use it to cancel what you replace. Asynchronous: it may answer `pending_approval` until the user approves; do not poll. `requestId` is your key: a retry with it is not sent twice.",
				"pausing a thread, or threads you did not start.",
			),
			group: "core",
			effect: "act",
			serves: ANYWHERE,
			input: z.object({
				id: MEMBER,
				reason: z.string().trim().min(1).max(500),
				requestId: REQUEST_ID,
			}),
			run: ({ id, reason, requestId }, ctx) =>
				data.cancel(ctx.runId, id, reason, requestId),
		}),
		defineHarnessTool({
			name: "pl_thread_roster",
			title: "This thread's tree",
			description: withRules(
				"The members of this thread's tree: number, role, how each relates to you (parent, child, sibling, root), title, state and link. Use it to address a member by role, or once after a roster update. A thread outside any tree gets itself alone.",
				"waiting: register a wake with pl_thread_wait.",
			),
			group: "knowledge",
			effect: "read",
			serves: ANYWHERE,
			input: z.object({}),
			run: (_input, ctx) => data.roster(ctx.runId),
		}),
	];
}
