// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	fetchLatestVersion,
	isNewer,
	noticeFor,
	readCache,
	runMode,
	updateCheckEnabled,
	updateNotice,
	writeCache,
} from "./update-notice.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A HEAD response carrying only the redirect GitHub answers with. */
const redirectTo = (location: string | null, status = 302) =>
	(async () =>
		new Response(null, {
			status,
			headers: location ? { location } : {},
		})) as unknown as typeof fetch;

const TAG_URL = "https://github.com/prismalens/prismalens/releases/tag/v0.5.1";

let workspace: string;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "pl-update-"));
});

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

describe("runMode", () => {
	it("is npm unless a launcher declares otherwise", () => {
		expect(runMode({})).toBe("npm");
		expect(runMode({ PRISMALENS_RUN_MODE: "electron" })).toBe("electron");
	});
});

describe("updateCheckEnabled", () => {
	it("is on for an interactive npm run", () => {
		expect(updateCheckEnabled({}, true)).toBe(true);
	});
	it("is off when stdout is not a TTY", () => {
		expect(updateCheckEnabled({}, false)).toBe(false);
	});
	it("is off under PRISMALENS_UPDATE_CHECK=off", () => {
		expect(updateCheckEnabled({ PRISMALENS_UPDATE_CHECK: "off" }, true)).toBe(
			false,
		);
	});
	it("is off in CI", () => {
		expect(updateCheckEnabled({ CI: "true" }, true)).toBe(false);
		expect(updateCheckEnabled({ CI: "1" }, true)).toBe(false);
		expect(updateCheckEnabled({ CI: "" }, true)).toBe(true);
	});
	it("is off when DO_NOT_TRACK is truthy, on when it is explicitly falsy", () => {
		expect(updateCheckEnabled({ DO_NOT_TRACK: "1" }, true)).toBe(false);
		expect(updateCheckEnabled({ DO_NOT_TRACK: "true" }, true)).toBe(false);
		expect(updateCheckEnabled({ DO_NOT_TRACK: "0" }, true)).toBe(true);
		expect(updateCheckEnabled({ DO_NOT_TRACK: "" }, true)).toBe(true);
	});
	it("is off for an Electron launcher, which updates itself", () => {
		expect(updateCheckEnabled({ PRISMALENS_RUN_MODE: "electron" }, true)).toBe(
			false,
		);
	});
});

describe("fetchLatestVersion", () => {
	it("reads the tag out of the Location header and drops the v", async () => {
		expect(await fetchLatestVersion(redirectTo(TAG_URL))).toBe("0.5.1");
	});
	it("sends a HEAD that is not followed, so no page body is fetched", async () => {
		const calls: RequestInit[] = [];
		const spy = (async (_url: string, init: RequestInit) => {
			calls.push(init);
			return new Response(null, { status: 302, headers: { location: TAG_URL } });
		}) as unknown as typeof fetch;
		await fetchLatestVersion(spy);
		expect(calls[0].method).toBe("HEAD");
		expect(calls[0].redirect).toBe("manual");
		expect(calls[0].body).toBeUndefined();
	});
	it("is null with no Location, an unparseable tag or a network failure", async () => {
		expect(await fetchLatestVersion(redirectTo(null))).toBe(null);
		expect(
			await fetchLatestVersion(
				redirectTo("https://github.com/prismalens/prismalens/releases"),
			),
		).toBe(null);
		expect(
			await fetchLatestVersion(
				redirectTo(
					"https://github.com/prismalens/prismalens/releases/tag/nightly",
				),
			),
		).toBe(null);
		const offline = (async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		expect(await fetchLatestVersion(offline)).toBe(null);
	});
});

describe("the cache file", () => {
	it("round-trips {checkedAt, latest}", () => {
		writeCache(workspace, { checkedAt: 123, latest: "0.5.1" });
		expect(readCache(workspace)).toEqual({ checkedAt: 123, latest: "0.5.1" });
		expect(
			JSON.parse(readFileSync(join(workspace, "update-check.json"), "utf8")),
		).toEqual({ checkedAt: 123, latest: "0.5.1" });
	});
	it("is null when absent, corrupt or the wrong shape", () => {
		expect(readCache(workspace)).toBe(null);
		writeFileSync(join(workspace, "update-check.json"), "not json");
		expect(readCache(workspace)).toBe(null);
		writeFileSync(
			join(workspace, "update-check.json"),
			JSON.stringify({ latest: "0.5.1" }),
		);
		expect(readCache(workspace)).toBe(null);
	});
	it("never throws on an unwritable directory", () => {
		expect(() =>
			writeCache(join(workspace, "does", "not", "exist"), {
				checkedAt: 1,
				latest: null,
			}),
		).not.toThrow();
	});
});

describe("noticeFor", () => {
	it("names the newer version and the install command", () => {
		expect(noticeFor("0.5.1", "0.5.0")).toBe(
			"prismalens 0.5.1 is available (you have 0.5.0): npm install -g prismalens@latest",
		);
	});
	it("says nothing when current or when the cache never learned a version", () => {
		expect(noticeFor("0.5.0", "0.5.0")).toBe(null);
		expect(noticeFor(null, "0.5.0")).toBe(null);
	});
});

describe("updateNotice", () => {
	const enabled = { env: {}, stdoutIsTTY: true };

	it("prints from the cache and does not call the network when it is fresh", async () => {
		writeCache(workspace, { checkedAt: 1_000, latest: "0.5.1" });
		let called = false;
		const spy = (async () => {
			called = true;
			return new Response(null, { status: 302 });
		}) as unknown as typeof fetch;
		const notice = updateNotice({
			...enabled,
			current: "0.5.0",
			workspaceDir: workspace,
			fetchImpl: spy,
			now: 1_000 + DAY_MS - 1,
		});
		await notice.refresh;
		expect(notice.line).toContain("prismalens 0.5.1 is available");
		expect(called).toBe(false);
	});

	it("refreshes once the cache is a day old, without changing this run's line", async () => {
		writeCache(workspace, { checkedAt: 1_000, latest: null });
		const notice = updateNotice({
			...enabled,
			current: "0.5.0",
			workspaceDir: workspace,
			fetchImpl: redirectTo(TAG_URL),
			now: 1_000 + DAY_MS,
		});
		expect(notice.line).toBe(null);
		await notice.refresh;
		expect(readCache(workspace)?.latest).toBe("0.5.1");
	});

	it("says nothing and writes nothing on a first run", async () => {
		const notice = updateNotice({
			...enabled,
			current: "0.5.0",
			workspaceDir: workspace,
			fetchImpl: redirectTo(TAG_URL),
		});
		expect(notice.line).toBe(null);
		await notice.refresh;
		expect(readCache(workspace)?.latest).toBe("0.5.1");
	});

	it("records a failed check so it is not retried until tomorrow", async () => {
		const offline = (async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		const notice = updateNotice({
			...enabled,
			current: "0.5.0",
			workspaceDir: workspace,
			fetchImpl: offline,
		});
		await notice.refresh;
		expect(readCache(workspace)).toMatchObject({ latest: null });
	});

	it("neither prints nor calls the network when suppressed", async () => {
		writeCache(workspace, { checkedAt: 0, latest: "9.9.9" });
		let called = false;
		const spy = (async () => {
			called = true;
			return new Response(null, { status: 302 });
		}) as unknown as typeof fetch;
		for (const [env, isTTY] of [
			[{}, false],
			[{ CI: "true" }, true],
			[{ DO_NOT_TRACK: "1" }, true],
			[{ PRISMALENS_UPDATE_CHECK: "off" }, true],
			[{ PRISMALENS_RUN_MODE: "electron" }, true],
		] as const) {
			const notice = updateNotice({
				current: "0.5.0",
				workspaceDir: workspace,
				env,
				stdoutIsTTY: isTTY,
				fetchImpl: spy,
			});
			await notice.refresh;
			expect(notice.line).toBe(null);
		}
		expect(called).toBe(false);
	});
});
