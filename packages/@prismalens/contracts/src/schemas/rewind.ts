// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Edit a sent message and run it again (#1193, the #1128 items): later turns fold, the
 * agent's files go back, the user's edits stay, and the rewind can be undone.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import {
	type CanonicalEvent,
	RewindKeptSchema,
	RewindPathSchema,
} from "./investigation.js";
import {
	KEEP_WHYS,
	MESSAGE_TEXT_MAX,
	REWIND_PATHS_MAX,
} from "./investigation-values.js";

/** Why a message can't be edited now, in the order they are checked. */
export const REWIND_BLOCKS = [
	"view-only",
	"not-yours",
	"running",
	"queued",
	"before-report",
] as const;
export type RewindBlock = (typeof REWIND_BLOCKS)[number];

/** Each block's words, for the menu's hint and the refusal. */
export const REWIND_BLOCK_WORDS: Readonly<Record<RewindBlock, string>> = {
	"view-only": "This device can view and answer, not edit",
	"not-yours": "Only your own messages can be edited",
	running: "Stop the thread first",
	queued: "Send or withdraw your queued messages first",
	"before-report":
		"Messages before the report can't be edited. Fork from here instead.",
};

/** The branches a rewind folds: the edited message's own, and the asks it raised. */
export function CONVERSATION_BRANCHES(messageBranch: string): string[] {
	return [messageBranch, "asks"];
}

export const RewindPreviewInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		/** The edited `operator_message`'s seq on its branch. */
		seq: z.coerce.number().int().min(0),
	}),
);
export type RewindPreviewInput = z.infer<typeof RewindPreviewInputSchema>;

const RepoUnavailableReason = z.enum([
	"borrowed",
	"folder",
	"running",
	"view-only",
	"no-snapshot",
	"removed",
	"linked",
]);

export const RewindRepoPreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			repo: z.string(),
			state: z.literal("ok"),
			/** The token a confirm binds to: HEAD plus the worktree's tree, never a commit id. */
			head: z.string(),
			tree: z.string(),
			revert: z
				.array(
					z.object({
						path: z.string(),
						status: z.enum(["added", "modified", "deleted"]),
					}),
				)
				.max(REWIND_PATHS_MAX),
			/** Changed in a turn, but named by none of its tool calls: kept unless ticked. */
			duringTurn: z.array(z.string()).max(REWIND_PATHS_MAX),
			kept: z
				.array(z.object({ path: z.string(), why: z.enum(KEEP_WHYS) }))
				.max(REWIND_PATHS_MAX),
			/** Commits on HEAD since the message: they stay. */
			commits: z.number().int().nonnegative(),
		}),
		z.object({
			repo: z.string(),
			state: z.literal("unavailable"),
			reason: RepoUnavailableReason,
		}),
	]),
);
export type RewindRepoPreview = z.infer<typeof RewindRepoPreviewSchema>;

export const RewindSessionViaSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["fork", "replay", "new"]),
);
export type RewindSessionVia = z.infer<typeof RewindSessionViaSchema>;

export const RewindPreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		seq: z.number().int(),
		messageOrdinal: z.number().int(),
		/** The newest unfolded ordinal on the conversation's branches. */
		revision: z.number().int(),
		block: z.enum(REWIND_BLOCKS).nullable(),
		turns: z.number().int().nonnegative(),
		repos: z.array(RewindRepoPreviewSchema),
		/** What a rewind never undoes: outside effects, commits, other threads. */
		stays: z.array(z.string()),
		session: z.object({
			via: RewindSessionViaSchema,
			why: z.string().nullable(),
		}),
	}),
);
export type RewindPreview = z.infer<typeof RewindPreviewSchema>;

export const RewindExpectSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		messageOrdinal: z.number().int(),
		revision: z.number().int(),
		repos: z.record(
			z.string(),
			z.object({ head: z.string(), tree: z.string() }),
		),
	}),
);
export type RewindExpect = z.infer<typeof RewindExpectSchema>;

export const RewindInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		seq: z.number().int().min(0),
		text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX),
		expect: RewindExpectSchema,
		/** During-turn paths the user also wants set back; each must be in its repo's list. */
		include: z.array(RewindPathSchema).max(REWIND_PATHS_MAX).default([]),
	}),
);
export type RewindInput = z.infer<typeof RewindInputSchema>;

export const RewindResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("done"),
			rewindId: z.string().uuid(),
			reverted: z.array(RewindPathSchema),
			kept: z.array(RewindKeptSchema),
			/** false: the edit was not admitted; the client keeps the text in the box. */
			sent: z.boolean(),
			why: z.string().nullable(),
		}),
		z.object({
			state: z.literal("refused"),
			reason: z.enum([...REWIND_BLOCKS, "stale", "conflict"]),
			paths: z.array(RewindPathSchema),
		}),
	]),
);
export type RewindResult = z.infer<typeof RewindResultSchema>;

export const RewindUndoInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid(), rewindId: z.string().uuid() }),
);
export type RewindUndoInput = z.infer<typeof RewindUndoInputSchema>;

export const RewindUndoResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("done"),
			restored: z.array(RewindPathSchema),
			kept: z.array(RewindKeptSchema),
		}),
		z.object({
			state: z.literal("refused"),
			reason: z.enum([
				"running",
				"view-only",
				"stale",
				"superseded",
				"already-undone",
			]),
			paths: z.array(RewindPathSchema),
		}),
	]),
);
export type RewindUndoResult = z.infer<typeof RewindUndoResultSchema>;

/** An interrupted operation's restore, previewed fresh (R16). */
export const RewindRestoreQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid(), op: z.string().uuid() }),
);
export const RewindRestorePreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		op: z.string().uuid(),
		repo: z.string(),
		block: z.enum(["view-only", "running"]).nullable(),
		/** Set back to the backup: each is at the interrupted operation's target now. */
		overwrite: z.array(z.string()).max(REWIND_PATHS_MAX),
		/** Present now, absent from the backup: kept unless ticked. */
		created: z.array(z.string()).max(REWIND_PATHS_MAX),
		/** In neither the backup's state nor the target's: written only if ticked. */
		damaged: z.array(z.string()).max(REWIND_PATHS_MAX),
		head: z.string(),
		tree: z.string(),
		backup: z.string(),
		/** The files as they are now, a snapshot: Show backup diffs the backup against it. */
		now: z.string(),
	}),
);
export type RewindRestorePreview = z.infer<typeof RewindRestorePreviewSchema>;
export const RewindRestoreInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		op: z.string().uuid(),
		expect: z.object({ head: z.string(), tree: z.string() }),
		/** Created or damaged paths the user ticked. */
		include: z.array(z.string()).max(REWIND_PATHS_MAX).default([]),
	}),
);
export type RewindRestoreInput = z.infer<typeof RewindRestoreInputSchema>;
export const RewindRestoreResultSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("state", [
		z.object({
			state: z.literal("done"),
			restored: z.array(RewindPathSchema),
			kept: z.array(RewindKeptSchema),
		}),
		z.object({
			state: z.literal("refused"),
			reason: z.enum(["view-only", "running", "stale", "gone"]),
			paths: z.array(RewindPathSchema),
		}),
	]),
);
export type RewindRestoreResult = z.infer<typeof RewindRestoreResultSchema>;

/** A rewind's folded turns, read back for the fold row's Show. */
export const RewindFoldedInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid(), rewindId: z.string().uuid() }),
);

/** Where a native fork cuts the agent's session, and what its loaded tail must show (R1). */
export interface ForkPoint {
	messageId: string;
	tail: { prompts: number; text: string };
}

/**
 * The fork point before message `fromSeq`: the turn just before it must end on an agent
 * message the ACP layer stamped, with no tool after it. `events` are unfolded, in commit order.
 */
export function forkPointOf(
	events: readonly CanonicalEvent[],
	fromSeq: number,
	branchId = "run",
): { point: ForkPoint | null; why: string | null } {
	const mine = events.filter((e) => "branchId" in e && e.branchId === branchId);
	const at = mine.findIndex(
		(e) => e.kind === "operator_message" && e.seq === fromSeq,
	);
	if (at < 0) return { point: null, why: "the message is not in the record" };
	const prompts = mine
		.slice(0, at)
		.filter((e) => e.kind === "operator_message" && e.delivered).length;
	if (prompts === 0) return { point: null, why: "it is the first message" };
	let last: CanonicalEvent | undefined;
	for (let i = at - 1; i >= 0; i--) {
		const e = mine[i] as CanonicalEvent;
		if (e.kind === "operator_message") break;
		if (e.kind === "agent_step" || e.kind === "tool_result") {
			last = e;
			break;
		}
	}
	if (
		!last ||
		last.kind !== "agent_step" ||
		last.toolCalls.length > 0 ||
		!last.acpMessageId
	)
		return {
			point: null,
			why: "the turn before ended in a tool call",
		};
	return {
		point: {
			messageId: last.acpMessageId,
			tail: { prompts, text: last.text },
		},
		why: null,
	};
}
