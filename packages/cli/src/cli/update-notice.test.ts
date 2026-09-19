// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	checkForUpdate,
	isNewer,
	updateCheckEnabled,
} from "./update-notice.js";

const respond = (body: unknown, status = 200) =>
	(async () =>
		new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("isNewer", () => {
	it("compares each part numerically", () => {
		expect(isNewer("0.5.10", "0.5.9")).toBe(true);
		expect(isNewer("0.6.0", "0.5.9")).toBe(true);
		expect(isNewer("1.0.0", "0.9.9")).toBe(true);
	});
	it("is false for equal or older versions", () => {
		expect(isNewer("0.5.0", "0.5.0")).toBe(false);
		expect(isNewer("0.4.9", "0.5.0")).toBe(false);
	});
	it("is false when either side is not a plain x.y.z", () => {
		expect(isNewer("0.6.0-rc.1", "0.5.0")).toBe(false);
		expect(isNewer("0.6.0", "0.0.0-dev")).toBe(false);
	});
});

describe("updateCheckEnabled", () => {
	it("is on unless PRISMALENS_UPDATE_CHECK=off", () => {
		expect(updateCheckEnabled({})).toBe(true);
		expect(updateCheckEnabled({ PRISMALENS_UPDATE_CHECK: "off" })).toBe(false);
	});
});

describe("checkForUpdate", () => {
	it("names the newer version and the install command", async () => {
		expect(await checkForUpdate("0.5.0", respond({ version: "0.5.1" }))).toBe(
			"prismalens 0.5.1 is available (you have 0.5.0): npm install -g prismalens@latest",
		);
	});
	it("says nothing when current", async () => {
		expect(await checkForUpdate("0.5.1", respond({ version: "0.5.1" }))).toBe(
			null,
		);
	});
	it("says nothing on a registry error, bad body or network failure", async () => {
		expect(await checkForUpdate("0.5.0", respond({}, 503))).toBe(null);
		expect(await checkForUpdate("0.5.0", respond({ version: 7 }))).toBe(null);
		const offline = (async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		expect(await checkForUpdate("0.5.0", offline)).toBe(null);
	});
});
