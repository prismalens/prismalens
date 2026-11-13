// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Attention (#1101 categories 3 and 4): what happened to threads while the operator
 * was not watching, where they have read each thread to, and how they want to hear.
 * Read state belongs to the one local operator, not to a device.
 */
import { z } from "zod";
import { DateStringSchema, SeveritySchema } from "./common.js";
import { ThreadStatusSchema } from "./thread-status.js";

/** What happened: a thread newly needs you, finished, failed, hit a limit, got blocked, or a trigger started it. */
export const ATTENTION_KINDS = [
	"needs_you",
	"limited",
	"blocked",
	"failed",
	"finished",
	"started",
] as const;
export const AttentionKindSchema = z.enum(ATTENTION_KINDS);
export type AttentionKind = z.infer<typeof AttentionKindSchema>;

/** The three event groups the Notifications page lets the operator choose. */
export type AttentionGroup = "needs_you" | "finished" | "failed";

export function attentionGroup(kind: AttentionKind): AttentionGroup | null {
	if (kind === "needs_you" || kind === "limited" || kind === "blocked")
		return "needs_you";
	if (kind === "failed") return "failed";
	if (kind === "finished") return "finished";
	return null;
}

export const AttentionThreadSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	kind: z.string(),
	/** The thread whose agent started it: a started thread's ask names its starter (#1101 cat 8). */
	startedBy: z
		.object({ id: z.string(), title: z.string().nullable() })
		.nullable(),
	incident: z
		.object({
			id: z.string(),
			number: z.number().int().nullable(),
			severity: SeveritySchema,
		})
		.nullable(),
	/** An incident's handover: the report's cause and its first next command. */
	cause: z.string().nullable(),
	nextCommand: z.string().nullable(),
	/** The agent's last sentence, else the run's summary: a chat's answer. */
	answer: z.string().nullable(),
	/** A failed run's recorded error and why it ended, for the card's cause in words. */
	error: z.string().nullable(),
	endReason: z.string().nullable(),
	status: ThreadStatusSchema.nullable(),
	follow: z.enum(["watch", "mute"]).nullable(),
});
export type AttentionThread = z.infer<typeof AttentionThreadSchema>;

export const AttentionEventSchema = z.object({
	id: z.string(),
	threadId: z.string(),
	kind: AttentionKindSchema,
	/** The ask, the limit's reset line, the failure, or the trigger. */
	detail: z.string().nullable(),
	/** A limit's reset time, when it has one. */
	resetsAt: DateStringSchema.nullable(),
	at: DateStringSchema,
	readAt: DateStringSchema.nullable(),
	/** The rules let it raise a notification (follow, mute, roll-up). */
	notify: z.boolean(),
	/** The operator was viewing the thread on some device when it happened. */
	silenced: z.boolean(),
	thread: AttentionThreadSchema,
});
export type AttentionEvent = z.infer<typeof AttentionEventSchema>;

export const AttentionEventsInputSchema = z.object({
	filter: z.enum(["unread", "all"]).default("unread"),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AttentionEventsInput = z.infer<typeof AttentionEventsInputSchema>;

export const AttentionEventsSchema = z.object({
	events: z.array(AttentionEventSchema),
	unread: z.number().int().nonnegative(),
});
export type AttentionEvents = z.infer<typeof AttentionEventsSchema>;

/** Home's away view: unread changes grouped by thread, newest first. */
export const AwayViewSchema = z.object({
	/** When the operator was last here before this visit; null when never away. */
	since: DateStringSchema.nullable(),
	/** The gap was long enough for a card per thread. */
	long: z.boolean(),
	groups: z.array(
		z.object({
			root: AttentionThreadSchema,
			/** The group's one thread and its newest unread events; started threads never roll up (#1101 cat 3). */
			threads: z.array(
				z.object({
					thread: AttentionThreadSchema,
					events: z.array(AttentionEventSchema),
				}),
			),
		}),
	),
});
export type AwayView = z.infer<typeof AwayViewSchema>;

export const ThreadReadSchema = z.object({
	/** Where the operator read to; null when never opened. */
	readAt: DateStringSchema.nullable(),
	/** The first event after it worth landing on, or null when nothing is unseen. */
	firstUnseen: z.string().nullable(),
	/** Messages after the read position. */
	newCount: z.number().int().nonnegative(),
});
export type ThreadRead = z.infer<typeof ThreadReadSchema>;

export const MarkThreadReadInputSchema = z.object({
	id: z.string().uuid(),
	/** The last event key shown on screen in a visible tab. */
	key: z.string().min(1).max(200),
});

export const PresenceInputSchema = z.object({
	/** The thread on screen in this visible tab, or null for any other page. */
	threadId: z.string().uuid().nullable(),
	/** False drops this device's lease (the tab went hidden or closed). */
	visible: z.boolean(),
});

export const PresenceSchema = z.object({
	/** How long the lease holds without a renewal. */
	ttlMs: z.number().int(),
});

export const NOTIFY_MODES = ["off", "notifications", "sound", "both"] as const;
export const NotifyModeSchema = z.enum(NOTIFY_MODES);
export type NotifyMode = z.infer<typeof NotifyModeSchema>;

export const NotifyPrefsSchema = z.object({
	mode: NotifyModeSchema,
	events: z.object({
		needsYou: z.boolean(),
		finished: z.boolean(),
		failed: z.boolean(),
	}),
	when: z.enum(["unfocused", "always"]),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
	mode: "notifications",
	events: { needsYou: true, finished: true, failed: true },
	when: "unfocused",
};

export const FollowInputSchema = z.object({
	id: z.string().uuid(),
	/** watch: notify when it finishes; mute: never notify; null: the defaults. */
	follow: z.enum(["watch", "mute"]).nullable(),
});
