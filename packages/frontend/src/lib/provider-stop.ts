// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY, MODEL_PROVIDERS } from "@prismalens/config/harness";
import {
	agentName,
	type CanonicalEvent,
	type FailureMode,
	type LimitWindow,
	type ThreadSession,
} from "@prismalens/contracts";
import { agentFacts } from "./agent-facts";
import { formatClock } from "./format-time";
import { stopCause } from "./stop-causes";

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
const _cap = agentName;

/** A stop's cause in the thread's words, from its `stopCause` entry. */
export function blockedLine(mode: FailureMode, agent: string): string {
	const cause = stopCause(mode);
	return cause.line?.(agent) ?? cause.name;
}

/** "try 2 of 5": the try a pending wake makes, of the most it makes. */
function tryCount(limit: ThreadStop): string | null {
	if (!limit.maxAttempts) return null;
	// A usage limit counts its retries; a provider retry counts its tries, the first included.
	const usage = !stopCause(stopMode(limit)).retries;
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
	const cause = stopCause(mode);
	const agent = limit.agent ?? "the agent";
	if (cause.state === "blocked") return blockedLine(mode, agent);
	const tries = tryCount(limit);
	const next = limit.autoResume ? limit.nextAttemptAt : undefined;
	if (cause.retries) {
		const of = tries ? ` (${tries})` : "";
		if (limit.gaveUp)
			return `${cause.name} · stopped after ${limit.attempts - 1} tries`;
		if (!cause.countdown)
			return next
				? `${cause.name} · trying again at ${clock(next)}${of}`
				: `${cause.name} · not trying again by itself`;
		if (!next) return `${cause.name} · not retrying by itself`;
		const left = Date.parse(next) - (opts.now ?? Date.now());
		return `${cause.name} · retrying ${left > 0 ? `in ${waitWords(left)}` : "now"}${of}`;
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
	const cause = stopCause(stopMode(limit));
	const head = cause.head;
	if (cause.state === "blocked") return { head, detail: null };
	const next = limit.autoResume ? limit.nextAttemptAt : undefined;
	const stopped = () => {
		const n = Math.max(0, limit.attempts - 1);
		return `Stopped after ${n} ${n === 1 ? "try" : "tries"}`;
	};
	if (cause.retries) {
		const left = next ? Date.parse(next) - (opts.now ?? Date.now()) : 0;
		return {
			head,
			detail: limit.gaveUp
				? stopped()
				: !next
					? "Not retrying"
					: cause.countdown
						? `Retrying ${left > 0 ? `in ${waitWords(left)}` : "now"}${tryOf(limit)}`
						: `Next try ${clock(next)}${tryOf(limit)}`,
		};
	}
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
	const next = stopCause(stopMode(limit)).next;
	if (next) return next;
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
	const { state, name: cause } = stopCause(stopMode(limit));
	if (state === "blocked")
		return { state: "blocked", word: "Blocked", detail: cause };
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
			const cause = stopCause(e.mode ?? "usage_limit");
			if (cause.retries) return cause.name;
			const name = limitName(e.window);
			return e.resetsAt
				? `${name}, resets ${clock(e.resetsAt)}`
				: `${name}, reset unknown`;
		}
		case "provider_blocked":
			return stopCause(e.mode).name;
		case "provider_retry":
			return `${stopCause(e.mode).name}, try ${e.attempt} of ${e.maxAttempts} at ${clock(e.at)}`;
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

/** A waiting retry whose try time has come: it has run, so it no longer waits. */
export const retryPassed = (e: { at: string }, now: number) =>
	Date.parse(e.at) <= now;

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
	now: number = Date.now(),
): string | null {
	switch (e.kind) {
		case "usage_limit": {
			const line = stopCause(e.mode ?? "usage_limit").line;
			if (line) return line(e.agent);
			// The parent turn's one plain line (sheet §10); the dock names the window.
			return e.resetsAt
				? `Usage limit reached. Retry after ${clock(e.resetsAt)}`
				: "Usage limit reached";
		}
		case "provider_blocked":
			return blockedLine(e.mode, e.agent);
		case "provider_retry": {
			const why = stopCause(e.mode).name;
			if (e.phase === "succeeded")
				return `${retryCount(e)} · went through at ${clock(e.at)}`;
			// A try whose time has passed is history: never a past "next"; the last one ends the retries.
			if (retryPassed(e, now))
				return e.attempt >= e.maxAttempts
					? `${retryCount(e)} · ${why} · stopped retrying`
					: `${retryCount(e)} · ${why} · tried ${clock(e.at)}`;
			return `${retryCount(e)} · ${why} · next ${clock(e.at)}`;
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

/**
 * Where the agent's API account is managed, from its `vendor` fact; absent when the provider
 * varies (OpenCode), whose model id names the provider first ("anthropic/…").
 */
export function accountPage(
	harness: string | null | undefined,
	page: "billing" | "limits",
	model?: string | null,
): string | null {
	return accountLink(harness, page, model)?.url ?? null;
}

/**
 * The account page and who runs it: the agent's own vendor, else the provider its model id
 * names first (agent facts, `MODEL_PROVIDERS`); null when that provider's page is not known.
 */
export function accountLink(
	harness: string | null | undefined,
	page: "billing" | "limits",
	model?: string | null,
): { url: string; label: string; vendor: string } | null {
	const prefix = model?.includes("/") ? model.split("/")[0] : undefined;
	const vendor =
		agentFacts(harness)?.vendor ??
		Object.values(HARNESS_REGISTRY).find(
			(h) => !!prefix && h.vendor?.modelPrefix === prefix,
		)?.vendor ??
		(prefix ? MODEL_PROVIDERS[prefix] : undefined);
	const url = vendor?.[page];
	return vendor && url
		? { url, label: `Open ${page}`, vendor: vendor.name }
		: null;
}
