// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import type {
	FailureMode,
	LimitWindow,
	RunFailure,
} from "./provider-failure.js";

/** Stops that need the user: no timer, no retry, and the words never say "resumes". */
export const BLOCKED_MODES = [
	"out_of_credit",
	"key_rejected",
	"spend_cap",
] as const satisfies readonly FailureMode[];
export type BlockedMode = (typeof BLOCKED_MODES)[number];

export function isBlockedMode(
	mode: string | null | undefined,
): mode is BlockedMode {
	return (BLOCKED_MODES as readonly string[]).includes(mode ?? "");
}

/** An agent's display name from the registry, whether a record stored its id or a label in any case. */
export function agentName(stored: string): string {
	const s = stored.trim();
	const id = HARNESS_IDS.find(
		(i) =>
			i === s.toLowerCase().replace(/[\s_]+/g, "-") ||
			HARNESS_REGISTRY[i].label.toLowerCase() === s.toLowerCase(),
	);
	return id
		? HARNESS_REGISTRY[id].label
		: s.charAt(0).toUpperCase() + s.slice(1);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WINDOW_NAME: Record<LimitWindow, string> = {
	session: "session limit",
	daily: "daily limit",
	weekly: "weekly limit",
	monthly: "monthly limit",
	model: "model limit",
};

/**
 * A provider stop in plain words, the one vocabulary every surface shows (#1101
 * category 23): no status code, no "Internal error", no agent wording.
 */
export function failureLine(
	failure: Pick<RunFailure, "mode" | "window">,
	agent = "the agent",
): string {
	const who = agentName(agent);
	switch (failure.mode) {
		case "usage_limit":
			return `${who} reached its ${failure.window ? WINDOW_NAME[failure.window] : "usage limit"}`;
		case "rate_limited":
			return `${who}'s model provider limited the request rate`;
		case "overloaded":
			return `${who}'s model provider was busy`;
		case "out_of_credit":
			return `${who} is out of credit on its API account`;
		case "key_rejected":
			return `${who}'s API key was rejected`;
		case "spend_cap":
			return "Your organization's spend cap was reached";
	}
}

/** "2:00 PM" in the reader's locale; the browser passes its own, the server writes en-US. */
export function shortTime(
	at: Date,
	locale = "en-US",
	timeZone?: string,
): string {
	return at
		.toLocaleTimeString(locale, {
			hour: "numeric",
			minute: "2-digit",
			...(timeZone ? { timeZone } : {}),
		})
		.replace(/ /g, " ");
}

const CAUSE_WORDS = {
	busy: "the thread is mid-turn",
	ended: "the thread has ended",
	stopped: "the thread was stopped",
	settled: "the thread was settled",
	refused: "the thread could not be reopened",
} as const;

/**
 * An incoming message's row in plain words (#1101 category 17 item 9), its cause
 * in `failureLine`'s vocabulary: "Waiting: Claude Code reached its session limit".
 */
export function inboundLine(
	state: "waiting" | "delivered" | "failed",
	why: {
		failure?: Pick<RunFailure, "mode" | "window">;
		cause?: keyof typeof CAUSE_WORDS;
		agent?: string;
		/** Delivered inside a later fire that replaced it, which arrived at `at`. */
		merged?: { at: Date; locale?: string; timeZone?: string };
	} = {},
): string {
	if (state === "delivered" && why.merged)
		return `Merged into the ${shortTime(why.merged.at, why.merged.locale, why.merged.timeZone)} run`;
	if (state === "delivered") return "Delivered";
	const reason = why.failure
		? failureLine(why.failure, why.agent)
		: why.cause
			? capital(CAUSE_WORDS[why.cause])
			: null;
	const head = state === "waiting" ? "Waiting" : "Not delivered";
	return reason ? `${head}: ${reason}` : head;
}
