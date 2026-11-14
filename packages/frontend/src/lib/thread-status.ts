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
import { relTime, spanWord } from "@/components/kit/rel-time";
import { stopRowWords } from "@/lib/provider-stop";
import { stopCause } from "@/lib/stop-causes";
import { failureWords } from "./failure-words";

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
				const why = stopCause(t.paused?.reason ?? "ceiling");
				return `${why.head}: ${why.name}`;
			}
			if (info.host) return stopCause(info.host).name;
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
		case "interrupted":
			return "PrismaLens restarted mid-run";
		case "done":
			return info.stopped ? "Stopped by you" : null;
	}
}

/**
 * A status still reading an ask this device answered reads Working until the server
 * re-reads it, unless another ask of the thread still waits (#1101 categories 2, 8).
 */
export function afterAnswers(
	threadId: string,
	info: ThreadStatusInfo,
	answered: readonly { threadId: string; askId: string }[],
	openAskIds: readonly string[] = [],
): ThreadStatusInfo {
	if (info.status !== "approval" && info.status !== "question") return info;
	const mine = new Set(
		answered.filter((a) => a.threadId === threadId).map((a) => a.askId),
	);
	if (!mine.size || openAskIds.some((id) => !mine.has(id))) return info;
	return { status: "working" };
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
export function runStatusInfo(
	status: string,
	endReason?: string | null,
): ThreadStatusInfo {
	if (status === "pending" || status === "running")
		return { status: "working" };
	// A restart or a stop is not a fault: each reads as its thread's row does.
	if (status === "failed")
		return {
			status:
				endReason === "interrupted"
					? "interrupted"
					: endReason === "limited"
						? "limited"
						: endReason === "blocked" || endReason === "disk_full"
							? "blocked"
							: "failed",
		};
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
		return stopCause("ceiling").head;
	if (info.status === "blocked" && info.host) return stopCause(info.host).name;
	if ((info.status === "blocked" || info.status === "limited") && info.mode)
		return stopRowWords({ mode: info.mode, resetsAt: null }).detail;
	if (info.status === "done" && info.stopped) return "Stopped by you";
	return null;
}
