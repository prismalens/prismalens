// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Session cookie forwarding.
 *
 * Better Auth's HTTP routes (`/api/auth/*`) write their own `Set-Cookie`
 * headers because the node handler owns the response. Anything that signs a
 * user in through `auth.api.*` instead — the setup wizard is the only such
 * caller today — gets the headers as a value and has to put them on the wire
 * itself, or the browser never receives a session at all (#358).
 */

import type { Response } from "express";

/**
 * Copy every `Set-Cookie` header Better Auth produced onto the outgoing
 * response, leaving each cookie's attributes exactly as Better Auth wrote
 * them.
 *
 * Nothing here re-decides `Secure`, `SameSite`, `HttpOnly`, the cookie prefix
 * or the expiry: `Secure` in particular is settled once, in AuthService, from
 * the resolved origin's scheme (#357). A second opinion at this layer is how
 * setup and sign-in would drift apart again.
 *
 * `res` is optional because oRPC hands controllers the express request and
 * `Request.res` is typed as possibly absent; a missing response simply means
 * there is nothing to write to.
 */
export function applySetCookieHeaders(
	from: Headers,
	res: Response | undefined,
): void {
	if (!res) return;
	// `getSetCookie()` is the only correct reader here — `get("set-cookie")`
	// folds multiple cookies into one comma-joined string, and a cookie's own
	// `Expires` attribute contains a comma, so the folded value cannot be split
	// back apart reliably.
	for (const cookie of from.getSetCookie()) {
		res.append("Set-Cookie", cookie);
	}
}
