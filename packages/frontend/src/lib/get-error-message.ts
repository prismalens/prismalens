// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { sendProblem } from "./send-problems";

/**
 * Extract a human-readable error message from any thrown value.
 *
 * Handles: Error instances, strings, objects with `.message`,
 * oRPC error shapes, and unknown values.
 */
export function getErrorMessage(error: unknown): string {
	return plainError(rawErrorMessage(error));
}

/**
 * A transport failure, a bare status or an error code becomes a sentence with
 * its cause and next step (#1101 category 23); any other message is kept.
 */
export function plainError(message: string): string {
	const m = message.trim();
	if (
		/^(typeerror: )?(failed to fetch|networkerror|load failed|network request failed|fetch failed)/i.test(
			m,
		)
	)
		return "PrismaLens did not answer. Check that it is still running, then try again.";
	if (
		/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(m) ||
		/^(http )?[45]\d\d\b/i.test(m) ||
		/^(internal server error|bad gateway|service unavailable|gateway timeout)\.?$/i.test(
			m,
		)
	)
		return "PrismaLens could not finish that. Try again; if it keeps happening, restart it with pl up.";
	if (/^input validation failed\.?$/i.test(m))
		return "PrismaLens did not accept what was sent. Check the text and files, then try again.";
	return message;
}

function rawErrorMessage(error: unknown): string {
	if (error !== null && typeof error === "object") {
		const obj = error as Record<string, unknown>;

		// 1. Check error.data (oRPC typed data or response body)
		if (obj.data !== null && typeof obj.data === "object") {
			const dataObj = obj.data as Record<string, unknown>;
			// A refused input names its field, so the line says what is wrong and what to do.
			if (Array.isArray(dataObj.issues)) {
				const said = sendProblem(dataObj.issues);
				if (said) return said;
			}
			if (typeof dataObj.reason === "string" && dataObj.reason.length > 0) {
				return dataObj.reason;
			}
			if (
				dataObj.data !== null &&
				typeof dataObj.data === "object" &&
				typeof (dataObj.data as Record<string, unknown>).reason === "string"
			) {
				return (dataObj.data as Record<string, unknown>).reason as string;
			}
			if (dataObj.body !== null && typeof dataObj.body === "object") {
				const bodyObj = dataObj.body as Record<string, unknown>;
				if (typeof bodyObj.reason === "string" && bodyObj.reason.length > 0) {
					return bodyObj.reason;
				}
				if (
					bodyObj.data !== null &&
					typeof bodyObj.data === "object" &&
					typeof (bodyObj.data as Record<string, unknown>).reason === "string"
				) {
					return (bodyObj.data as Record<string, unknown>).reason as string;
				}
				if (typeof bodyObj.message === "string" && bodyObj.message.length > 0) {
					return bodyObj.message;
				}
			}
			if (typeof dataObj.message === "string" && dataObj.message.length > 0) {
				return dataObj.message;
			}
		}

		// 2. Check error.reason
		if (typeof obj.reason === "string" && obj.reason.length > 0) {
			return obj.reason;
		}

		// 3. Check error.cause
		if (obj.cause !== undefined && obj.cause !== null) {
			if (typeof obj.cause === "string" && obj.cause.length > 0) {
				return obj.cause;
			}
			if (typeof obj.cause === "object") {
				const causeMsg = rawErrorMessage(obj.cause);
				if (
					causeMsg &&
					causeMsg !== "An unexpected error occurred" &&
					causeMsg !== "Precondition Failed"
				) {
					return causeMsg;
				}
			}
		}

		// 4. Check error.message
		if (typeof obj.message === "string" && obj.message.length > 0) {
			return obj.message;
		}
	}

	if (typeof error === "string") return error;
	return "An unexpected error occurred";
}
