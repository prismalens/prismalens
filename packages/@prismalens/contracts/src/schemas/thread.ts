// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads on a project, a service, or nothing at all (#1020): a chat that is not
 * an incident's. Incident and schedule threads keep their own routes.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { AskKindSchema, PendingAskSchema } from "./asks.js";
import {
	CoerceDateSchema,
	DateStringSchema,
	IncidentStatusSchema,
	SeveritySchema,
} from "./common.js";
import {
	MAX_QUOTES_PER_MESSAGE,
	MessageContextShape,
	QuoteSchema,
} from "./composer.js";
import { GitStateSchema } from "./git-state.js";
import {
	AttachmentIdsSchema,
	AttachmentPlacesSchema,
	HelperPlaceSchema,
	InvestigationSchema,
	RunChoiceSchema,
} from "./investigation.js";
import { FailureModeSchema, NextTrySchema } from "./provider-failure.js";
import { ThreadRowPrSchema } from "./pull-request.js";
import { WorkInSchema } from "./repository.js";
import { AccessLevelSchema } from "./settings.js";
import { INVESTIGATION_KINDS } from "./state-semantics.js";
import { ThreadStatusInfoSchema } from "./thread-status.js";
import { QueryFlagSchema } from "./thread-window.js";

export const ThreadStartSubjectSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("project"), repositoryId: z.string().uuid() }),
		z.object({ kind: z.literal("service"), serviceId: z.string().uuid() }),
		z.object({ kind: z.literal("none") }),
	]),
);
export type ThreadStartSubject = z.infer<typeof ThreadStartSubjectSchema>;

/** Body of `POST /threads`: the first message starts the thread's run. */
export const StartThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.object({
			subject: ThreadStartSubjectSchema,
			text: z.string().trim().min(1).max(4000),
			accessLevel: AccessLevelSchema.optional(),
			...RunChoiceSchema.shape,
			/** Uploaded first with `POST /threads/drafts/{draftKey}/attachments`. */
			attachments: AttachmentIdsSchema.optional(),
			attachmentsAt: AttachmentPlacesSchema.optional(),
			draftKey: z.string().uuid().optional(),
			/** A helper started from an empty page; only on a no-subject thread. */
			place: HelperPlaceSchema.optional(),
			...MessageContextShape,
			/** Only on a local git project; absent takes the project's remembered choice (#1024). */
			workIn: WorkInSchema.optional(),
		})
		.refine((v) => !v.place || v.subject.kind === "none", {
			message: "Only a thread with no subject starts from a page.",
			path: ["place"],
		}),
);
export type StartThreadInput = z.infer<typeof StartThreadSchema>;

export const StartThreadResponseSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		investigationId: z.string().uuid(),
		jobId: z.string().nullable(),
		queued: z.boolean(),
	}),
);

export const ThreadListQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		repositoryId: z.string().uuid().optional(),
		serviceId: z.string().uuid().optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	}),
);

export const ThreadListSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		data: z.array(InvestigationSchema),
	}),
);

/** The thread list's sections, in rank order: Needs you outranks the rest. */
export const THREAD_SECTIONS = ["needs", "active", "settled"] as const;
export const ThreadSectionSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(THREAD_SECTIONS),
);
export type ThreadSection = z.infer<typeof ThreadSectionSchema>;

/** `GET /threads/feed`: every thread, any subject, paged by unit (#1020). */
export const ThreadFeedQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		search: z.string().trim().max(200).optional(),
		kind: z.enum(INVESTIGATION_KINDS).optional(),
		section: ThreadSectionSchema.optional(),
		repositoryId: z.string().uuid().optional(),
		/** Only threads with activity at or after this time. */
		since: CoerceDateSchema.optional(),
		/** Units to skip; a unit is one thread or one incident's block. */
		cursor: z.coerce.number().int().min(0).default(0),
		limit: z.coerce.number().int().min(1).max(100).default(40),
		/** Archived threads only; absent lists every thread that is not archived (#1101). */
		archived: QueryFlagSchema,
	}),
);
export type ThreadFeedQuery = z.infer<typeof ThreadFeedQuerySchema>;

export const ThreadIncidentChipSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		number: z.number().int(),
		title: z.string(),
		severity: SeveritySchema,
		status: IncidentStatusSchema,
	}),
);

/** A row: the run, its context names, and the plain-text line under its title. */
/**
 * Automatic PR updates and cron fires held (#1024 surface F): `ceiling` clears on
 * the user's next message; `loop_guard` only when the user watches that PR again.
 */
export const AutoPauseSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		reason: z.enum(["ceiling", "loop_guard"]),
		prId: z.string().optional(),
		since: DateStringSchema,
	}),
);
export type AutoPause = z.infer<typeof AutoPauseSchema>;
/** Turns no person asked for (PR deliveries and cron fires) a thread admits per rolling day. */
export const AUTONOMOUS_TURNS_PER_DAY = 12;

export const ThreadRowSchema = /* @__PURE__ */ lazySchema(() =>
	InvestigationSchema.extend({
		section: ThreadSectionSchema,
		lastActivityAt: DateStringSchema,
		lastVisitedAt: DateStringSchema.nullable(),
		settledAt: DateStringSchema.nullable(),
		/** The latest outcome or failure has not been opened since it landed. */
		unseen: z.boolean(),
		/** The agent's latest sentence; untrusted, shown as plain text. */
		latestText: z.string().nullable(),
		projectName: z.string().nullable(),
		/** Who named the thread last; once `user`, the agent's titles are ignored. */
		titleSetBy: z.enum(["agent", "user"]).nullable(),
		serviceName: z.string().nullable(),
		/** The newest ask the thread waits on, for the row's approval preview (#1024). */
		waitingAsk: z
			.object({ kind: AskKindSchema, title: z.string() })
			.nullable()
			.optional(),
		/** The thread's composer keeps unsent words or files (#1024). */
		hasDraft: z.boolean().optional(),
		/** The thread's newest linked pull request, for the hover card and the row glyph (#1024). */
		pr: ThreadRowPrSchema.optional(),
		/** A git state its worktree is stuck in, for the row's mark (#1101 bar 15.1). */
		git: GitStateSchema.nullable().optional(),
		/** The branch its workspace works on, for the row's meta line (#1105); null with none. */
		branch: z.string().max(300).nullable().optional(),
		/**
		 * The thread waits on its provider (#1024 surface F, #1101): Limited with its reset
		 * or next try, or Blocked (`stopState(mode)`) with no timer; null otherwise.
		 */
		limit: z
			.object({
				resetsAt: DateStringSchema.nullable(),
				mode: FailureModeSchema.optional(),
				/** When PrismaLens tries again; absent when it will not by itself. */
				nextAttemptAt: DateStringSchema.optional(),
				/** With no known reset, `nextAttemptAt` is this try: "next try 08:37 (try 2 of 7)". */
				nextTry: NextTrySchema.optional(),
			})
			.nullable()
			.optional(),
		/** Automatic updates are paused until a person acts; the row lists under Waiting for you. */
		paused: AutoPauseSchema.nullable().optional(),
		/** The thread whose agent started it, or that a person forked it from; null otherwise (#1101 cat 10). */
		startedBy: z
			.object({
				id: z.string(),
				title: z.string().nullable(),
				link: z.string(),
				via: z.enum(["agent", "fork"]),
			})
			.nullable()
			.optional(),
		/** Its one status and the reason behind it (#1101 category 2). */
		state: ThreadStatusInfoSchema.optional(),
		/** Pinned rows list first; null when not pinned (#1101 category 20). */
		pinnedAt: DateStringSchema.nullable().optional(),
		/** Archived threads leave the list until the archived filter shows them. */
		archivedAt: DateStringSchema.nullable().optional(),
	}),
);
export type ThreadRow = z.infer<typeof ThreadRowSchema>;

/** One thread, or every listed thread of one incident, which page as one. */
export const ThreadUnitSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		section: ThreadSectionSchema,
		incident: ThreadIncidentChipSchema.nullable(),
		threads: z.array(ThreadRowSchema).min(1),
	}),
);
export type ThreadUnit = z.infer<typeof ThreadUnitSchema>;

export const ThreadFeedSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		units: z.array(ThreadUnitSchema),
		nextCursor: z.number().int().nullable(),
		/** Units per section over the whole filtered list, never one page. */
		counts: z.object({
			needs: z.number().int(),
			active: z.number().int(),
			settled: z.number().int(),
			/** Threads, not units, that need you: the list header's count (#1101 cat 1 item 2). */
			needsThreads: z.number().int().optional(),
		}),
	}),
);
export type ThreadFeed = z.infer<typeof ThreadFeedSchema>;

export const ThreadIdSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid() }),
);

/** Settle or unsettle; on an incident's thread it covers the incident's block. */
export const SettledStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		settledAt: DateStringSchema.nullable(),
	}),
);

export type SettledState = z.infer<typeof SettledStateSchema>;

export const SettleThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		settled: z.boolean(),
		/** On Undo: each thread's state from Settle's `previous`, restored exactly. */
		restore: z.array(SettledStateSchema).optional(),
		/** Required when the block has a running run: settling stops it at once. */
		stopRunning: z.boolean().optional(),
	}),
);

/** What settling removes from one directory a thread worked in (#1024 surface F). */
export const WorktreeVerdictSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		threadId: z.string().uuid(),
		dir: z.string(),
		action: z.enum(["remove", "keep"]),
		/** Why it is kept, e.g. "2 uncommitted files". */
		reason: z.string().optional(),
	}),
);
export type WorktreeVerdict = z.infer<typeof WorktreeVerdictSchema>;

/** `GET /threads/{id}/settle-preview`: what settling the block would end. */
export const SettlePreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		wakes: z.number().int().nonnegative(),
		watches: z.number().int().nonnegative(),
		crons: z.number().int().nonnegative(),
		/** Running runs in the block; non-zero needs `stopRunning`. Threads it started run on. */
		running: z.number().int().nonnegative(),
		worktrees: z.array(WorktreeVerdictSchema),
	}),
);
export type SettlePreview = z.infer<typeof SettlePreviewSchema>;

/** Settle's answer; `undoUntil` is the one Undo deadline, null on unsettle. */
export const SettleResponseSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		ids: z.array(z.string()),
		previous: z.array(SettledStateSchema),
		undoUntil: DateStringSchema.nullable(),
		/** What the teardown ends once Undo's window closes; null on unsettle. */
		ended: SettlePreviewSchema.nullable(),
	}),
);
export type SettleResponse = z.infer<typeof SettleResponseSchema>;

/** How long Undo can take a settle back before its teardown ends its jobs. */
export const SETTLE_UNDO_MS = 8_000;

/** A settle refused: a running run without `stopRunning`, or Undo after `undoUntil`. */
export const SettleRefusalSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		reason: z.enum(["running", "ended"]),
		running: z.number().int().nonnegative().optional(),
	}),
);

/** Pin or unpin, archive or unarchive one thread (#1101 category 20). */
export const ThreadFlagSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		on: z.boolean(),
	}),
);
export const ThreadFlagResponseSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string(),
		at: DateStringSchema.nullable(),
	}),
);

/**
 * Fork here or Side question (#1101 category 20): a child thread under this one that
 * reads it as a reference. A side question leaves the parent's own run untouched either way.
 */
export const ForkThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		mode: z.enum(["fork", "side"]),
		text: z.string().trim().min(1).max(4000),
		/** Fork from a response: the response it starts from, as a quote (#1101 sheet §2). */
		quotes: z.array(QuoteSchema).max(MAX_QUOTES_PER_MESSAGE).optional(),
	}),
);
export const ForkThreadResponseSchema = /* @__PURE__ */ lazySchema(
	() => StartThreadResponseSchema,
);

/** `POST /threads/statuses`: the closed-set status of each named thread, for every surface (#1101 category 2). */
export const ThreadStatusesInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		ids: z.array(z.string().uuid()).min(1).max(200),
	}),
);
export const ThreadStatusesSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		statuses: z.record(z.string(), ThreadStatusInfoSchema),
	}),
);
export type ThreadStatuses = z.infer<typeof ThreadStatusesSchema>;

/** Every open ask across threads, for the list's rows (#1101 category 8). */
export const ThreadAsksSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		asks: z.array(
			z.object({
				ask: PendingAskSchema,
				/** The run that opened it ended: only a durable tool ask stays answerable. */
				ended: z.boolean(),
				/** The thread's access level when the ask opened, for the card's mode line. */
				accessLevel: AccessLevelSchema.nullable(),
			}),
		),
	}),
);
export type ThreadAsks = z.infer<typeof ThreadAsksSchema>;

/** A thread title: one line of plain text (#1020). */
export const THREAD_TITLE_MAX = 80;

export const RenameThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		title: z.string().trim().min(1).max(THREAD_TITLE_MAX),
	}),
);

export const ThreadSettingsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** A thread with no incident settles after this many quiet days. */
		settleAfterDays: z.number().int().min(1).max(90),
		/** Where a new local repo's threads start working; absent is a new worktree (#1024). */
		newThreadsWorkIn: WorkInSchema.optional(),
	}),
);
export type ThreadSettings = z.infer<typeof ThreadSettingsSchema>;
export const DEFAULT_SETTLE_AFTER_DAYS = 3;

export const UploadDraftAttachmentSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		draftKey: z.string().uuid(),
		file: z.file(),
	}),
);

export const UploadThreadAttachmentSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		file: z.file(),
	}),
);
