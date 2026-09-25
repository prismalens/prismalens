// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { availableUpdate, isNewer, updateCheckEnabled } from "./updates.js";

/** A fetch that answers HEADs from a url → [status, location] table. */
function fakeFetch(table: Record<string, [number, string?]>): typeof fetch {
	return (async (url: string | URL) => {
		const [status, location] = table[String(url)] ?? [404];
		return new Response(null, {
			status,
			headers: location ? { location } : {},
		});
	}) as typeof fetch;
}

const LATEST = "https://github.com/prismalens/prismalens/releases/latest";
const SUMS = (v: string) =>
	`https://github.com/prismalens/prismalens/releases/download/v${v}/SHA256SUMS`;
const TAG = (v: string) =>
	`https://github.com/prismalens/prismalens/releases/tag/v${v}`;

describe("availableUpdate", () => {
	it("announces a newer release once its downloads are attached", async () => {
		const f = fakeFetch({ [LATEST]: [302, TAG("0.5.2")], [SUMS("0.5.2")]: [302] });
		expect(await availableUpdate("0.5.1", f)).toBe("0.5.2");
	});
	it("waits while the downloads are still being built", async () => {
		const f = fakeFetch({ [LATEST]: [302, TAG("0.5.2")] });
		expect(await availableUpdate("0.5.1", f)).toBe(null);
	});
	it("says nothing when current, or when GitHub can't be read", async () => {
		expect(
			await availableUpdate("0.5.2", fakeFetch({ [LATEST]: [302, TAG("0.5.2")] })),
		).toBe(null);
		expect(await availableUpdate("0.5.1", fakeFetch({}))).toBe(null);
	});
});

describe("update check switches", () => {
	it("is off under PRISMALENS_UPDATE_CHECK=off or DO_NOT_TRACK", () => {
		expect(updateCheckEnabled({})).toBe(true);
		expect(updateCheckEnabled({ PRISMALENS_UPDATE_CHECK: "off" })).toBe(false);
		expect(updateCheckEnabled({ DO_NOT_TRACK: "1" })).toBe(false);
		expect(updateCheckEnabled({ DO_NOT_TRACK: "0" })).toBe(true);
	});
	it("compares plain versions only", () => {
		expect(isNewer("0.5.10", "0.5.9")).toBe(true);
		expect(isNewer("0.5.1", "0.5.1")).toBe(false);
		expect(isNewer("0.6.0-rc.1", "0.5.1")).toBe(false);
	});
});
