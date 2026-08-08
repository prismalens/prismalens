// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Security response headers (helmet).
 *
 * The app serves the built SPA and the API from one origin (ADR-0029), so one
 * header policy has to satisfy both a React document and a JSON API.
 *
 * Two deliberate relaxations, both forced by how the SPA is built:
 *
 * 1. **`script-src 'unsafe-inline'`.** TanStack's `<Scripts />` emits inline
 *    hydration/router-state scripts, and the theme pre-paint script is inline by
 *    design (ADR-0029 §1 deleted the cookie server functions in favour of it).
 *    A nonce cannot be applied: Nest serves the SPA as *static files*, so there
 *    is no per-request template pass to stamp one into. `'unsafe-inline'` on
 *    `script-src` is the price of static-file SPA serving.
 * 2. **No `upgrade-insecure-requests`.** helmet's default CSP includes it; on
 *    the plain-HTTP localhost origin `pl up` serves, it rewrites same-origin
 *    subresource requests to `https://` and the page fails to load.
 *
 * `style-src 'unsafe-inline'` is also required — the SPA sets inline styles and
 * Swagger UI at `/api/docs` ships inline `<style>`. Everything else is locked to
 * `'self'`: no external origin can supply script, style, font, image or
 * connection target, and the page cannot be framed at all.
 *
 * HSTS is enabled only when the server actually terminates TLS. Emitting it over
 * plain HTTP is ignored by browsers, but it is also a trap when a deployment
 * later fronts the app on a hostname reached over HTTP.
 */

import helmet from "helmet";

export interface HelmetOptionsInput {
	/** True when this process terminates TLS itself (`PRISMALENS_PROTOCOL=https`). */
	https: boolean;
}

/** Content-Security-Policy directives applied to every response. */
export function contentSecurityPolicyDirectives(): Record<
	string,
	string[] | null
> {
	return {
		"default-src": ["'self'"],
		// See relaxation 1 in the module comment.
		"script-src": ["'self'", "'unsafe-inline'"],
		"style-src": ["'self'", "'unsafe-inline'"],
		"img-src": ["'self'", "data:", "blob:"],
		"font-src": ["'self'", "data:"],
		"connect-src": ["'self'"],
		"worker-src": ["'self'", "blob:"],
		"manifest-src": ["'self'"],
		"object-src": ["'none'"],
		"frame-src": ["'none'"],
		"frame-ancestors": ["'none'"],
		"base-uri": ["'self'"],
		"form-action": ["'self'"],
		// See relaxation 2 in the module comment: `null` removes the directive
		// helmet would otherwise add by default.
		"upgrade-insecure-requests": null,
	};
}

/** Build the configured helmet middleware for the bootstrap to `app.use()`. */
export function createHelmetMiddleware(options: HelmetOptionsInput) {
	return helmet({
		contentSecurityPolicy: {
			useDefaults: true,
			directives: contentSecurityPolicyDirectives(),
		},
		// Only meaningful when this process serves TLS; see the module comment.
		strictTransportSecurity: options.https
			? { maxAge: 15552000, includeSubDomains: true }
			: false,
		// Cross-origin isolation would block the webhook endpoints' deliberate
		// cross-origin reachability and buys nothing for a single-origin SPA.
		crossOriginEmbedderPolicy: false,
		referrerPolicy: { policy: "no-referrer" },
		// helmet defaults this to SAMEORIGIN, which would contradict the CSP's
		// `frame-ancestors 'none'` for browsers that only honour the legacy
		// header. Nothing here is meant to be framed at all.
		xFrameOptions: { action: "deny" },
	});
}
