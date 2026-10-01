// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { deviceCookieName } from "@prismalens/auth";
import {
	clearDeviceCookieHeader,
	deviceCookieHeader,
	readCookie,
	readDeviceCredential,
} from "./device-cookie.js";

const OWN = deviceCookieName("3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b");

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

describe("deviceCookieName (#763)", () => {
	it("is the prefix plus the first 12 hex chars of the id, dashes dropped", () => {
		expect(OWN).toBe("prismalens.device.3f1c2a4b5d6e");
	});
});

describe("readDeviceCredential", () => {
	it("prefers a Bearer header (case-insensitive scheme, trimmed) over the cookie", () => {
		const req = fakeRequest({
			authorization: "Bearer token-from-bearer",
			cookie: `${OWN}=token-from-cookie`,
		});
		expect(readDeviceCredential(req, OWN)).toEqual({
			token: "token-from-bearer",
			via: "bearer",
		});

		const reqCase = fakeRequest({
			authorization: "bEaReR    token-trimmed-case    ",
			cookie: `${OWN}=token-from-cookie`,
		});
		expect(readDeviceCredential(reqCase, OWN)?.token).toBe(
			"token-trimmed-case",
		);
	});

	it("reads this instance's cookie, not another instance's", () => {
		const req = fakeRequest({
			cookie: `other=foo; prismalens.device.aaaaaaaaaaaa=theirs; ${OWN}=ours; another=bar`,
		});
		expect(readDeviceCredential(req, OWN)).toEqual({
			token: "ours",
			via: "cookie",
		});
		expect(
			readDeviceCredential(
				fakeRequest({ cookie: "prismalens.device.aaaaaaaaaaaa=theirs" }),
				OWN,
			),
		).toBeUndefined();
	});

	it("ignores the bare prismalens.device cookie", () => {
		expect(
			readDeviceCredential(fakeRequest({ cookie: "prismalens.device=old" }), OWN),
		).toBeUndefined();
	});

	it("returns undefined with neither", () => {
		expect(readDeviceCredential(fakeRequest({}), OWN)).toBeUndefined();
		expect(
			readDeviceCredential(
				fakeRequest({
					authorization: "Basic dXNlcjpwYXNz",
					cookie: "other=val",
				}),
				OWN,
			),
		).toBeUndefined();
		expect(
			readDeviceCredential(fakeRequest({ authorization: "Bearer   " }), OWN),
		).toBeUndefined();
	});
});

describe("deviceCookieHeader & clearDeviceCookieHeader", () => {
	it("deviceCookieHeader carries HttpOnly, SameSite=Lax, Path=/, a one-year Max-Age, and Secure only when asked", () => {
		const headerInsecure = deviceCookieHeader(OWN, "test-token-123", false);
		expect(headerInsecure).toContain(`${OWN}=test-token-123`);
		expect(headerInsecure).toContain("Path=/");
		expect(headerInsecure).toContain("HttpOnly");
		expect(headerInsecure).toContain("SameSite=Lax");
		expect(headerInsecure).toContain("Max-Age=31536000"); // 365 * 24 * 60 * 60
		expect(headerInsecure).not.toContain("Secure");

		const headerSecure = deviceCookieHeader(OWN, "test-token-123", true);
		expect(headerSecure).toContain(`${OWN}=test-token-123`);
		expect(headerSecure).toContain("Secure");
	});

	it("clearDeviceCookieHeader has Max-Age=0", () => {
		const clearInsecure = clearDeviceCookieHeader(OWN, false);
		expect(clearInsecure.startsWith(`${OWN}=;`)).toBe(true);
		expect(clearInsecure).toContain("Path=/");
		expect(clearInsecure).toContain("HttpOnly");
		expect(clearInsecure).toContain("SameSite=Lax");
		expect(clearInsecure).toContain("Max-Age=0");
		expect(clearInsecure).not.toContain("Secure");

		const clearSecure = clearDeviceCookieHeader(OWN, true);
		expect(clearSecure).toContain("Max-Age=0");
		expect(clearSecure).toContain("Secure");
	});
});
