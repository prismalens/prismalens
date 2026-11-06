// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	apiBase,
	parsePrUrl,
	prUrlsIn,
	remoteOf,
	trustedRemote,
} from "./pr-url.js";

describe("parsePrUrl", () => {
	it.each([
		[
			"https://github.com/Acme/Cart/pull/7/files?x=1#y",
			{ shape: "github", repo: "Acme/Cart", number: 7, url: "https://github.com/Acme/Cart/pull/7" },
		],
		[
			"https://gitlab.com/group/sub/proj/-/merge_requests/12",
			{ shape: "gitlab", repo: "group/sub/proj", number: 12 },
		],
		[
			"https://bitbucket.org/team/repo/pull-requests/3",
			{ shape: "other", repo: "team/repo", number: 3 },
		],
	])("reads %s", (url, want) => {
		expect(parsePrUrl(url)).toMatchObject(want);
	});

	it.each([
		"http://github.com/a/b/pull/1",
		"https://user:pw@github.com/a/b/pull/1",
		"https://github.com/a/b/pull/0",
		"https://github.com/a/b/pull/x",
		"https://github.com/a/b/issues/1",
		"https://github.com/a/b%2Fc/pull/1",
		"not a url",
	])("refuses %s", (url) => {
		expect(parsePrUrl(url)).toBeNull();
	});
});

describe("prUrlsIn", () => {
	it("finds each PR once in prose and markdown, trailing punctuation dropped", () => {
		const text =
			"Opened https://github.com/acme/cart/pull/7. See [it](https://github.com/acme/cart/pull/7) and **https://gitlab.com/a/b/-/merge_requests/2**, not https://github.com/acme/cart.";
		expect(prUrlsIn(text).map((p) => p.url)).toEqual([
			"https://github.com/acme/cart/pull/7",
			"https://gitlab.com/a/b/-/merge_requests/2",
		]);
	});
});

describe("trust (#1024 decision 2)", () => {
	const remotes = [
		remoteOf("r1", "https://github.com/Acme/Cart.git"),
		remoteOf("r2", "git@gitlab.example.com:ops/infra.git"),
	].filter((r) => r !== null);

	it("accepts a PR on a configured repository, case-insensitively by repo", () => {
		const pr = parsePrUrl("https://github.com/acme/cart/pull/7");
		expect(pr && trustedRemote(pr, remotes)?.repositoryId).toBe("r1");
		const mr = parsePrUrl("https://gitlab.example.com/ops/infra/-/merge_requests/1");
		expect(mr && trustedRemote(mr, remotes)?.repositoryId).toBe("r2");
	});

	it.each([
		["an unconfigured repo", "https://github.com/acme/other/pull/7"],
		["a look-alike host", "https://github.com.evil.io/acme/cart/pull/7"],
		["a sub-domain", "https://api.github.com/acme/cart/pull/7"],
	])("refuses %s", (_why, url) => {
		const pr = parsePrUrl(url);
		expect(pr && trustedRemote(pr, remotes)).toBeNull();
	});

	it("takes the API origin from the fixed mapping", () => {
		expect(apiBase({ host: "github.com", shape: "github" })).toBe("https://api.github.com");
		expect(apiBase({ host: "ghe.acme.io", shape: "github" })).toBe("https://ghe.acme.io/api/v3");
		expect(apiBase({ host: "gitlab.example.com", shape: "gitlab" })).toBe(
			"https://gitlab.example.com/api/v4",
		);
		expect(apiBase({ host: "bitbucket.org", shape: "other" })).toBeNull();
	});

	it("reads no remote from a path that names no repository", () => {
		expect(remoteOf("x", "/home/me/folder")).toBeNull();
	});
});
