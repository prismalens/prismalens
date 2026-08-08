// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Build the URL of one of the API's internal endpoints from the child's base URL.
 *
 * WHY THIS IS NOT `new URL("/internal/...", base)`: a specifier starting with `/`
 * is ROOT-RELATIVE, so it discards the base's path. With a base of
 * `http://host:3931/api` that produced `http://host:3931/internal/...` — and every
 * one of those routes is mapped behind the API's global `api` prefix. The call had
 * never reached a controller.
 *
 * It went unnoticed because there was nothing at that path to answer: the API
 * returned a JSON 404 and the run failed for a plausible-looking reason. `pl up`
 * made it visible — with the SPA served from the same origin, the unmatched GET
 * came back as `index.html` and the child died on `JSON.parse("<!DOCTYPE ...")`.
 */
export function internalUrl(apiBaseUrl: string, path: string): string {
	const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
	return new URL(path.replace(/^\/+/, ""), base).toString();
}
