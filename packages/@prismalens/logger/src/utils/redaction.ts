// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WideEvent } from "../types/wide-event.js";

/**
 * Headers that should always be redacted.
 */
const SENSITIVE_HEADERS = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"x-auth-token",
	"x-access-token",
	"x-refresh-token",
	"proxy-authorization",
]);

/**
 * Keys in objects that should be redacted.
 *
 * Entries are listed in their natural casing for readability but the set is
 * built lowercased, because lookups normalise the key with `toLowerCase()`.
 * Without the normalisation the camelCase entries would never match and
 * `accessToken` / `refreshToken` / `privateKey` / `creditCard` fields would be
 * emitted in the clear.
 */
const SENSITIVE_KEYS = new Set(
	[
		"password",
		"passwd",
		"secret",
		"token",
		"apikey",
		"api_key",
		"apiKey",
		"accessToken",
		"access_token",
		"refreshToken",
		"refresh_token",
		"private_key",
		"privateKey",
		"credit_card",
		"creditCard",
		"cvv",
		"ssn",
		"social_security",
	].map((key) => key.toLowerCase()),
);

const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";

/**
 * Redact sensitive data from a wide event or log object.
 * Creates a new object, does not mutate the original.
 */
export function redactSensitiveData<T extends Record<string, unknown>>(
	data: T,
): T {
	if (!data || typeof data !== "object") return data;
	const event = data as Partial<WideEvent> & Record<string, unknown>;
	const result = { ...event };

	// Redact request headers
	if (result.request?.headers) {
		result.request = {
			...result.request,
			headers: redactHeaders(result.request.headers as Record<string, string>),
		};
	}

	// Redact response headers
	if (result.response?.headers) {
		result.response = {
			...result.response,
			headers: redactHeaders(result.response.headers as Record<string, string>),
		};
	}

	// Redact query parameters
	if (result.request?.query) {
		result.request = {
			...result.request,
			query: redactObject(result.request.query as Record<string, unknown>),
		};
	}

	// Redact user email (partial)
	if (result.user?.email) {
		result.user = {
			...result.user,
			email: redactEmail(result.user.email),
		};
	}

	// Redact context values
	if (result.context && typeof result.context === "object") {
		result.context = redactObject(result.context as Record<string, unknown>);
	}

	// `result` is a shallow copy, so a self-referential input still points at the
	// original object — seed the ancestor set with it so the cycle is caught on
	// the first hop rather than after one redundant copy.
	const seen = new WeakSet<object>([event]);
	return redactObject(result as Record<string, unknown>, seen) as T;
}

/**
 * Redact sensitive headers.
 */
function redactHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
			result[key] = REDACTED;
		} else {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Whether a value should be walked key-by-key.
 *
 * Built-ins whose data lives outside their own enumerable properties must be
 * passed through untouched — walking a `Date`, `Error`, `Buffer` or `Map` with
 * `Object.entries` yields `{}` (or, for typed arrays, an object of numeric
 * keys), silently destroying the value the caller wanted logged.
 * Plain objects and ordinary class instances (DTOs and the like) stay
 * traversable so their sensitive keys are still redacted.
 */
function isTraversableObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	if (
		value instanceof Date ||
		value instanceof Error ||
		value instanceof RegExp ||
		value instanceof Map ||
		value instanceof Set ||
		value instanceof URL ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value)
	) {
		return false;
	}
	return true;
}

/**
 * Redact a single value, tracking the ancestors currently being walked so a
 * self-referential object yields `[CIRCULAR]` instead of blowing the stack.
 * A logger that throws on its own input is worse than one that loses a field.
 */
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
	if (Array.isArray(value)) {
		if (seen.has(value)) return CIRCULAR;
		seen.add(value);
		const items = value.map((item) => redactValue(item, seen));
		seen.delete(value);
		return items;
	}

	if (isTraversableObject(value)) {
		if (seen.has(value)) return CIRCULAR;
		seen.add(value);
		const redacted = redactObject(value, seen);
		seen.delete(value);
		return redacted;
	}

	return value;
}

/**
 * Redact sensitive keys in an object recursively.
 */
function redactObject(
	obj: Record<string, unknown>,
	seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			result[key] = REDACTED;
		} else {
			result[key] = redactValue(value, seen);
		}
	}
	return result;
}

/**
 * Partially redact an email address.
 * user@example.com -> u***@example.com
 */
function redactEmail(email: string): string {
	const atIndex = email.indexOf("@");
	if (atIndex <= 1) {
		return email; // Too short to redact meaningfully
	}
	const local = email.substring(0, atIndex);
	const domain = email.substring(atIndex);
	return `${local[0]}***${domain}`;
}
