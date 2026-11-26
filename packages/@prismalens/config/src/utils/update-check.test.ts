// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import {
	fetchLatestVersion,
	refreshAgentReleases,
	isExactVersion,
	readCache,
	refreshUpdateCache,
	releaseReady,
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
	const releases = (list: unknown) =>
		(async (url: string | URL | Request) => {
			requested.push(String(url));
			return { ok: true, json: async () => list } as unknown as Response;
		}) as unknown as typeof fetch;
	const requested: string[] = [];

	it("reads nightlies from GitHub's releases, not npm (#717)", async () => {
		const version = await fetchLatestVersion(
			releases([{ tag_name: "v0.5.5", draft: false, assets: [{ name: "SHA256SUMS" }] }, { tag_name: "v0.5.6-nightly.20261117.12", draft: false, assets: [{ name: "SHA256SUMS" }] }, { tag_name: "v0.5.6-nightly.20261118.13", draft: true, assets: [{ name: "SHA256SUMS" }] }, { tag_name: "v0.5.6-nightly.20261119.14", draft: false, assets: [] }, { tag_name: "v0.5.0-rc.3", draft: false, assets: [{ name: "SHA256SUMS" }] }]),
			"nightly",
		);
		expect(version).toBe("0.5.6-nightly.20261117.12");
		expect(requested.at(-1)).toBe("https://api.github.com/repos/prismalens/prismalens/releases?per_page=30");
	});

	it("picks a stable release once it overtakes the newest nightly", async () => {
		expect(await fetchLatestVersion(releases([{ tag_name: "v0.5.6", draft: false, assets: [{ name: "SHA256SUMS" }] }, { tag_name: "v0.5.6-nightly.20261117.12", draft: false, assets: [{ name: "SHA256SUMS" }] }]), "nightly")).toBe("0.5.6");
	});

	it("returns null when the releases call fails or throws", async () => {
		const failing = (async () => ({ ok: false, status: 403 }) as unknown as Response) as unknown as typeof fetch;
		expect(await fetchLatestVersion(failing, "nightly")).toBe(null);
		const throwing = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		expect(await fetchLatestVersion(throwing, "nightly")).toBe(null);
		expect(await fetchLatestVersion(releases([{ tag_name: "garbage", draft: false, assets: [{ name: "SHA256SUMS" }] }]), "nightly")).toBe(null);
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
					json: async () => [
						{ tag_name: "v0.5.3", draft: false, assets: [{ name: "SHA256SUMS" }] },
						{ tag_name: "v0.5.4-nightly.20261111.7", draft: false, assets: [{ name: "SHA256SUMS" }] },
					],
				} as unknown as Response;
			}) as unknown as typeof fetch;

			await refreshUpdateCache(dir, fakeFetch, 1000, "nightly");

			const raw = readFileSync(join(dir, "update-check.json"), "utf8");
			expect(raw).toBe(
				'{"checkedAt":1000,"latest":"0.5.4-nightly.20261111.7","channel":"nightly"}\n',
			);

			expect(requestedUrls).toEqual([
				"https://api.github.com/repos/prismalens/prismalens/releases?per_page=30",
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

describe("releaseReady (#717)", () => {
	it("asks the mirror npm's launcher downloads from, file: or https:, with its credentials as a header", async () => {
		const dir = makeTmpDir();
		try {
			mkdirSync(join(dir, "v0.5.7-nightly.20261117.1"));
			writeFileSync(join(dir, "v0.5.7-nightly.20261117.1", "SHA256SUMS"), "");
			const env = { PRISMALENS_RELEASE_BASE_URL: pathToFileURL(dir).href };
			expect(await releaseReady("0.5.7-nightly.20261117.1", fetch, env)).toBe(true);
			expect(await releaseReady("0.5.8", fetch, env)).toBe(false);
			const seen: { url: string; auth?: string }[] = [];
			const fakeFetch = (async (url: string, init: RequestInit) => {
				seen.push({ url: String(url), auth: (init.headers as Record<string, string>).authorization });
				return new Response(null, { status: 200 });
			}) as unknown as typeof fetch;
			expect(
				await releaseReady("0.5.7", fakeFetch, { PRISMALENS_RELEASE_BASE_URL: "https://bot:tok@mirror.corp/gh/" }),
			).toBe(true);
			expect(seen).toEqual([
				{ url: "https://mirror.corp/gh/v0.5.7/SHA256SUMS", auth: `Basic ${Buffer.from("bot:tok").toString("base64")}` },
			]);
			expect(await releaseReady("0.5.7", fakeFetch, { PRISMALENS_RELEASE_BASE_URL: "http://mirror.corp" })).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("refreshAgentReleases (#1180)", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const npm = (version: string) => {
		const urls: string[] = [];
		const fetchImpl = (async (url: string | URL | Request) => {
			urls.push(String(url));
			return new Response(JSON.stringify({ version }), { status: 200 });
		}) as typeof fetch;
		return { urls, fetchImpl };
	};

	it("fetches nothing while Check for updates is off", async () => {
		const { urls, fetchImpl } = npm("0.200.0");
		const cache = { "@openai/codex": { checkedAt: 0, latest: "0.171.0" } };
		const next = await refreshAgentReleases(["@openai/codex"], cache, {
			enabled: false,
			now: 10 * DAY,
			fetchImpl,
		});
		expect(urls).toEqual([]);
		expect(next).toBe(cache);
	});

	it("reads each package's latest from the npm registry once a day", async () => {
		const { urls, fetchImpl } = npm("0.200.0");
		const next = await refreshAgentReleases(
			["@openai/codex", "@google/gemini-cli", "@openai/codex"],
			{ "@google/gemini-cli": { checkedAt: DAY, latest: "0.70.0" } },
			{ enabled: true, now: DAY + DAY - 1, fetchImpl },
		);
		expect(urls).toEqual(["https://registry.npmjs.org/@openai/codex/latest"]);
		expect(next).toEqual({
			"@openai/codex": { checkedAt: 2 * DAY - 1, latest: "0.200.0" },
			"@google/gemini-cli": { checkedAt: DAY, latest: "0.70.0" },
		});
	});

	it("reads a package again once its entry is a day old", async () => {
		const { urls, fetchImpl } = npm("0.200.0");
		const next = await refreshAgentReleases(
			["@google/gemini-cli"],
			{ "@google/gemini-cli": { checkedAt: DAY, latest: "0.70.0" } },
			{ enabled: true, now: 2 * DAY, fetchImpl },
		);
		expect(urls).toEqual([
			"https://registry.npmjs.org/@google/gemini-cli/latest",
		]);
		expect(next).toEqual({
			"@google/gemini-cli": { checkedAt: 2 * DAY, latest: "0.200.0" },
		});
	});

	it.each([
		["refused", 403, '{"version":"1.2.3"}'],
		["malformed", 200, "{}"],
	])("a %s answer records null", async (_, status, body) => {
		const fetchImpl = (async () =>
			new Response(body, { status })) as unknown as typeof fetch;
		const next = await refreshAgentReleases(["opencode-ai"], {}, {
			enabled: true,
			now: 5,
			fetchImpl,
		});
		expect(next).toEqual({ "opencode-ai": { checkedAt: 5, latest: null } });
	});
});
