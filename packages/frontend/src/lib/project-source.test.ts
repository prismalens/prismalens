// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BrowseFoldersResult } from "@prismalens/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import {
	isGitUrl,
	recentSources,
	rememberSource,
	shownEntries,
	sourceOf,
	splitTyped,
	typedKind,
} from "./project-source";

const listing: BrowseFoldersResult = {
	ok: true,
	path: "/code/shop",
	parent: "/code",
	git: false,
	entries: [
		{ name: ".cache", path: "/code/shop/.cache", hidden: true, git: false },
		{ name: "api", path: "/code/shop/api", hidden: false, git: true },
		{ name: "notes", path: "/code/shop/notes", hidden: false, git: false },
	],
	truncated: false,
};

beforeEach(() => localStorage.clear());

describe("what the Add project dialog shows (#1020)", () => {
	it("lists the folder being typed in, narrowed by the name started", () => {
		expect(splitTyped("/code/shop/no")).toEqual({
			dir: "/code/shop/",
			prefix: "no",
		});
		expect(splitTyped("C:\\code\\")).toEqual({ dir: "C:\\code\\", prefix: "" });
		expect(splitTyped("")).toEqual({ dir: null, prefix: "" });
		expect(shownEntries(listing.ok ? listing.entries : [], "", false).map((e) => e.name)).toEqual(["api", "notes"]);
		expect(shownEntries(listing.ok ? listing.entries : [], ".", false).map((e) => e.name)).toEqual([".cache"]);
		expect(shownEntries(listing.ok ? listing.entries : [], "", true)).toHaveLength(3);
	});

	it("names the kind: a URL is a Remote repo, a git folder a Repo, else a Folder", () => {
		expect(isGitUrl("git@github.com:acme/shop.git")).toBe(true);
		expect(typedKind("https://github.com/acme/shop", undefined, "")).toBe("remote");
		expect(typedKind("/code/shop/api", listing, "api")).toBe("repo");
		expect(typedKind("/code/shop/notes", listing, "notes")).toBe("folder");
		expect(typedKind("/code/shop/nope", listing, "nope")).toBeNull();
		expect(typedKind("/code/shop/", { ...listing, git: true }, "")).toBe("repo");
	});

	it("saves the folder without its trailing separator, but keeps a root", () => {
		expect(sourceOf("/code/shop/")).toBe("/code/shop");
		expect(sourceOf("C:\\code\\")).toBe("C:\\code");
		expect(sourceOf("C:\\")).toBe("C:\\");
		expect(sourceOf("/")).toBe("/");
	});

	it("keeps the five most recent picks, newest first, once each", () => {
		for (const s of ["a", "b", "c", "d", "e", "f", "b"]) rememberSource(s);
		expect(recentSources()).toEqual(["b", "f", "e", "d", "c"]);
	});
});
