// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The paired device's credential in the browser: an HttpOnly cookie holding
 * the device token. `SameSite=Lax` keeps a cross-site form POST from carrying
 * it; a non-browser client sends the same token as a Bearer instead.
 *
 * The cookie is named per instance (`deviceCookieName`), because cookies are
 * scoped by host and not by port (#763).
 */

import type { Request } from "express";

/** A year. Validity is revocation, not expiry (ADR 0004 §8). */
const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

export interface DeviceCredential {
	token: string;
	via: "bearer" | "cookie";
}

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

/**
 * The device token a request carries: `Authorization: Bearer`, else this
 * instance's cookie.
 */
export function readDeviceCredential(
	request: Request,
	cookieName: string,
): DeviceCredential | undefined {
	const auth = request.headers.authorization;
	if (typeof auth === "string" && /^bearer\s+/i.test(auth)) {
		const token = auth.replace(/^bearer\s+/i, "").trim();
		return token ? { token, via: "bearer" } : undefined;
	}
	const own = readCookie(request.headers.cookie, cookieName);
	return own ? { token: own, via: "cookie" } : undefined;
}

export function deviceCookieHeader(
	name: string,
	token: string,
	secure: boolean,
): string {
	return [
		`${name}=${encodeURIComponent(token)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${DEVICE_COOKIE_MAX_AGE_S}`,
		...(secure ? ["Secure"] : []),
	].join("; ");
}

export function clearDeviceCookieHeader(name: string, secure: boolean): string {
	return [
		`${name}=`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		"Max-Age=0",
		...(secure ? ["Secure"] : []),
	].join("; ");
}
