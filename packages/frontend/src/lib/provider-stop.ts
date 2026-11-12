// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	agentName,
	type CanonicalEvent,
	type FailureMode,
	isBlockedMode,
	type LimitWindow,
	type ThreadSession,
} from "@prismalens/contracts";
import { formatClock } from "./format-time";

/**
 * One vocabulary for a turn its provider stopped (#1101 categories 17 and 23):
 * the dock's line and what happens next, the row's words and the rail's hover
 * name. Every line names the cause; none shows a raw code.
 */
export type ThreadStop = NonNullable<ThreadSession["limit"]>;

export function stopMode(limit: Pick<ThreadStop, "mode">): FailureMode {
	return limit.mode ?? "usage_limit";
}

const WINDOW_WORD: Record<LimitWindow, string> = {
	session: "Session limit",
	daily: "Daily limit",
	weekly: "Weekly limit",
	monthly: "Monthly limit",
	model: "Model limit",
};

/** "Weekly limit", or "Usage limit" when the agent did not say which. */
export function limitName(window: LimitWindow | undefined): string {
	return window ? WINDOW_WORD[window] : "Usage limit";
}

/** "30 s", "2 min", "1 h 5 min": a short wait in words. */
export function waitWords(ms: number): string {
	const s = Math.max(1, Math.round(ms / 1000));
	if (s < 60) return `${s} s`;
	const min = Math.round(s / 60);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** The agent's registry name, never its stored id or lower-case label. */
const cap = agentName;

/** The blocked modes' cause, in the thread's words. */
export function blockedLine(mode: FailureMode, agent: string): string {
	if (mode === "out_of_credit")
		return `${cap(agent)} is out of credit on its API account`;
	if (mode === "key_rejected") return `${cap(agent)}'s API key was rejected`;
	return "Your organization's spend cap was reached";
}

/** "try 2 of 5": the try a pending wake makes, of the most it makes. */
function tryCount(limit: ThreadStop): string | null {
	if (!limit.maxAttempts) return null;
	// A usage limit counts its retries; a provider retry counts its tries, the first included.
	const usage = stopMode(limit) === "usage_limit";
	const n = usage ? limit.attempts + 1 : limit.attempts;
	const of = usage ? limit.maxAttempts + 1 : limit.maxAttempts;
	return `try ${Math.min(n, of)} of ${of}`;
}

/** The dock's first line: which stop, and when it resumes in local time. */
export function stopLine(
	limit: ThreadStop,
	opts: { clock?: (at: string) => string; now?: number } = {},
): string {
	const clock = opts.clock ?? formatClock;
	const mode = stopMode(limit);
	const agent = limit.agent ?? "the agent";
	if (isBlockedMode(mode)) return blockedLine(mode, agent);
	const tries = tryCount(limit);
	const next = limit.autoResume ? limit.nextAttemptAt : undefined;
	if (mode === "rate_limited") {
		if (limit.gaveUp)
			return `Rate limited · stopped after ${limit.attempts - 1} tries`;
		if (!next) return "Rate limited · not trying again by itself";
		return `Rate limited · trying again at ${clock(next)}${tries ? ` (${tries})` : ""}`;
	}
	if (mode === "overloaded") {
		if (limit.gaveUp)
			return `Provider busy · stopped after ${limit.attempts - 1} tries`;
		if (!next) return "Provider busy · not retrying by itself";
		const left = Date.parse(next) - (opts.now ?? Date.now());
		return `Provider busy · retrying ${left > 0 ? `in ${waitWords(left)}` : "now"}${tries ? ` (${tries})` : ""}`;
	}
	const name = `${limitName(limit.window)} reached`;
	if (limit.gaveUp) {
		const n = Math.max(0, limit.attempts - 1);
		return `${name} · stopped trying after ${n} ${n === 1 ? "try" : "tries"}`;
	}
	if (!limit.autoResume)
		return limit.resetsAt
			? `${name} · resets ${clock(limit.resetsAt)}`
			: `${name} · reset time unknown`;
	if (limit.resetsAt)
		return `${name} · resumes ${clock(limit.nextAttemptAt ?? limit.resetsAt)}`;
	return next
		? `${name} · reset time unknown, trying again at ${clock(next)}${tries ? ` (${tries})` : ""}`
		: `${name} · reset time unknown${tries ? ` (${tries})` : ""}`;
}

/** "(2 of 5)": the try a pending wake makes, of the most it makes. */
function tryOf(limit: ThreadStop): string {
	const t = tryCount(limit);
	return t ? ` (${t.slice(4)})` : "";
}

/**
 * The strip's two parts (sheet §10): the state, bold, then one plain detail with
 * one time. "Usage limit reached" · "Resumes 13:30"; "Rate limited" · "Next try 15:45 (2 of 5)".
 */
export function stopStrip(
	limit: ThreadStop,
	opts: { clock?: (at: string) => string; now?: number } = {},
): { head: string; detail: string | null } {
	const clock = opts.clock ?? formatClock;
	const mode = stopMode(limit);
	if (mode === "out_of_credit") return { head: "Out of credit", detail: null };
	if (mode === "key_rejected")
		return { head: "API key rejected", detail: null };
	if (mode === "spend_cap") return { head: "Spend cap reached", detail: null };
	const next = limit.autoResume ? limit.nextAttemptAt : undefined;
	const stopped = () => {
		const n = Math.max(0, limit.attempts - 1);
		return `Stopped after ${n} ${n === 1 ? "try" : "tries"}`;
	};
	if (mode === "rate_limited")
		return {
			head: "Rate limited",
			detail: limit.gaveUp
				? stopped()
				: next
					? `Next try ${clock(next)}${tryOf(limit)}`
					: "Not retrying",
		};
	if (mode === "overloaded") {
		const left = next ? Date.parse(next) - (opts.now ?? Date.now()) : 0;
		return {
			head: "Provider busy",
			detail: limit.gaveUp
				? stopped()
				: next
					? `Retrying ${left > 0 ? `in ${waitWords(left)}` : "now"}${tryOf(limit)}`
					: "Not retrying",
		};
	}
	const head = "Usage limit reached";
	if (limit.gaveUp) return { head, detail: stopped() };
	if (!limit.autoResume)
		return {
			head,
			detail: limit.resetsAt ? `Resets ${clock(limit.resetsAt)}` : null,
		};
	if (limit.resetsAt)
		return {
			head,
			detail: `Resumes ${clock(limit.resetsAt)}`,
		};
	return {
		head,
		detail: next ? `Next try ${clock(next)}${tryOf(limit)}` : null,
	};
}

/** The dock's second line: what happens next, and the one thing to do. */
export function stopNext(limit: ThreadStop): string {
	const mode = stopMode(limit);
	if (mode === "out_of_credit")
		return "Nothing happens by itself. Add credit, then Try again. Your draft is kept.";
	if (mode === "key_rejected")
		return "Nothing happens by itself. Update the key in the agent's settings, then Try again. Your draft is kept.";
	if (mode === "spend_cap")
		return "Nothing happens by itself. Raise the cap, then Try again. Your draft is kept.";
	if (limit.gaveUp)
		return "Not trying again by itself. Retry now, or switch the agent or model.";
	if (!limit.autoResume)
		return "Auto-resume is off for this thread. Your draft is kept.";
	return limit.message
		? "Picks up where it stopped, then sends your queued message."
		: "Picks up where it stopped. Nothing is lost.";
}

/** The row's word and detail (#1101 category 2): Limited with its time, or Blocked with its cause. */
export function stopRowWords(
	limit: {
		mode?: FailureMode;
		resetsAt: string | null;
		nextAttemptAt?: string;
		nextTry?: { n: number; of: number };
	},
	clock: (at: string) => string = formatClock,
): { state: "limited" | "blocked"; word: string; detail: string } {
	const mode = stopMode(limit);
	if (mode === "out_of_credit")
		return { state: "blocked", word: "Blocked", detail: "Out of credit" };
	if (mode === "key_rejected")
		return { state: "blocked", word: "Blocked", detail: "API key rejected" };
	if (mode === "spend_cap")
		return { state: "blocked", word: "Blocked", detail: "Spend cap reached" };
	const cause =
		mode === "rate_limited"
			? "Rate limited"
			: mode === "overloaded"
				? "Provider busy"
				: "Usage limit";
	// Limited already names the stop: the detail is its one time, the reset, which every
	// surface says (sheet §10). With no reset, the next attempt is only a try (#1101 cat 17).
	if (limit.resetsAt)
		return {
			state: "limited",
			word: "Limited",
			detail: `Resumes ${clock(limit.resetsAt)}`,
		};
	if (limit.nextAttemptAt)
		return {
			state: "limited",
			word: "Limited",
			detail: `Next try ${clock(limit.nextAttemptAt)}${limit.nextTry ? ` (${limit.nextTry.n} of ${limit.nextTry.of})` : ""}`,
		};
	return { state: "limited", word: "Limited", detail: cause };
}

/**
 * The rail's hover name for a typed mark (#1101 item 5), or null for an event
 * that is not one: "Usage limit, resets 18:30", "API key rejected", "Interrupted by restart".
 */
export function stopMarkName(
	e: CanonicalEvent,
	clock: (at: string) => string = formatClock,
): string | null {
	switch (e.kind) {
		case "usage_limit": {
			const mode = e.mode ?? "usage_limit";
			if (mode === "rate_limited") return "Rate limited";
			if (mode === "overloaded") return "Provider busy";
			const name = limitName(e.window);
			return e.resetsAt
				? `${name}, resets ${clock(e.resetsAt)}`
				: `${name}, reset unknown`;
		}
		case "provider_blocked":
			return e.mode === "out_of_credit"
				? "Out of credit"
				: e.mode === "key_rejected"
					? "API key rejected"
					: "Spend cap reached";
		case "provider_retry":
			return `${e.mode === "overloaded" ? "Provider busy" : "Rate limited"}, try ${e.attempt} of ${e.maxAttempts} at ${clock(e.at)}`;
		case "resume_scheduled":
			if (e.wakeKind !== "limit") return null;
			return e.gaveUp
				? "Stopped trying"
				: !e.at
					? null
					: e.nextTry
						? `Next try ${clock(e.at)}, try ${e.nextTry.n} of ${e.nextTry.of}`
						: `Resumes ${clock(e.at)}`;
		case "resumed":
			return e.reason === "limit_reset" ? "Resumed after the stop" : null;
		case "run_interrupted":
			return "Interrupted by restart";
		default:
			return null;
	}
}

/** A provider retry's counter, "Retry 3/5": the line leads with it so it reads at a glance. */
export function retryCount(e: {
	attempt: number;
	maxAttempts: number;
}): string {
	return `Retry ${e.attempt}/${e.maxAttempts}`;
}

/**
 * The transcript's one line for a stop, retry, resume or restart event (#1101),
 * or null for any other event.
 */
export function stopNodeLine(
	e: CanonicalEvent,
	clock: (at: string) => string = formatClock,
): string | null {
	switch (e.kind) {
		case "usage_limit": {
			const mode = e.mode ?? "usage_limit";
			if (mode === "rate_limited")
				return `${cap(e.agent)}'s provider limited the request rate`;
			if (mode === "overloaded") return `${cap(e.agent)}'s provider was busy`;
			// The parent turn's one plain line (sheet §10); the dock names the window.
			return e.resetsAt
				? `Usage limit reached. Retry after ${clock(e.resetsAt)}`
				: "Usage limit reached";
		}
		case "provider_blocked":
			return blockedLine(e.mode, e.agent);
		case "provider_retry": {
			const why = e.mode === "overloaded" ? "Provider busy" : "Rate limited";
			return e.phase === "succeeded"
				? `${retryCount(e)} · went through at ${clock(e.at)}`
				: `${retryCount(e)} · ${why} · next ${clock(e.at)}`;
		}
		case "resume_scheduled": {
			if (e.gaveUp || !e.at) return "Stopped trying to resume";
			if (e.nextTry)
				return `Next try ${clock(e.at)} (try ${e.nextTry.n} of ${e.nextTry.of})`;
			const of = e.maxAttempts ? ` of ${e.maxAttempts}` : "";
			return e.attempt && e.attempt > 1
				? `Next try ${clock(e.at)} (try ${e.attempt}${of})`
				: `Resumes at ${clock(e.at)}`;
		}
		case "resumed":
			return e.reason === "limit_reset"
				? "Resumed where it stopped"
				: e.reason === "idle_compact"
					? "Compacted while idle"
					: "Woke up";
		case "run_interrupted":
			return "Interrupted by restart";
		default:
			return null;
	}
}

/** Where each agent's API account is managed; absent when the provider varies (OpenCode). */
const ACCOUNT_PAGES: Record<
	string,
	{ billing: string; limits: string } | undefined
> = {
	"claude-code": {
		billing: "https://platform.claude.com/settings/billing",
		limits: "https://platform.claude.com/settings/limits",
	},
	codex: {
		billing: "https://platform.openai.com/settings/organization/billing",
		limits: "https://platform.openai.com/settings/organization/limits",
	},
	gemini: {
		billing: "https://aistudio.google.com/usage",
		limits: "https://aistudio.google.com/usage",
	},
};

export function accountPage(
	harness: string | null | undefined,
	page: "billing" | "limits",
): string | null {
	return ACCOUNT_PAGES[harness ?? ""]?.[page] ?? null;
}
