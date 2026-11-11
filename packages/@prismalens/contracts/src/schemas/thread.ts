// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads on a project, a service, or nothing at all (#1020): a chat that is not
 * an incident's. Incident and schedule threads keep their own routes.
 */
import { z } from "zod";
import { AskKindSchema } from "./asks.js";
import {
	CoerceDateSchema,
	DateStringSchema,
	IncidentStatusSchema,
	SeveritySchema,
} from "./common.js";
import { MessageContextShape } from "./composer.js";
import {
	AttachmentIdsSchema,
	HelperPlaceSchema,
	InvestigationSchema,
	RunChoiceSchema,
} from "./investigation.js";
import { ThreadRowPrSchema } from "./pull-request.js";
import { WorkInSchema } from "./repository.js";
import { AccessLevelSchema } from "./settings.js";
import { INVESTIGATION_KINDS } from "./state-semantics.js";

export const ThreadStartSubjectSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("project"), repositoryId: z.string().uuid() }),
	z.object({ kind: z.literal("service"), serviceId: z.string().uuid() }),
	z.object({ kind: z.literal("none") }),
]);
export type ThreadStartSubject = z.infer<typeof ThreadStartSubjectSchema>;

/** Body of `POST /threads`: the first message starts the thread's run. */
export const StartThreadSchema = z
	.object({
		subject: ThreadStartSubjectSchema,
		text: z.string().trim().min(1).max(4000),
		accessLevel: AccessLevelSchema.optional(),
		...RunChoiceSchema.shape,
		/** Uploaded first with `POST /threads/drafts/{draftKey}/attachments`. */
		attachments: AttachmentIdsSchema.optional(),
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
	});
export type StartThreadInput = z.infer<typeof StartThreadSchema>;

export const StartThreadResponseSchema = z.object({
	investigationId: z.string().uuid(),
	jobId: z.string().nullable(),
	queued: z.boolean(),
});

export const ThreadListQuerySchema = z.object({
	repositoryId: z.string().uuid().optional(),
	serviceId: z.string().uuid().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ThreadListSchema = z.object({
	data: z.array(InvestigationSchema),
});

/** The thread list's sections, in rank order: Needs you outranks the rest. */
export const THREAD_SECTIONS = ["needs", "active", "settled"] as const;
export const ThreadSectionSchema = z.enum(THREAD_SECTIONS);
export type ThreadSection = z.infer<typeof ThreadSectionSchema>;

/** `GET /threads/feed`: every thread, any subject, paged by unit (#1020). */
export const ThreadFeedQuerySchema = z.object({
	search: z.string().trim().max(200).optional(),
	kind: z.enum(INVESTIGATION_KINDS).optional(),
	section: ThreadSectionSchema.optional(),
	repositoryId: z.string().uuid().optional(),
	/** Only threads with activity at or after this time. */
	since: CoerceDateSchema.optional(),
	/** Units to skip; a unit is one thread or one incident's block. */
	cursor: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type ThreadFeedQuery = z.infer<typeof ThreadFeedQuerySchema>;

export const ThreadIncidentChipSchema = z.object({
	id: z.string().uuid(),
	number: z.number().int(),
	title: z.string(),
	severity: SeveritySchema,
	status: IncidentStatusSchema,
});

/** A row: the run, its context names, and the plain-text line under its title. */
/**
 * Automatic PR updates and cron fires held (#1024 surface F): `ceiling` clears on
 * the user's next message; `loop_guard` only when the user watches that PR again.
 */
export const AutoPauseSchema = z.object({
	reason: z.enum(["ceiling", "loop_guard"]),
	prId: z.string().optional(),
	since: DateStringSchema,
});
export type AutoPause = z.infer<typeof AutoPauseSchema>;
/** Turns no person asked for (PR deliveries and cron fires) a thread admits per rolling day. */
export const AUTONOMOUS_TURNS_PER_DAY = 12;

export const ThreadRowSchema = InvestigationSchema.extend({
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
	/** The thread waits on its agent's usage limit (#1024 surface F); null otherwise. */
	limit: z
		.object({ resetsAt: DateStringSchema.nullable() })
		.nullable()
		.optional(),
	/** Automatic updates are paused until a person acts; the row lists under Waiting for you. */
	paused: AutoPauseSchema.nullable().optional(),
	/** Its place in a thread tree (#1024); null outside one. The sidebar indents children by it. */
	tree: z
		.object({
			rootId: z.string(),
			parentId: z.string().nullable(),
			role: z.string().nullable(),
			depth: z.number().int().min(0),
		})
		.nullable()
		.optional(),
});
export type ThreadRow = z.infer<typeof ThreadRowSchema>;

/** One thread, or every listed thread of one incident, which page as one. */
export const ThreadUnitSchema = z.object({
	section: ThreadSectionSchema,
	incident: ThreadIncidentChipSchema.nullable(),
	threads: z.array(ThreadRowSchema).min(1),
});
export type ThreadUnit = z.infer<typeof ThreadUnitSchema>;

export const ThreadFeedSchema = z.object({
	units: z.array(ThreadUnitSchema),
	nextCursor: z.number().int().nullable(),
	/** Units per section over the whole filtered list, never one page. */
	counts: z.object({
		needs: z.number().int(),
		active: z.number().int(),
		settled: z.number().int(),
	}),
});
export type ThreadFeed = z.infer<typeof ThreadFeedSchema>;

export const ThreadIdSchema = z.object({ id: z.string().uuid() });

/** Settle or unsettle; on an incident's thread it covers the incident's block. */
export const SettledStateSchema = z.object({
	id: z.string().uuid(),
	settledAt: DateStringSchema.nullable(),
});

export type SettledState = z.infer<typeof SettledStateSchema>;

export const SettleThreadSchema = z.object({
	id: z.string().uuid(),
	settled: z.boolean(),
	/** On Undo: each thread's state from Settle's `previous`, restored exactly. */
	restore: z.array(SettledStateSchema).max(10_000).optional(),
	/** Required when the block has a running run: settling stops it at once. */
	stopRunning: z.boolean().optional(),
});

/** What settling removes from one directory a thread worked in (#1024 surface F). */
export const WorktreeVerdictSchema = z.object({
	threadId: z.string().uuid(),
	dir: z.string(),
	action: z.enum(["remove", "keep"]),
	/** Why it is kept, e.g. "2 uncommitted files". */
	reason: z.string().optional(),
});
export type WorktreeVerdict = z.infer<typeof WorktreeVerdictSchema>;

/** `GET /threads/{id}/settle-preview`: what settling the block would end. */
export const SettlePreviewSchema = z.object({
	wakes: z.number().int().nonnegative(),
	watches: z.number().int().nonnegative(),
	crons: z.number().int().nonnegative(),
	children: z.number().int().nonnegative(),
	/** Running runs in the block and its descendants; non-zero needs `stopRunning`. */
	running: z.number().int().nonnegative(),
	worktrees: z.array(WorktreeVerdictSchema),
});
export type SettlePreview = z.infer<typeof SettlePreviewSchema>;

/** Settle's answer; `undoUntil` is the one Undo deadline, null on unsettle. */
export const SettleResponseSchema = z.object({
	ids: z.array(z.string()),
	previous: z.array(SettledStateSchema),
	undoUntil: DateStringSchema.nullable(),
	/** What the teardown ends once Undo's window closes; null on unsettle. */
	ended: SettlePreviewSchema.nullable(),
});
export type SettleResponse = z.infer<typeof SettleResponseSchema>;

/** How long Undo can take a settle back before its teardown ends its jobs. */
export const SETTLE_UNDO_MS = 8_000;

/** A settle refused: a running run without `stopRunning`, or Undo after `undoUntil`. */
export const SettleRefusalSchema = z.object({
	reason: z.enum(["running", "ended"]),
	running: z.number().int().nonnegative().optional(),
});

/** A thread title: one line of plain text (#1020). */
export const THREAD_TITLE_MAX = 80;

export const RenameThreadSchema = z.object({
	id: z.string().uuid(),
	title: z.string().trim().min(1).max(THREAD_TITLE_MAX),
});

export const ThreadSettingsSchema = z.object({
	/** A thread with no incident settles after this many quiet days. */
	settleAfterDays: z.number().int().min(1).max(90),
	/** Where a new local repo's threads start working; absent is a new worktree (#1024). */
	newThreadsWorkIn: WorkInSchema.optional(),
});
export type ThreadSettings = z.infer<typeof ThreadSettingsSchema>;
export const DEFAULT_SETTLE_AFTER_DAYS = 3;

export const UploadDraftAttachmentSchema = z.object({
	draftKey: z.string().uuid(),
	file: z.file(),
});

export const UploadThreadAttachmentSchema = z.object({
	id: z.string().uuid(),
	file: z.file(),
});
