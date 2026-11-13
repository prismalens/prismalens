// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How a thread's one status reads (#1101 category 2): a word, a shape and a colour,
 * and the reason line under it. Agent text stays plain strings for text nodes.
 */
import {
	isNeedsYou,
	isWorkflowLive,
	type ThreadRow,
	type ThreadStatus,
	type ThreadStatusInfo,
	type WaitingOn,
} from "@prismalens/contracts";
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
import { relTime, spanWord } from "@/components/kit/rel-time";
import type { StateTone } from "@/components/shared/StateWord";
import { stopRowWords } from "@/lib/provider-stop";
import { failureWords } from "./failure-words";

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

/** The row's slot word: the shortest in the closed set; null where the icon says it (Done). */
export const STATUS_SHORT: Record<ThreadStatus, string | null> = {
	approval: "Approve",
	question: "Answer",
	blocked: "Blocked",
	failed: "Failed",
	limited: "Limited",
	working: "Working",
	waiting: "Waiting",
	done: null,
};

/** The icon's tint (sheet §9.1, §10): warn for needs-you and Limited, danger for failed; words stay neutral. */
export const STATUS_TONE: Record<ThreadStatus, StateTone> = {
	approval: "warn",
	question: "warn",
	blocked: "danger",
	failed: "danger",
	limited: "warn",
	working: "accent",
	waiting: "quiet",
	done: "quiet",
};

/** Statuses whose word reads at full strength: they need you or broke. */
export const STATUS_LOUD: ReadonlySet<ThreadStatus> = new Set<ThreadStatus>([
	"approval",
	"question",
	"blocked",
	"failed",
]);

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
	if (t.status === "cancelled") return { status: "done", stopped: true };
	return { status: "done" };
}

const clock = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});
const formatClock = (at: string) => clock.format(new Date(at));

/** cronstrue loads on the first cron wait shown, off every page's first paint; until then the raw schedule. */
let cronstrue: typeof import("cronstrue").default | null = null;
export const loadCronWords = () =>
	import("cronstrue").then((m) => {
		cronstrue = m.default;
	});
function cronWords(schedule: string): string {
	if (!cronstrue) void loadCronWords();
	try {
		if (cronstrue)
			return cronstrue.toString(schedule, { use24HourTimeFormat: false });
	} catch {
		// An expression cronstrue cannot read.
	}
	return `Cron ${schedule}`;
}

/** "Waiting on thread Fix 502s", "Watching PR #331 checks", "Every 30 minutes, next 2:10 PM", "Wake at 3:40 PM". */
export function waitingLine(
	w: WaitingOn,
	at: (iso: string) => string = formatClock,
): string {
	switch (w.kind) {
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
			return `Wakes ${at(w.at)}`;
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
			// A row shows the failure in words, never the raw error (#1101).
			return t.error?.trim()
				? failureWords(t.error).what.replace(/\.$/, "")
				: "Run failed";
		case "done":
			return info.stopped ? "Stopped by you" : null;
	}
}

/** A thread that needs you now: asks, stops, and a failure not yet seen. */
export function needsYouNow(t: ThreadRow, info = statusOf(t)): boolean {
	return isNeedsYou(info.status) && (info.status !== "failed" || t.unseen);
}

/** How long a running thread has worked: "<1m", "12m", "1h 11m". */
export function elapsedWord(ms: number): string {
	return spanWord(ms);
}

/** A row's age in the kit's one relative format. */
export function ageWord(at: number, now: number): string {
	return relTime(at, now);
}

/** A run's own status before the server's status arrives: the same closed set, never "Stopped". */
export function runStatusInfo(status: string): ThreadStatusInfo {
	if (status === "pending" || status === "running")
		return { status: "working" };
	if (status === "failed") return { status: "failed" };
	return status === "cancelled"
		? { status: "done", stopped: true }
		: { status: "done" };
}

/** The reason a status carries from its info alone, for surfaces with no list row (the header, the roster). */
export function infoReason(info: ThreadStatusInfo, now: number): string | null {
	if (info.status === "working" && info.quietSince && now)
		return `Working, quiet for ${quietMinutes(info.quietSince, now)} min`;
	if (info.status === "waiting" && info.waitingOn)
		return waitingLine(info.waitingOn);
	if (info.status === "blocked" && info.paused)
		return "Automatic updates paused";
	if ((info.status === "blocked" || info.status === "limited") && info.mode)
		return stopRowWords({ mode: info.mode, resetsAt: null }).detail;
	if (info.status === "done" && info.stopped) return "Stopped by you";
	return null;
}
