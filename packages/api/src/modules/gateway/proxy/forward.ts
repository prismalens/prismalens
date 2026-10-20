// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Forwards one proxied call (#848, 06). The tool's own result passes unchanged; a transport
 * or HTTP failure never forwards upstream text, only PrismaLens's own sentence (OBJ-001).
 */
import {
	InsufficientScopeError,
	ProtocolError,
	SdkHttpError,
} from "@modelcontextprotocol/client";
import type { ProxyCallResult } from "@prismalens/integrations";
import { scrubSecrets } from "../../integrations/source-request.js";
import { NeedsSignInError } from "./mcp-oauth-provider.js";
import { TooLargeError } from "./upstream.js";

export const CALL_TIMEOUT_MS = 30_000;

export const errorResult = (text: string): ProxyCallResult => ({
	isError: true,
	content: [{ type: "text", text }],
});

/** Exact-value check on text and structured content; nothing else is touched. */
export function scrubResult(
	r: ProxyCallResult,
	secrets: string[],
): ProxyCallResult {
	if (!secrets.length) return r;
	const content = r.content.map((c) => {
		const item = c as { type?: string; text?: string };
		return item.type === "text" && typeof item.text === "string"
			? { ...item, text: scrubSecrets(item.text, secrets) }
			: c;
	});
	const structured =
		r.structuredContent === undefined
			? undefined
			: JSON.parse(scrubSecrets(JSON.stringify(r.structuredContent), secrets));
	return {
		...r,
		content,
		...(structured === undefined ? {} : { structuredContent: structured }),
	};
}

/** `needs permission: <scope>` with the scope cut to safe characters (04). */
export function needsPermission(scope: string | undefined): string {
	const clean = (scope ?? "")
		.replace(/[^A-Za-z0-9:._ -]/g, "")
		.slice(0, 80)
		.trim();
	return `needs permission: ${clean || "unknown"}`;
}

/** PrismaLens's own words for a failed call; never the server's body. */
export function failureText(name: string, e: unknown): string {
	if (e instanceof InsufficientScopeError)
		return `${name}: ${needsPermission(e.requiredScope)} — sign in again`;
	if (e instanceof NeedsSignInError) return `${name}: needs sign-in again`;
	if (e instanceof SdkHttpError)
		return `${name}: the server answered HTTP ${e.status}`;
	if (e instanceof TooLargeError) return `${name}: the answer was too large`;
	if (e instanceof ProtocolError)
		return `${name}: the server refused the call (error ${e.code})`;
	if (
		e instanceof Error &&
		(e.name === "TimeoutError" || /timed? ?out/i.test(e.message))
	)
		return `${name}: no answer within ${CALL_TIMEOUT_MS / 1000} s`;
	return `${name}: the server could not be reached`;
}
