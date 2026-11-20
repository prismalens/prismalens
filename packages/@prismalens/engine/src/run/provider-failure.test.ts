// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ProviderErrorFacts, RunFailure } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import {
	classifyFailure,
	errorFacts,
	retriesInTurn,
	retryDelayMs,
} from "./provider-failure.js";

describe("classifyFailure", () => {
	const authEnvelope =
		'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid api key"}}';

	const cases: Array<{
		name: string;
		text: string | null;
		facts?: ProviderErrorFacts;
		expected: RunFailure | null;
	}> = [
		{
			name: "Anthropic 402 billing_error -> out_of_credit",
			text: null,
			facts: { status: 402, type: "billing_error" },
			expected: { mode: "out_of_credit", status: 402, type: "billing_error" },
		},
		{
			name: "401 authentication_error via errorFacts -> key_rejected",
			text: authEnvelope,
			facts: errorFacts(authEnvelope),
			expected: {
				mode: "key_rejected",
				status: 401,
				type: "authentication_error",
			},
		},
		{
			name: "429 rate_limit_error with retryAfterSeconds 20 -> rate_limited keeping 20",
			text: null,
			facts: { status: 429, type: "rate_limit_error", retryAfterSeconds: 20 },
			expected: {
				mode: "rate_limited",
				status: 429,
				type: "rate_limit_error",
				retryAfterSeconds: 20,
			},
		},
		{
			name: "429 code organization_spend_limit_exceeded with type insufficient_quota -> spend_cap",
			text: null,
			facts: {
				status: 429,
				code: "organization_spend_limit_exceeded",
				type: "insufficient_quota",
			},
			expected: {
				mode: "spend_cap",
				status: 429,
				code: "organization_spend_limit_exceeded",
				type: "insufficient_quota",
			},
		},
		{
			name: "400 invalid_request_error with specified limits text -> spend_cap",
			text: "You have reached your specified API usage limits",
			facts: { status: 400, type: "invalid_request_error" },
			expected: {
				mode: "spend_cap",
				status: 400,
				type: "invalid_request_error",
			},
		},
		{
			name: "529 overloaded -> overloaded",
			text: null,
			facts: { status: 529 },
			expected: { mode: "overloaded", status: 529 },
		},
		{
			name: "Connection error. -> overloaded",
			text: "Connection error.",
			expected: { mode: "overloaded" },
		},
		{
			name: "Codex usageLimitExceeded -> usage_limit",
			text: null,
			facts: { code: "usageLimitExceeded" },
			expected: { mode: "usage_limit", code: "usageLimitExceeded" },
		},
		{
			name: "session limit text -> usage_limit with window session",
			text: "You've hit your session limit · resets 6:10am (Europe/London)",
			expected: { mode: "usage_limit", window: "session" },
		},
		{
			name: "weekly limit text -> window weekly",
			text: "You've hit your weekly limit",
			expected: { mode: "usage_limit", window: "weekly" },
		},
		{
			name: "Gemini Quota exceeded retry in 1s -> rate_limited with retryAfterSeconds 1",
			text: "Quota exceeded for quota metric. Please retry in 1s.",
			expected: { mode: "rate_limited", retryAfterSeconds: 1 },
		},
		{
			name: "Quota exceeded billing details -> out_of_credit",
			text: "Quota exceeded. Check your plan and billing details.",
			expected: { mode: "out_of_credit" },
		},
		{
			name: "Not logged in -> null",
			text: "Not logged in · Please run /login",
			expected: null,
		},
		{
			name: "investigation produced no evidence -> null",
			text: "investigation produced no evidence",
			expected: null,
		},
	];

	it.each(cases)("$name", ({ text, facts, expected }) => {
		expect(classifyFailure(text, facts)).toEqual(expected);
	});
});

describe("errorFacts", () => {
	it("Gemini puts the HTTP status in the JSON-RPC code", () => {
		expect(errorFacts("Rate limit exceeded", undefined, 429)).toEqual({
			status: 429,
		});
	});

	it("Anthropic envelope's inner type wins over error", () => {
		expect(
			errorFacts("API Error: 400", {
				type: "error",
				error: { type: "authentication_error" },
			}),
		).toEqual({
			status: 400,
			type: "authentication_error",
		});
	});

	it("codex_error_info object keyed by variant gives code", () => {
		expect(
			errorFacts("Internal error", {
				codex_error_info: { usageLimitExceeded: {} },
			}),
		).toEqual({
			code: "usageLimitExceeded",
		});
	});

	it("headers retry-after gives retryAfterSeconds", () => {
		expect(
			errorFacts("Rate limit", {
				headers: { "retry-after": 20 },
			}),
		).toEqual({
			retryAfterSeconds: 20,
		});
	});
});

describe("retryDelayMs", () => {
	it("retry-after wins over backoff", () => {
		expect(
			retryDelayMs({ mode: "rate_limited", retryAfterSeconds: 15 }, 2),
		).toBe(15_000);
		expect(
			retryDelayMs({ mode: "rate_limited", retryAfterSeconds: 10 }, 4),
		).toBe(10_000);
	});

	it("applies backoff 30 s, 60 s, 120 s, 240 s for tries 2..5", () => {
		expect(retryDelayMs({ mode: "rate_limited" }, 2)).toBe(30_000);
		expect(retryDelayMs({ mode: "rate_limited" }, 3)).toBe(60_000);
		expect(retryDelayMs({ mode: "rate_limited" }, 4)).toBe(120_000);
		expect(retryDelayMs({ mode: "rate_limited" }, 5)).toBe(240_000);
	});
});

describe("retriesInTurn", () => {
	it("true for rate_limited with retryAfterSeconds 1 at attempt 2", () => {
		expect(
			retriesInTurn({ mode: "rate_limited", retryAfterSeconds: 1 }, 2),
		).toBe(true);
	});

	it("false at attempt 6", () => {
		expect(
			retriesInTurn({ mode: "rate_limited", retryAfterSeconds: 1 }, 6),
		).toBe(false);
	});

	it("false for a 90 s retry-after", () => {
		expect(
			retriesInTurn({ mode: "rate_limited", retryAfterSeconds: 90 }, 2),
		).toBe(false);
	});

	it("false for out_of_credit", () => {
		expect(retriesInTurn({ mode: "out_of_credit" }, 2)).toBe(false);
	});
});
