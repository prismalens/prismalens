// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One status per thread from a closed set (#1101 category 2), with its reason.
 * Needs-you states outrank Working, Working outranks Waiting, Waiting outranks Done,
 * so a parent waiting on its children never hides a child that needs you.
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";
import { FailureModeSchema } from "./provider-failure.js";

/** In rank order: the first that holds is the thread's status. */
export const THREAD_STATUSES = [
	"approval",
	"question",
	"blocked",
	"failed",
	"limited",
	"working",
	"waiting",
	"done",
] as const;
export const ThreadStatusSchema = z.enum(THREAD_STATUSES);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

/** The states that put a thread on top of the list. */
export const NEEDS_YOU_STATUSES = [
	"approval",
	"question",
	"blocked",
	"failed",
	"limited",
] as const satisfies readonly ThreadStatus[];

export function isNeedsYou(s: ThreadStatus | null | undefined): boolean {
	return (NEEDS_YOU_STATUSES as readonly string[]).includes(s ?? "");
}

/** The operator's three buckets for every status that does not need them. */
export function bucketOf(
	s: ThreadStatus,
): "needs" | "working" | "waiting" | "done" {
	if (isNeedsYou(s)) return "needs";
	return s === "working" ? "working" : s === "waiting" ? "waiting" : "done";
}

/** What a Waiting thread waits on (#1101 category 2 item 3). */
export const WaitingOnSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("thread"),
		id: z.string(),
		title: z.string().nullable(),
		/** More threads it waits on beside this one. */
		more: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("pr"),
		number: z.number().int().nullable(),
		until: z.enum(["checks_done", "review", "merged"]),
	}),
	z.object({
		kind: z.literal("cron"),
		/** Five-field cron, host local time. */
		schedule: z.string(),
		nextAt: DateStringSchema.nullable(),
	}),
	z.object({ kind: z.literal("wake"), at: DateStringSchema }),
]);
export type WaitingOn = z.infer<typeof WaitingOnSchema>;

export const ThreadStatusInfoSchema = z.object({
	status: ThreadStatusSchema,
	/** Waiting only: the nearest thing it waits on. */
	waitingOn: WaitingOnSchema.optional(),
	/** Working only: the last event is older than the stall threshold. */
	quietSince: DateStringSchema.optional(),
	/** Blocked or Limited: the provider stop behind it. */
	mode: FailureModeSchema.optional(),
	/** Blocked by paused automatic updates, not a provider stop. */
	paused: z.boolean().optional(),
});
export type ThreadStatusInfo = z.infer<typeof ThreadStatusInfoSchema>;

/** A Working thread with no event for this long reads "Working, quiet for N min". */
export const STALL_AFTER_MS = 5 * 60_000;

export const STATUS_RANK: Record<ThreadStatus, number> = Object.fromEntries(
	THREAD_STATUSES.map((s, i) => [s, i]),
) as Record<ThreadStatus, number>;

/** The facts one status is read from; every field is the thread's own. */
export interface StatusFacts {
	live: boolean;
	/** The newest open ask's kind, durable tool asks included. */
	askKind: "permission" | "question" | "input" | "secret" | null;
	/** Workflow status: failed with no provider stop reads Failed. */
	failed: boolean;
	/** A provider stop: Blocked when `blocked`, else Limited. */
	stop: { blocked: boolean; mode?: z.infer<typeof FailureModeSchema> } | null;
	paused: boolean;
	lastEventAt: Date;
	waitingOn: WaitingOn | null;
}

/** The thread's one status from its facts (#1101 category 2). */
export function threadStatus(f: StatusFacts, now: Date): ThreadStatusInfo {
	if (f.askKind === "permission") return { status: "approval" };
	if (f.askKind) return { status: "question" };
	if (f.stop?.blocked)
		return { status: "blocked", ...(f.stop.mode ? { mode: f.stop.mode } : {}) };
	if (f.paused) return { status: "blocked", paused: true };
	if (f.live) {
		const quiet = now.getTime() - f.lastEventAt.getTime() >= STALL_AFTER_MS;
		return {
			status: "working",
			...(quiet ? { quietSince: f.lastEventAt.toISOString() } : {}),
		};
	}
	if (f.stop)
		return { status: "limited", ...(f.stop.mode ? { mode: f.stop.mode } : {}) };
	if (f.failed) return { status: "failed" };
	if (f.waitingOn) return { status: "waiting", waitingOn: f.waitingOn };
	return { status: "done" };
}

/** A parent's mark over itself and its children: the best-ranked status, with a count of each. */
export function rollUp(statuses: readonly ThreadStatus[]): {
	top: ThreadStatus | null;
	counts: Partial<Record<ThreadStatus, number>>;
} {
	const counts: Partial<Record<ThreadStatus, number>> = {};
	let top: ThreadStatus | null = null;
	for (const s of statuses) {
		counts[s] = (counts[s] ?? 0) + 1;
		if (top === null || STATUS_RANK[s] < STATUS_RANK[top]) top = s;
	}
	return { top, counts };
}
