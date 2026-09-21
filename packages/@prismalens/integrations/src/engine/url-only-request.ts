// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthenticatedRequestFn } from "../providers/types.js";

/**
 * URL-only authenticated request function (#633).
 * Reaches an unauthenticated endpoint directly without routing through AuthManager.
 */
export function urlOnlyRequestFn(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): AuthenticatedRequestFn {
	return (method, path, options) => {
		// Relative to the base path, so a reverse-proxy prefix (http://host/prometheus) survives.
		const targetUrl = new URL(
			path.replace(/^\/+/, ""),
			baseUrl.replace(/\/?$/, "/"),
		).href;
		return fetchImpl(targetUrl, {
			method,
			headers: options?.headers,
			body: options?.body,
			signal: AbortSignal.timeout(10_000),
		});
	};
}
