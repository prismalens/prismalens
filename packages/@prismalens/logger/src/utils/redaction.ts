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
 */
const SENSITIVE_KEYS = new Set([
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
]);

const REDACTED = "[REDACTED]";

/**
 * Redact sensitive data from a wide event.
 * Creates a new object, does not mutate the original.
 */
export function redactSensitiveData(
	event: Partial<WideEvent>,
): Partial<WideEvent> {
	const result = { ...event };

	// Redact request headers
	if (result.request?.headers) {
		result.request = {
			...result.request,
			headers: redactHeaders(result.request.headers),
		};
	}

	// Redact response headers
	if (result.response?.headers) {
		result.response = {
			...result.response,
			headers: redactHeaders(result.response.headers),
		};
	}

	// Redact query parameters
	if (result.request?.query) {
		result.request = {
			...result.request,
			query: redactObject(result.request.query),
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
	if (result.context) {
		result.context = redactObject(result.context);
	}

	return result;
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
 * Redact sensitive keys in an object.
 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			result[key] = REDACTED;
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
			result[key] = redactObject(value as Record<string, unknown>);
		} else {
			result[key] = value;
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
