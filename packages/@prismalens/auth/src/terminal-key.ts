// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The second credential a terminal needs besides the device cookie (#931).
 * Cookies are not port-scoped, so another service on localhost can receive
 * the cookie; it never sees this key, which the API hands out only in the
 * answer to a local redeem and the app keeps in its own origin's storage.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const LABEL = "prismalens terminal key v1:";

export function terminalKeyFor(deviceId: string, secret: string): string {
	if (!secret) throw new Error("A terminal key needs the auth secret.");
	return createHmac("sha256", secret)
		.update(LABEL + deviceId)
		.digest("base64url");
}

export function terminalKeyMatches(
	presented: string | undefined,
	deviceId: string,
	secret: string,
): boolean {
	if (!presented) return false;
	const expected = Buffer.from(terminalKeyFor(deviceId, secret));
	const given = Buffer.from(presented);
	return given.length === expected.length && timingSafeEqual(given, expected);
}
