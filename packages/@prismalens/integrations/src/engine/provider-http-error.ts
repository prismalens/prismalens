// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Safe diagnostics for a failed provider HTTP call (#347 F1).
 *
 * A provider's non-2xx body is not a safe thing to put in an error message.
 * OAuth and provider-API error bodies legitimately echo bearer tokens, refresh
 * tokens, authorization codes and client credentials — and these errors are
 * logged (the OAuth callback logs the caught error) and, on the refresh path,
 * persisted on the connection row. So the response body, the response headers
 * and the request's own credentials never travel with the error.
 *
 * What travels is only what a reader needs in order to place the failure:
 * which operation, which provider, and the HTTP-level facts. Note that even
 * the reason phrase is NOT taken from the response: `statusText` is
 * provider-controlled text on the status line, so the phrase is looked up from
 * the status code instead. Fencing untrusted text is an enumeration problem,
 * not a filtering one — a bearer token is itself a plausible-looking string,
 * so any "strip the suspicious characters" filter leaks a recognisable
 * remnant of it.
 */
import { STATUS_CODES } from "node:http";

/**
 * Render `HTTP <status> <reason>` using the registered reason phrase for the
 * code (never the provider's own `statusText`). Unknown codes render bare.
 */
export function httpStatusDiagnostic(status: number): string {
	const reason = STATUS_CODES[status];
	return reason ? `HTTP ${status} ${reason}` : `HTTP ${status}`;
}

/**
 * Build the error for a non-2xx provider response.
 *
 * `operation` and `provider` must be values this codebase owns (a literal, a
 * template id) — never anything read out of the provider's response.
 */
export function providerHttpError(opts: {
	/** What was being attempted, e.g. "OAuth token exchange". */
	operation: string;
	/** Which provider/integration, e.g. a template id or "github". */
	provider: string;
	/** Only `status` is read. The body and headers are never touched. */
	response: { status: number };
}): Error {
	return new Error(
		`${opts.operation} failed for provider '${opts.provider}' (${httpStatusDiagnostic(opts.response.status)})`,
	);
}
