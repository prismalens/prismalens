// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
	clearDeviceCookieHeader,
	DEVICE_COOKIE,
	deviceCookieHeader,
	readCookie,
	readDeviceToken,
} from "./device-cookie.js";

function fakeRequest(headers: Record<string, string | undefined>): Request {
	return { headers } as unknown as Request;
}

describe("readCookie", () => {
	it("finds the named cookie among several", () => {
		const header = "theme=dark; user_id=42; session=abc123xyz";
		expect(readCookie(header, "user_id")).toBe("42");
		expect(readCookie(header, "theme")).toBe("dark");
		expect(readCookie(header, "session")).toBe("abc123xyz");
	});

	it("decodes percent-encoding", () => {
		const header = "data=hello%20world%21%3D";
		expect(readCookie(header, "data")).toBe("hello world!=");
	});

	it("returns undefined when absent or malformed", () => {
		expect(readCookie(undefined, "any")).toBeUndefined();
		expect(readCookie("", "any")).toBeUndefined();
		expect(readCookie("foo=bar", "baz")).toBeUndefined();
		expect(
			readCookie("malformed_no_equals", "malformed_no_equals"),
		).toBeUndefined();
		// Malformed percent-encoding causes decodeURIComponent to throw, returning undefined
		expect(readCookie("bad=%E0%A4%A", "bad")).toBeUndefined();
	});
});

describe("readDeviceToken", () => {
	it("prefers a Bearer header (case-insensitive scheme, trimmed) over the cookie", () => {
		const req = fakeRequest({
			authorization: "Bearer token-from-bearer",
			cookie: `${DEVICE_COOKIE}=token-from-cookie`,
		});
		expect(readDeviceToken(req)).toBe("token-from-bearer");

		// Case-insensitive scheme and trimmed
		const reqCase = fakeRequest({
			authorization: "bEaReR    token-trimmed-case    ",
			cookie: `${DEVICE_COOKIE}=token-from-cookie`,
		});
		expect(readDeviceToken(reqCase)).toBe("token-trimmed-case");
	});

	it("falls back to the prismalens.device cookie", () => {
		const req = fakeRequest({
			cookie: `other=foo; ${DEVICE_COOKIE}=token-from-cookie; another=bar`,
		});
		expect(readDeviceToken(req)).toBe("token-from-cookie");
	});

	it("returns undefined with neither", () => {
		expect(readDeviceToken(fakeRequest({}))).toBeUndefined();
		expect(
			readDeviceToken(
				fakeRequest({
					authorization: "Basic dXNlcjpwYXNz",
					cookie: "other=val",
				}),
			),
		).toBeUndefined();
		expect(
			readDeviceToken(
				fakeRequest({
					authorization: "Bearer   ",
				}),
			),
		).toBeUndefined();
	});
});

describe("deviceCookieHeader & clearDeviceCookieHeader", () => {
	it("deviceCookieHeader carries HttpOnly, SameSite=Lax, Path=/, a one-year Max-Age, and Secure only when asked", () => {
		const headerInsecure = deviceCookieHeader("test-token-123", false);
		expect(headerInsecure).toContain(`${DEVICE_COOKIE}=test-token-123`);
		expect(headerInsecure).toContain("Path=/");
		expect(headerInsecure).toContain("HttpOnly");
		expect(headerInsecure).toContain("SameSite=Lax");
		expect(headerInsecure).toContain("Max-Age=31536000"); // 365 * 24 * 60 * 60
		expect(headerInsecure).not.toContain("Secure");

		const headerSecure = deviceCookieHeader("test-token-123", true);
		expect(headerSecure).toContain(`${DEVICE_COOKIE}=test-token-123`);
		expect(headerSecure).toContain("Path=/");
		expect(headerSecure).toContain("HttpOnly");
		expect(headerSecure).toContain("SameSite=Lax");
		expect(headerSecure).toContain("Max-Age=31536000");
		expect(headerSecure).toContain("Secure");
	});

	it("clearDeviceCookieHeader has Max-Age=0", () => {
		const clearInsecure = clearDeviceCookieHeader(false);
		expect(clearInsecure).toContain(`${DEVICE_COOKIE}=`);
		expect(clearInsecure).toContain("Path=/");
		expect(clearInsecure).toContain("HttpOnly");
		expect(clearInsecure).toContain("SameSite=Lax");
		expect(clearInsecure).toContain("Max-Age=0");
		expect(clearInsecure).not.toContain("Secure");

		const clearSecure = clearDeviceCookieHeader(true);
		expect(clearSecure).toContain("Max-Age=0");
		expect(clearSecure).toContain("Secure");
	});
});
