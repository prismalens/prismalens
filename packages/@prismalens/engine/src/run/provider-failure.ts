// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type FailureMode,
	type LimitWindow,
	PROVIDER_RETRY_ATTEMPTS,
	type ProviderErrorFacts,
	type RunFailure,
} from "@prismalens/contracts/schemas";
import { isUsageLimitError, retryInMs, SHORT_RETRY_MS } from "./usage-limit.js";

/** A wait up to this long is sat out inside the turn; a longer one ends it and a wake takes over (#1101). */
export const IN_TURN_WAIT_MS = 60_000;
/** Backoff before tries 2 to 5 when the provider named no wait. */
export const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000] as const;

/** What the turn tells the agent when it sends the message again after a provider wait. */
export const PROVIDER_RETRY_NOTE =
	"The model provider asked to wait; continue where you left off.";

/**
 * Provider error codes and types, in the order they are tried. Sources: Anthropic
 * API errors, OpenAI error codes, Google AI troubleshooting, Codex's protocol errors
 * and Gemini CLI's quota errors (#1101 survey A2).
 */
const BY_CODE: [RegExp, FailureMode][] = [
	[/usagelimitexceeded|quota_exhausted/, "usage_limit"],
	[
		/credit_balance_exhausted|insufficient_quota|insufficient_g1_credits_balance|billing_error|billing_hard_limit_reached|payment_required/,
		"out_of_credit",
	],
	[
		/(organization|project|workspace)_(spend|usage)_limit_exceeded|spend_limit_exceeded/,
		"spend_cap",
	],
	[
		/authentication_error|invalid_api_key|api_key_invalid|incorrect_api_key|unauthenticated/,
		"key_rejected",
	],
	[
		/overloaded_error|server_is_overloaded|serveroverloaded|model_capacity_exhausted|unavailable/,
		"overloaded",
	],
	[
		/rate_limit_error|rate_limit_exceeded|\brate_limit\b|slow_down|resource_exhausted|too_many_requests/,
		"rate_limited",
	],
];

const SPEND_WORDS =
	/spend(ing)? (cap|limit)|workspace (api )?(spend|usage) limit|specified (workspace )?api usage limit|usage limit you (have )?set|monthly (spend|usage) limit/;
const CREDIT_WORDS =
	/credit balance is too low|out of credit|insufficient (credit|credits|funds|balance)|quota exceeded\. check your plan and billing|check your plan and billing|payment required|add (more )?credits?|prepay credits/;
const KEY_WORDS =
	/invalid x-api-key|incorrect api key|invalid api key|api key not valid|api_key_invalid|reported as leaked|api key (was|has been) (revoked|disabled|deleted)|invalid authentication|invalid bearer token/;
const OVERLOADED_WORDS =
	/overloaded|at capacity|\b529\b|high demand|service unavailable|\b503\b/;
const RATE_WORDS = /rate.?limit|\b429\b|too many requests/;

function plain(text: string): string {
	return text.replace(/[‘’]/g, "'").toLowerCase();
}

function byCode(code: string): FailureMode | null {
	for (const [test, mode] of BY_CODE) if (test.test(code)) return mode;
	return null;
}

function byStatus(
	status: number | undefined,
	said: string,
): FailureMode | null {
	if (status === 402) return "out_of_credit";
	if (status === 401) return "key_rejected";
	if (status === 403 && /key|permission_error|leaked/.test(said))
		return "key_rejected";
	if (status === 429) return "rate_limited";
	if (status === 529 || status === 503) return "overloaded";
	return null;
}

/** Which usage window the agent's words name, if any. */
export function limitWindow(text: string): LimitWindow | undefined {
	const said = plain(text);
	if (/weekly|this week/.test(said)) return "weekly";
	if (/session limit|5-hour|five-hour|5 hour/.test(said)) return "session";
	if (/daily|per day|today/.test(said)) return "daily";
	if (/monthly|this month/.test(said)) return "monthly";
	if (
		/(opus|sonnet|fable|model)('s)? (usage )?limit|for this model|on this model/.test(
			said,
		)
	)
		return "model";
	return undefined;
}

/**
 * A provider stop from its facts first (code, type, status) and its words only
 * as the fallback; null for any failure that is not the provider's.
 */
export function classifyFailure(
	text: string | null | undefined,
	facts: ProviderErrorFacts = {},
): RunFailure | null {
	const said = plain(text ?? "");
	const ids = plain(`${facts.code ?? ""} ${facts.type ?? ""}`);
	let mode = byCode(ids) ?? byStatus(facts.status, `${said} ${ids}`);
	// A generic rate code or a bare status says less than the words beside it.
	if (mode === null || mode === "rate_limited") {
		if (SPEND_WORDS.test(said)) mode = "spend_cap";
		else if (isUsageLimitError(text)) {
			const wait = retryInMs(text ?? "");
			mode =
				wait !== null && wait < SHORT_RETRY_MS ? "rate_limited" : "usage_limit";
		} else if (CREDIT_WORDS.test(said)) mode = "out_of_credit";
	}
	if (mode === null) {
		if (KEY_WORDS.test(said)) mode = "key_rejected";
		else if (OVERLOADED_WORDS.test(said)) mode = "overloaded";
		else if (RATE_WORDS.test(said)) mode = "rate_limited";
		else {
			// Gemini's "Please retry in 20s" on a quota: a short wait, which is a rate limit.
			const wait = retryInMs(text ?? "");
			if (wait !== null && /quota|limit/.test(said)) mode = "rate_limited";
		}
	}
	if (mode === null) return null;
	const retryAfterSeconds =
		facts.retryAfterSeconds ??
		secondsOf(retryInMs(text ?? "") ?? retryAfterMs(said));
	const window = mode === "usage_limit" ? limitWindow(text ?? "") : undefined;
	return {
		mode,
		...(facts.status !== undefined ? { status: facts.status } : {}),
		...(facts.type ? { type: facts.type } : {}),
		...(facts.code ? { code: facts.code } : {}),
		...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
		...(window ? { window } : {}),
	};
}

function secondsOf(ms: number | null): number | undefined {
	return ms === null ? undefined : Math.ceil(ms / 1000);
}

/** "retry after 30 seconds", "try again in 2 minutes". */
function retryAfterMs(said: string): number | null {
	const m =
		/(?:retry|try again) (?:after|in)\s+([\d.]+)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\b/.exec(
			said,
		);
	if (!m) return null;
	const n = Number(m[1]);
	if (!Number.isFinite(n)) return null;
	const unit = m[2] as string;
	return unit === "ms" ? n : unit.startsWith("m") ? n * 60_000 : n * 1000;
}

/** How long to wait before `attempt` (2 to 5): the provider's own `retry-after`, else the backoff. */
export function retryDelayMs(failure: RunFailure, attempt: number): number {
	if (failure.retryAfterSeconds !== undefined)
		return failure.retryAfterSeconds * 1000;
	const i = Math.min(Math.max(attempt - 2, 0), RETRY_BACKOFF_MS.length - 1);
	return RETRY_BACKOFF_MS[i] as number;
}

/** Whether the turn sits this wait out itself: a retry mode, tries left, and a short wait. */
export function retriesInTurn(failure: RunFailure, attempt: number): boolean {
	return (
		(failure.mode === "rate_limited" || failure.mode === "overloaded") &&
		attempt <= PROVIDER_RETRY_ATTEMPTS &&
		retryDelayMs(failure, attempt) <= IN_TURN_WAIT_MS
	);
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;

function numberOf(v: unknown): number | undefined {
	const n = typeof v === "string" && v.trim() ? Number(v) : v;
	return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function stringOf(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined;
}

/** Codex's error info: a variant name, or an object keyed by one. */
function infoOf(v: unknown): string | undefined {
	return stringOf(v) ?? stringOf(Object.keys(asRecord(v) ?? {})[0]);
}

/** The provider JSON a message quotes, as `API Error: 429 {"type":"error",...}` does. */
function quotedJson(text: string): unknown {
	const start = text.search(/[[{]/);
	if (start < 0) return null;
	const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
	if (end <= start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
}

/** Walks an error body for status, type, code and retry-after, nested `error` objects included. */
function collect(v: unknown, into: ProviderErrorFacts, depth = 0): void {
	if (depth > 4) return;
	if (Array.isArray(v)) {
		for (const item of v.slice(0, 3)) collect(item, into, depth + 1);
		return;
	}
	const o = asRecord(v);
	if (!o) return;
	const status =
		numberOf(o.status) ??
		numberOf(o.statusCode) ??
		numberOf(o.httpStatus) ??
		numberOf(o.http_status);
	// Google's `{code: 429, status: "RESOURCE_EXHAUSTED"}`: the number is the HTTP status.
	const code = numberOf(o.code);
	if (into.status === undefined) {
		if (status !== undefined && status >= 100 && status <= 599)
			into.status = status;
		else if (code !== undefined && code >= 100 && code <= 599)
			into.status = code;
	}
	// Anthropic's envelope is `{type: "error", error: {type: ...}}`: the inner type names it.
	if (o.type !== "error")
		into.type ??=
			stringOf(o.type) ??
			stringOf(o.errorType) ??
			(typeof o.status === "string" ? stringOf(o.status) : undefined);
	into.code ??=
		stringOf(o.code) ??
		stringOf(o.reason) ??
		stringOf(o.errorKind) ??
		infoOf(o.codexErrorInfo) ??
		infoOf(o.codex_error_info);
	const headers = asRecord(o.headers);
	const after =
		numberOf(o.retryAfterSeconds) ??
		numberOf(o.retry_after) ??
		numberOf(o.retryAfter) ??
		numberOf(headers?.["retry-after"]);
	if (into.retryAfterSeconds === undefined && after !== undefined && after >= 0)
		into.retryAfterSeconds = after;
	for (const key of ["error", "data", "details", "cause"])
		if (o[key] !== undefined) collect(o[key], into, depth + 1);
	if (typeof o.message === "string")
		collect(quotedJson(o.message), into, depth + 1);
}

/** The facts a JSON-RPC error carries: its `data`, and provider JSON quoted in its message. */
export function errorFacts(
	message: string,
	data?: unknown,
	/** The JSON-RPC code: Gemini CLI sends the HTTP status there. */
	rpcCode?: number,
): ProviderErrorFacts {
	const facts: ProviderErrorFacts = {};
	if (rpcCode !== undefined && rpcCode >= 400 && rpcCode <= 599)
		facts.status = rpcCode;
	collect(typeof data === "string" ? (quotedJson(data) ?? null) : data, facts);
	collect(quotedJson(message), facts);
	if (facts.status === undefined) {
		const m =
			/\b(?:api error|status|http|error)[:\s]+([1-5]\d\d)\b/i.exec(message) ??
			/^([1-5]\d\d)\b/.exec(message.trim());
		if (m) facts.status = Number(m[1]);
	}
	return facts;
}
