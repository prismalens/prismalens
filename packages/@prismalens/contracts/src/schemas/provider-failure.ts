// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { agentName, isBlockedMode } from "./provider-failure-values.js";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Why an agent's provider stopped a turn (#1101 category 17): a subscription
 * usage limit, a rate limit, an overloaded provider, or one of the three API
 * account stops that never clear by waiting.
 */
export const FAILURE_MODES = [
	"usage_limit",
	"rate_limited",
	"overloaded",
	"out_of_credit",
	"key_rejected",
	"spend_cap",
] as const;
export const FailureModeSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(FAILURE_MODES),
);
export type FailureMode = z.infer<typeof FailureModeSchema>;

/** Provider stops PrismaLens retries on a short backoff, counting "try N of 5". */
export const RETRY_MODES = [
	"rate_limited",
	"overloaded",
] as const satisfies readonly FailureMode[];
export type RetryMode = (typeof RETRY_MODES)[number];

/** Tries a rate limit or an overloaded provider gets, the first included. */
export const PROVIDER_RETRY_ATTEMPTS = 5;

/** Which usage window ran out, when the agent's words name it. */
export const LIMIT_WINDOWS = [
	"session",
	"daily",
	"weekly",
	"monthly",
	"model",
] as const;
export const LimitWindowSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(LIMIT_WINDOWS),
);
export type LimitWindow = z.infer<typeof LimitWindowSchema>;

export function isRetryMode(
	mode: string | null | undefined,
): mode is RetryMode {
	return (RETRY_MODES as readonly string[]).includes(mode ?? "");
}

/**
 * What the provider's error carried, as the agent passed it on: HTTP status,
 * error type and code, and `retry-after`. Never shown; the words come from `mode`.
 */
export const ProviderErrorFactsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		status: z.number().int().min(100).max(599).optional(),
		type: z.string().max(100).optional(),
		code: z.string().max(100).optional(),
		retryAfterSeconds: z.number().nonnegative().optional(),
	}),
);
export type ProviderErrorFacts = z.infer<typeof ProviderErrorFactsSchema>;

/** A classified provider stop, recorded on the turn's `error` event. */
export const RunFailureSchema = /* @__PURE__ */ lazySchema(() =>
	ProviderErrorFactsSchema.extend({
		mode: FailureModeSchema,
		window: LimitWindowSchema.optional(),
		/** The try that just failed, the first counted; tries the turn made itself count too. */
		attempt: z.number().int().min(1).optional(),
		/** The agent's own words, kept for the "agent's error" detail; the event's message is plain (#1101). */
		raw: z.string().max(500).optional(),
	}),
);
export type RunFailure = z.infer<typeof RunFailureSchema>;

/** The try a wake makes and the most it makes: "try 2 of 7" (#1101 category 17 item 4). */
export const NextTrySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		n: z.number().int().min(1),
		of: z.number().int().min(1),
	}),
);
export type NextTry = z.infer<typeof NextTrySchema>;

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

/** The needs-you word a stopped thread reads (#1101 category 2): Limited waits on a clock, Blocked on the user. */
export function stopState(
	mode: string | null | undefined,
): "limited" | "blocked" {
	return isBlockedMode(mode) ? "blocked" : "limited";
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
