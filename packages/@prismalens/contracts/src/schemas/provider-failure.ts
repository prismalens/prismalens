// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { agentName, isBlockedMode } from "./provider-failure-values.js";

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

/** The needs-you word a stopped thread reads (#1101 category 2): Limited waits on a clock, Blocked on the user. */
export function stopState(
	mode: string | null | undefined,
): "limited" | "blocked" {
	return isBlockedMode(mode) ? "blocked" : "limited";
}
