// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The paired device's credential in the browser: an HttpOnly cookie holding
 * the device token. `SameSite=Lax` keeps a cross-site form POST from carrying
 * it; a non-browser client sends the same token as a Bearer instead.
 *
 * The cookie is named per instance (`deviceCookieName`), because cookies are
 * scoped by host and not by port (#763). A 0.5.0 browser still holds the bare
 * `prismalens.device`; it is accepted until `whoami` moves it to the new name.
 */

import { DEVICE_COOKIE_PREFIX } from "@prismalens/auth";
import type { Request } from "express";

/** The 0.5.0 cookie name, read only to upgrade it. */
export const LEGACY_DEVICE_COOKIE = DEVICE_COOKIE_PREFIX;

/** A year. Validity is revocation, not expiry (ADR 0004 §8). */
const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

export interface DeviceCredential {
	token: string;
	via: "bearer" | "cookie" | "legacy-cookie";
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
 * instance's cookie, else the 0.5.0 cookie.
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
	if (own) return { token: own, via: "cookie" };
	const legacy = readCookie(request.headers.cookie, LEGACY_DEVICE_COOKIE);
	return legacy ? { token: legacy, via: "legacy-cookie" } : undefined;
}

/** Every `prismalens.device*` cookie on the request other than `keep`. */
export function otherDeviceCookieNames(
	cookieHeader: string | undefined,
	keep: string,
): string[] {
	if (!cookieHeader) return [];
	const names = new Set<string>();
	for (const part of cookieHeader.split(";")) {
		const name = part.slice(0, Math.max(part.indexOf("="), 0)).trim();
		if (
			name !== keep &&
			(name === DEVICE_COOKIE_PREFIX ||
				name.startsWith(`${DEVICE_COOKIE_PREFIX}.`))
		) {
			names.add(name);
		}
	}
	return [...names];
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
