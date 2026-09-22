// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The paired device's credential in the browser: an HttpOnly cookie holding
 * the device token. `SameSite=Lax` keeps a cross-site form POST from carrying
 * it; a non-browser client sends the same token as a Bearer instead.
 */

import type { Request } from "express";

export const DEVICE_COOKIE = "prismalens.device";

/** A year. Validity is revocation, not expiry (ADR 0004 §8). */
const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

export function readCookie(
	cookieHeader: string | undefined,
	name: string,
): string | undefined {
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== name) continue;
		try {
			return decodeURIComponent(part.slice(eq + 1).trim());
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** The device token a request carries, cookie or `Authorization: Bearer`. */
export function readDeviceToken(request: Request): string | undefined {
	const auth = request.headers.authorization;
	if (typeof auth === "string" && /^bearer\s+/i.test(auth)) {
		return auth.replace(/^bearer\s+/i, "").trim() || undefined;
	}
	return readCookie(request.headers.cookie, DEVICE_COOKIE);
}

export function deviceCookieHeader(token: string, secure: boolean): string {
	return [
		`${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${DEVICE_COOKIE_MAX_AGE_S}`,
		...(secure ? ["Secure"] : []),
	].join("; ");
}

export function clearDeviceCookieHeader(secure: boolean): string {
	return [
		`${DEVICE_COOKIE}=`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		"Max-Age=0",
		...(secure ? ["Secure"] : []),
	].join("; ");
}
