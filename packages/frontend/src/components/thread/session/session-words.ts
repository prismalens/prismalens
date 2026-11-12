// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { COLD_RESUME_TOKENS, type ThreadSession } from "@prismalens/contracts";
import { formatClock } from "@/lib/format-time";

export type MeterTone = "neutral" | "warn" | "danger";

/** Distance before the agent's own compaction point where the meter starts to warn (#1101). */
const WARN_BEFORE_AUTO = 10;

/**
 * Warning from 10 points before the agent compacts by itself, danger from that point.
 * Without a known point: warning from 70 to 90 percent, danger above 90.
 */
export function meterTone(percent: number, autoAt?: number | null): MeterTone {
	if (autoAt) {
		if (percent >= autoAt) return "danger";
		if (percent >= autoAt - WARN_BEFORE_AUTO) return "warn";
		return "neutral";
	}
	if (percent > 90) return "danger";
	if (percent >= 70) return "warn";
	return "neutral";
}

export function meterPercent(used: number, size: number): number {
	if (size <= 0) return 0;
	return Math.min(100, Math.round((used / size) * 100));
}

/** `950`, `18k`, `142k`, `1.2M`. */
export function tokenCount(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	const m = n / 1_000_000;
	return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/** `142k of 200k`. */
export function meterLine(used: number, size: number): string {
	return `${tokenCount(used)} of ${tokenCount(size)}`;
}

/** The cache state in words, or null when it is unknown (never shown as "unknown"). */
export function cacheWord(cache: ThreadSession["cache"]): string | null {
	if (cache === "warm") return "Cache warm";
	if (cache === "cold") return "Cache cold";
	return null;
}

/** An unknown cache counts as cold after this long idle; mirrors `UNKNOWN_IDLE_MS` in the API's `wakes/session.ts`. */
const UNKNOWN_IDLE_MS = 60 * 60_000;

/** Whether sending should first offer the cold-conversation choices; the API's `needsResumePrompt`. */
export function needsColdPrompt(
	session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt">,
	now: Date,
): boolean {
	if ((session.contextTokens ?? 0) < COLD_RESUME_TOKENS) return false;
	if (session.cache === "cold") return true;
	return (
		session.cache === "unknown" &&
		now.getTime() - Date.parse(session.lastActivityAt) >= UNKNOWN_IDLE_MS
	);
}

export type ThreadLimit = NonNullable<ThreadSession["limit"]> & {
	/** The policy's retry cap; Surface F adds it to the contract (#1024). */
	maxAttempts?: number;
};

export type LimitState = "resuming" | "retrying" | "off" | "gaveUp";

export function limitState(limit: ThreadLimit): LimitState {
	if (limit.gaveUp) return "gaveUp";
	if (!limit.autoResume) return "off";
	return limit.resetsAt ? "resuming" : "retrying";
}

/** Tries actually made: a gave-up limit counts the attempt it skipped. */
export function triesMade(limit: ThreadLimit): number {
	return limit.gaveUp ? Math.max(0, limit.attempts - 1) : limit.attempts;
}

/** The dock's line, from the limit's own fields only. */
export function limitLine(
	limit: ThreadLimit,
	clock: (at: string) => string = formatClock,
): string {
	switch (limitState(limit)) {
		case "gaveUp": {
			const n = triesMade(limit);
			return `Stopped trying after ${n} ${n === 1 ? "try" : "tries"}`;
		}
		case "off":
			return limit.resetsAt
				? `Usage limit reached · resets ${clock(limit.resetsAt)}`
				: "Usage limit reached · reset time unknown";
		case "resuming":
			return `Usage limit reached · resumes ${clock(limit.nextAttemptAt ?? (limit.resetsAt as string))}`;
		case "retrying": {
			const count = limit.maxAttempts
				? `${limit.attempts} of ${limit.maxAttempts}`
				: `try ${limit.attempts}`;
			return limit.nextAttemptAt
				? `Usage limit reached · trying again at ${clock(limit.nextAttemptAt)} (${count})`
				: `Usage limit reached · (${count})`;
		}
	}
}

/** `12:04` until a time, for the live countdown; null once it has passed. */
export function countdown(to: string, now: number): string | null {
	const s = Math.round((Date.parse(to) - now) / 1000);
	if (!(s > 0)) return null;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const COMPACTION_METHOD_HINT = {
	agent_command: "Agent command",
	summary: "Summary",
	agent_auto: "By the agent",
} as const;

/** A compaction node's line: started, completed with sizes, or failed. */
export function compactionLine(e: {
	phase: "started" | "completed" | "failed";
	before?: number;
	after?: number;
}): string {
	if (e.phase === "started") return "Compacting";
	if (e.phase === "failed") return "Compaction failed";
	return e.before !== undefined && e.after !== undefined
		? `Compacted · ${tokenCount(e.before)} to ${tokenCount(e.after)} tokens`
		: "Compacted";
}
