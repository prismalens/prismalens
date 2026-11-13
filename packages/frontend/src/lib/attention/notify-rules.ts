// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What one attention event does on this tab (#1101 category 4): a toast, a system
 * notification, a sound, or nothing. Pure, so the rules have tests.
 */
import {
	type AttentionEvent,
	type AttentionKind,
	type AttentionThread,
	attentionGroup,
	FAILURE_MODES,
	HOST_STOPS,
	type NotifyPrefs,
	type Severity,
} from "@prismalens/contracts";
import { MARKS } from "@/components/kit/marks";
import { statusWord } from "@/components/kit/Status";
import { failureLine, failureWords } from "@/lib/failure-words";
import { formatClock } from "@/lib/format-time";
import { plainError } from "@/lib/get-error-message";
import { plainExcerpt } from "@/lib/inbound-rows";
import { stopRowWords } from "@/lib/provider-stop";
import { stopCause } from "@/lib/stop-causes";

export interface TabFacts {
	/** The tab is visible and its window has focus. */
	focused: boolean;
	/** The thread this tab shows, when it shows one. */
	viewing: string | null;
	permission: NotificationPermission | "unsupported";
}

export interface Decision {
	toast: boolean;
	os: boolean;
	sound: boolean;
}

const NONE: Decision = { toast: false, os: false, sound: false };

export function decide(
	e: AttentionEvent,
	prefs: NotifyPrefs,
	tab: TabFacts,
): Decision {
	const group = attentionGroup(e.kind);
	if (!group || !e.notify || e.silenced) return NONE;
	if (e.threadId === tab.viewing && tab.focused) return NONE;
	const chosen =
		group === "needs_you"
			? prefs.events.needsYou
			: group === "finished"
				? prefs.events.finished
				: prefs.events.failed;
	if (!chosen) return NONE;
	// In the app, another thread's event is a toast whatever the mode.
	const toast = tab.focused && e.threadId !== tab.viewing;
	if (prefs.mode === "off") return { toast, os: false, sound: false };
	const outward = prefs.when === "always" || !tab.focused;
	const os =
		outward &&
		(prefs.mode === "notifications" || prefs.mode === "both") &&
		tab.permission === "granted";
	// Sound is for needs-you only.
	const sound =
		outward &&
		group === "needs_you" &&
		(prefs.mode === "sound" || prefs.mode === "both");
	return { toast, os, sound };
}

/** Why a run failed, in words: the report's cause, the recorded error, how it ended, or its last answer. */
export function failedCause(t: AttentionEvent["thread"]): string {
	if (t.cause) return t.cause;
	if (t.error) return failureLine(failureWords(plainError(t.error)));
	if (t.endReason === "interrupted") return "A restart cut the run off.";
	if (t.endReason === "limited") return "It stopped at a usage limit.";
	if (t.endReason === "blocked") return "The provider refused the run.";
	return t.answer ?? "It stopped before it said anything.";
}

const KIND_WORD: Record<AttentionKind, string> = {
	needs_you: "Needs you",
	limited: "Limited",
	blocked: "Blocked",
	failed: "Failed",
	finished: "Finished",
	started: "Started",
};

const SEVERITY_WORD: Record<Severity, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
	info: "Info",
};

/** The event's one word and its detail line. */
export function eventWords(
	e: AttentionEvent,
	clock: (at: string) => string = formatClock,
): { word: string; detail: string | null } {
	const t = e.thread;
	switch (e.kind) {
		case "blocked": {
			const host = HOST_STOPS.find((h) => h === e.detail);
			if (host)
				return { word: statusWord("blocked"), detail: stopCause(host).name };
			if (!FAILURE_MODES.some((m) => m === e.detail))
				return { word: statusWord("blocked"), detail: null };
			return stopEventWords(e, clock);
		}
		case "limited":
			return stopEventWords(e, clock);
		case "needs_you":
			return { word: KIND_WORD.needs_you, detail: e.detail };
		case "failed":
			return { word: KIND_WORD.failed, detail: failedCause(t) };
		case "finished":
			return {
				word: KIND_WORD.finished,
				// A card quotes plain words: no Markdown marks or paths (#1105).
				detail: plainExcerpt(
					(t.incident ? (t.cause ?? t.answer) : (t.answer ?? t.cause)) ??
						"No written answer",
				),
			};
		case "started":
			return {
				word: e.detail === "scheduled" ? "Scheduled run" : "Started by alert",
				detail:
					t.answer ??
					(e.detail === "scheduled"
						? "It ran on its schedule."
						: "An alert started it."),
			};
	}
}

/** A provider stop's words; with no mode it reads as a usage limit. */
function stopEventWords(
	e: AttentionEvent,
	clock: (at: string) => string,
): { word: string; detail: string | null } {
	// The server types the detail; a list check keeps the schema library off the first paint.
	const mode = FAILURE_MODES.find((m) => m === e.detail);
	const w = stopRowWords(
		{ ...(mode ? { mode } : {}), resetsAt: e.resetsAt },
		clock,
	);
	return { word: w.word, detail: w.detail };
}

/**
 * A notification's title and body: an incident's carries its severity and its
 * report's cause, a chat its last answer.
 */
/** A thread's name on a card or notification; never "Untitled thread" (#1101). */
export function threadName(
	t: Pick<AttentionThread, "title" | "startedBy" | "incident" | "kind">,
): string {
	const title = t.title?.trim();
	if (title) return title;
	if (t.incident?.number) return `Incident #${t.incident.number}`;
	if (t.startedBy?.title?.trim())
		return `${MARKS.startedBy.words.agent} ${t.startedBy.title.trim()}`;
	return t.kind === "chat" ? "Chat" : "Investigation";
}

export function notificationText(
	e: AttentionEvent,
	clock: (at: string) => string = formatClock,
): { title: string; body: string } {
	const t = e.thread;
	const name = threadName(t);
	const { word, detail } = eventWords(e, clock);
	const sev = t.incident ? `${SEVERITY_WORD[t.incident.severity]} · ` : "";
	const body =
		t.incident && t.cause && e.kind !== "needs_you"
			? `Likely cause: ${t.cause}`
			: (detail ?? "");
	return { title: `${sev}${word}: ${name}`, body: body.slice(0, 180) };
}
