// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	fetchLatestVersion,
	isExactVersion,
	readCache,
	refreshUpdateCache,
} from "./update-check.js";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`prismalens-update-check-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("fetchLatestVersion", () => {
	it("fetches nightly version from npm dist-tags URL and picks the higher tag", async () => {
		const requestedUrls: string[] = [];
		const fakeFetch = (async (url: string | URL | Request) => {
			requestedUrls.push(String(url));
			return {
				ok: true,
				json: async () => ({
					latest: "0.5.3",
					nightly: "0.5.4-nightly.20261111.7",
				}),
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "nightly");
		expect(version).toBe("0.5.4-nightly.20261111.7");
		expect(requestedUrls).toEqual([
			"https://registry.npmjs.org/-/package/prismalens/dist-tags",
		]);
	});

	it("picks stable when latest is higher than nightly in dist-tags", async () => {
		const fakeFetch = (async () => {
			return {
				ok: true,
				json: async () => ({
					latest: "0.5.4",
					nightly: "0.5.4-nightly.20261111.7",
				}),
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "nightly");
		expect(version).toBe("0.5.4");
	});

	it("returns null when dist-tags returns 500 response", async () => {
		const fakeFetch = (async () => {
			return {
				ok: false,
				status: 500,
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "nightly");
		expect(version).toBe(null);
	});

	it("returns null when fetch throws", async () => {
		const fakeFetch = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "nightly");
		expect(version).toBe(null);
	});

	it("falls back to latest when nightly dist-tag is garbage", async () => {
		const fakeFetch = (async () => {
			return {
				ok: true,
				json: async () => ({
					nightly: "garbage",
					latest: "0.5.3",
				}),
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "nightly");
		expect(version).toBe("0.5.3");
	});

	it("returns null for stable when Location is a prerelease like v0.6.0-rc.1", async () => {
		const fakeFetch = (async () => {
			return {
				headers: {
					get: (name: string) =>
						name.toLowerCase() === "location"
							? "https://github.com/prismalens/prismalens/releases/tag/v0.6.0-rc.1"
							: null,
				},
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "stable");
		expect(version).toBe(null);
	});

	it("returns version for stable when Location is a plain release like v0.6.0", async () => {
		const fakeFetch = (async () => {
			return {
				headers: {
					get: (name: string) =>
						name.toLowerCase() === "location"
							? "https://github.com/prismalens/prismalens/releases/tag/v0.6.0"
							: null,
				},
			} as unknown as Response;
		}) as unknown as typeof fetch;

		const version = await fetchLatestVersion(fakeFetch, "stable");
		expect(version).toBe("0.6.0");
	});
});

describe("readCache channel isolation", () => {
	it("isolates nightly cache from stable reads and handles unversioned caches", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(
				join(dir, "update-check.json"),
				JSON.stringify({
					checkedAt: 1,
					latest: "0.5.4-nightly.20261111.7",
					channel: "nightly",
				}),
				"utf8",
			);

			expect(readCache(dir)).toBe(null);
			expect(readCache(dir, "nightly")).toEqual({
				checkedAt: 1,
				latest: "0.5.4-nightly.20261111.7",
				channel: "nightly",
			});

			writeFileSync(
				join(dir, "update-check.json"),
				JSON.stringify({
					checkedAt: 2,
					latest: "0.5.3",
				}),
				"utf8",
			);

			expect(readCache(dir)).toEqual({
				checkedAt: 2,
				latest: "0.5.3",
			});
			expect(readCache(dir, "nightly")).toBe(null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("refreshUpdateCache", () => {
	it("writes nightly cache and never requests SHA256SUMS", async () => {
		const dir = makeTmpDir();
		try {
			const requestedUrls: string[] = [];
			const fakeFetch = (async (url: string | URL | Request) => {
				requestedUrls.push(String(url));
				return {
					ok: true,
					json: async () => ({
						latest: "0.5.3",
						nightly: "0.5.4-nightly.20261111.7",
					}),
				} as unknown as Response;
			}) as unknown as typeof fetch;

			await refreshUpdateCache(dir, fakeFetch, 1000, "nightly");

			const raw = readFileSync(join(dir, "update-check.json"), "utf8");
			expect(raw).toBe(
				'{"checkedAt":1000,"latest":"0.5.4-nightly.20261111.7","channel":"nightly"}\n',
			);

			expect(requestedUrls).toEqual([
				"https://registry.npmjs.org/-/package/prismalens/dist-tags",
			]);
			expect(requestedUrls.some((u) => u.includes("SHA256SUMS"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("isExactVersion", () => {
	it("validates exact semver representations correctly", () => {
		expect(isExactVersion("0.5.4-nightly.20261111.7")).toBe(true);
		expect(isExactVersion("v0.5.4")).toBe(false);
		expect(isExactVersion("0.5.4-nightly.01")).toBe(false);
		expect(isExactVersion("0.5")).toBe(false);
	});
});
