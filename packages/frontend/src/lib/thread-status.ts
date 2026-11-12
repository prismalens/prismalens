// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How a thread's one status reads (#1101 category 2): a word, a shape and a colour,
 * and the reason line under it. Agent text stays plain strings for text nodes.
 */
import {
	bucketOf,
	isNeedsYou,
	isWorkflowLive,
	rollUp,
	THREAD_STATUSES,
	type ThreadRow,
	type ThreadStatus,
	type ThreadStatusInfo,
	type WaitingOn,
} from "@prismalens/contracts";
import cronstrue from "cronstrue";
import {
	Ban,
	CircleCheck,
	CircleHelp,
	Clock3,
	Hourglass,
	type LucideIcon,
	ShieldAlert,
	TriangleAlert,
} from "lucide-react";
import type { StateTone } from "@/components/shared/StateWord";
import { stopRowWords } from "@/lib/provider-stop";

export const STATUS_WORD: Record<ThreadStatus, string> = {
	approval: "Approval needed",
	question: "Question",
	blocked: "Blocked",
	failed: "Failed",
	limited: "Limited",
	working: "Working",
	waiting: "Waiting",
	done: "Done",
};

/** Short words for a roll-up count: "2 need you, 5 working". */
const COUNT_WORD: Record<ReturnType<typeof bucketOf>, string> = {
	needs: "need you",
	working: "working",
	waiting: "waiting",
	done: "done",
};

export const STATUS_TONE: Record<ThreadStatus, StateTone> = {
	approval: "warn",
	question: "warn",
	blocked: "danger",
	failed: "danger",
	limited: "warn",
	working: "live",
	waiting: "neutral",
	done: "ok",
};

/** Working draws the ring (`shared/Ring`); every other status has its own shape. */
export const STATUS_SHAPE: Record<
	Exclude<ThreadStatus, "working">,
	LucideIcon
> = {
	approval: ShieldAlert,
	question: CircleHelp,
	blocked: Ban,
	failed: TriangleAlert,
	limited: Clock3,
	waiting: Hourglass,
	done: CircleCheck,
};

export const TONE_TEXT: Record<StateTone, string> = {
	danger: "text-danger",
	warn: "text-warn",
	ok: "text-ok",
	live: "text-live",
	accent: "text-accent",
	neutral: "text-text-2",
	quiet: "text-text-3",
	"sev-high": "text-sev-high",
	"sev-low": "text-sev-low",
	critical: "text-danger",
	high: "text-sev-high",
	medium: "text-warn",
	low: "text-sev-low",
	info: "text-text-3",
	stale: "text-warn",
	active: "text-live",
	done: "text-ok",
	failed: "text-danger",
};

/**
 * A row's status: the server's, or, for a row from before it sent one, read from
 * the fields every row has.
 */
export function statusOf(t: ThreadRow): ThreadStatusInfo {
	if (t.state) return t.state;
	const live = isWorkflowLive(t.status);
	if (t.waitingAsk)
		return {
			status: t.waitingAsk.kind === "permission" ? "approval" : "question",
		};
	if (live && t.awaitingApprovalAt) return { status: "approval" };
	if (t.limit) {
		const words = stopRowWords(t.limit);
		return {
			status: words.state,
			...(t.limit.mode ? { mode: t.limit.mode } : {}),
		};
	}
	if (t.paused) return { status: "blocked", paused: true };
	if (live) return { status: "working" };
	if (t.status === "failed") return { status: "failed" };
	return { status: "done" };
}

const clock = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});
const formatClock = (at: string) => clock.format(new Date(at));

function cronWords(schedule: string): string {
	try {
		return cronstrue.toString(schedule, { use24HourTimeFormat: false });
	} catch {
		return `Cron ${schedule}`;
	}
}

/** "Waiting on thread Fix 502s", "Watching PR #331 checks", "Every 30 minutes, next 2:10 PM", "Wake at 3:40 PM". */
export function waitingLine(
	w: WaitingOn,
	at: (iso: string) => string = formatClock,
): string {
	switch (w.kind) {
		case "thread": {
			const name = w.title?.trim() || "another thread";
			return w.more > 0
				? `Waiting on ${name} and ${w.more} more`
				: `Waiting on ${name}`;
		}
		case "pr": {
			const pr = w.number === null ? "a PR" : `PR #${w.number}`;
			return w.until === "merged"
				? `Watching ${pr} until merged`
				: w.until === "review"
					? `Watching ${pr} for review`
					: `Watching ${pr} checks`;
		}
		case "cron":
			return w.nextAt
				? `${cronWords(w.schedule)}, next ${at(w.nextAt)}`
				: cronWords(w.schedule);
		case "wake":
			return `Wake at ${at(w.at)}`;
	}
}

/** Minutes since a stalled Working run's last event, rounded down, at least 1. */
export function quietMinutes(since: string, now: number): number {
	return Math.max(1, Math.floor((now - Date.parse(since)) / 60_000));
}

/**
 * The reason a status carries, in one short line; null when the status says it all.
 * Working with no quiet time leaves the line to the agent's live step.
 */
export function statusReason(
	t: ThreadRow,
	info: ThreadStatusInfo,
	now: number,
	at: (iso: string) => string = formatClock,
): string | null {
	switch (info.status) {
		case "approval":
		case "question":
			return t.waitingAsk?.title ?? null;
		case "blocked":
			if (info.paused) {
				const why =
					t.paused?.reason === "loop_guard" ? "loop guard" : "daily ceiling";
				return `Automatic updates paused: ${why}`;
			}
			return t.limit ? stopRowWords(t.limit, at).detail : null;
		case "limited":
			return t.limit ? stopRowWords(t.limit, at).detail : null;
		case "working":
			return info.quietSince && now
				? `Working, quiet for ${quietMinutes(info.quietSince, now)} min`
				: null;
		case "waiting":
			return info.waitingOn ? waitingLine(info.waitingOn, at) : null;
		case "failed":
			return t.error?.trim() || "Run failed";
		case "done":
			return null;
	}
}

/** A thread that needs you now: asks, stops, and a failure not yet seen. */
export function needsYouNow(t: ThreadRow, info = statusOf(t)): boolean {
	return isNeedsYou(info.status) && (info.status !== "failed" || t.unseen);
}

/** The roll-up line for a parent and its children: "2 need you, 5 working, 1 waiting". */
export function rollUpLine(statuses: readonly ThreadStatus[]): string {
	const { counts } = rollUp(statuses);
	const buckets = new Map<ReturnType<typeof bucketOf>, number>();
	for (const s of THREAD_STATUSES) {
		const n = counts[s];
		if (!n) continue;
		const b = bucketOf(s);
		buckets.set(b, (buckets.get(b) ?? 0) + n);
	}
	return (["needs", "working", "waiting", "done"] as const)
		.filter((b) => buckets.get(b))
		.map((b) => `${buckets.get(b)} ${COUNT_WORD[b]}`)
		.join(", ");
}

/** A row's age in one short word: "now", "5m", "3h", "2d". */
export function ageWord(at: number, now: number): string {
	const min = Math.floor((now - at) / 60_000);
	if (min < 1) return "now";
	if (min < 60) return `${min}m`;
	const h = Math.floor(min / 60);
	return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
