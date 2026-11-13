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

/** Host conditions that stop a thread before its agent starts; each reads Blocked (#1101). */
export const HOST_STOPS = ["disk_full"] as const;
export const HostStopSchema = z.enum(HOST_STOPS);
export type HostStop = z.infer<typeof HostStopSchema>;
/** The reason line each host stop reads under Blocked. */
export const HOST_STOP_WORDS: Readonly<Record<HostStop, string>> = {
	disk_full: "No disk space left for its worktree",
};

/** What a Waiting thread waits on (#1101 category 2 item 3). */
export const WaitingOnSchema = z.discriminatedUnion("kind", [
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
	/** Blocked by the host, not the provider: no disk left for the worktree. */
	host: HostStopSchema.optional(),
	/** Done because you stopped its turn: reads "Stopped by you". */
	stopped: z.boolean().optional(),
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
	/** The run stopped on the host before its agent started. */
	host?: HostStop | null;
	lastEventAt: Date;
	/** The last turn was stopped by the user, or the run was cancelled. */
	stopped?: boolean;
	waitingOn: WaitingOn | null;
	/** The user answered an ask and the agent has not taken the answer up yet. */
	pickup?: boolean;
}

/** How long an answer reads Working before the agent takes it up; past it, the thread reads as it is. */
export const PICKUP_MS = 2 * 60_000;

/** The thread's one status from its facts (#1101 category 2). */
export function threadStatus(f: StatusFacts, now: Date): ThreadStatusInfo {
	if (f.askKind === "permission") return { status: "approval" };
	if (f.askKind) return { status: "question" };
	if (f.stop?.blocked)
		return { status: "blocked", ...(f.stop.mode ? { mode: f.stop.mode } : {}) };
	if (f.host && !f.live) return { status: "blocked", host: f.host };
	if (f.paused) return { status: "blocked", paused: true };
	if (f.live || f.pickup) {
		const quiet =
			f.live && now.getTime() - f.lastEventAt.getTime() >= STALL_AFTER_MS;
		return {
			status: "working",
			...(quiet ? { quietSince: f.lastEventAt.toISOString() } : {}),
		};
	}
	if (f.stop)
		return { status: "limited", ...(f.stop.mode ? { mode: f.stop.mode } : {}) };
	if (f.failed) return { status: "failed" };
	// Stopping a turn is Done, never a status of its own (#1101 category 2).
	if (f.stopped) return { status: "done", stopped: true };
	if (f.waitingOn) return { status: "waiting", waitingOn: f.waitingOn };
	return { status: "done" };
}
