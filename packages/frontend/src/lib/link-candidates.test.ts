// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LinkTarget } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	isLocalUrl,
	linkCandidates,
	linkKey,
	linkify,
} from "./link-candidates";

describe("linkCandidates (#1024)", () => {
	it("extracts path, url, and thread candidates from mixed prose", () => {
		const text =
			"See `src/a.ts:12` and https://github.com/o/r/pull/5. Thread 3f2b1c4d-1111-4222-8333-444455556666 replied; plain prose here.";
		expect(linkCandidates(text)).toEqual([
			{ kind: "path", text: "src/a.ts:12" },
			{ kind: "url", text: "https://github.com/o/r/pull/5" },
			{ kind: "thread", text: "3f2b1c4d-1111-4222-8333-444455556666" },
		]);
	});

	it("skips paths inside fenced code blocks", () => {
		const text = "Before\n```\nsrc/skip.ts:1\n```\nafter src/keep.ts:2";
		expect(linkCandidates(text)).toEqual([
			{ kind: "path", text: "src/keep.ts:2" },
		]);
	});

	it("identifies INC-7 as an incident candidate", () => {
		expect(linkCandidates("Check INC-7 for details")).toEqual([
			{ kind: "incident", text: "INC-7" },
		]);
	});

	it("includes duplicates only once in candidate list", () => {
		const text = "See src/a.ts:12 and again src/a.ts:12";
		expect(linkCandidates(text)).toEqual([
			{ kind: "path", text: "src/a.ts:12" },
		]);
	});
});

describe("linkify (#1024)", () => {
	it("wraps a resolved backticked path with link href", () => {
		const target: LinkTarget = {
			type: "file",
			repo: "repo",
			sha: "abc1234",
			path: "src/a.ts",
			line: 12,
		};
		const resolved = new Map<string, LinkTarget>([["src/a.ts:12", target]]);
		expect(linkify("See `src/a.ts:12` here", resolved)).toBe(
			"See [`src/a.ts:12`](#pl-link:src%2Fa.ts%3A12) here",
		);
	});

	it("leaves unresolved candidates and existing markdown links alone", () => {
		const target: LinkTarget = {
			type: "file",
			repo: "repo",
			sha: "abc1234",
			path: "src/resolved.ts",
		};
		const resolved = new Map<string, LinkTarget>([["src/resolved.ts", target]]);
		const text =
			"See `src/unresolved.ts` and [existing link](https://example.com/page)";
		expect(linkify(text, resolved)).toBe(
			"See `src/unresolved.ts` and [existing link](https://example.com/page)",
		);
	});
});

describe("linkKey (#1024)", () => {
	it("round-trips encoded link key", () => {
		const key = "src/a.ts:12";
		const href = `#pl-link:${encodeURIComponent(key)}`;
		expect(linkKey(href)).toBe(key);
	});
});

describe("isLocalUrl (#1024)", () => {
	it.each([
		["http://localhost:3000/x", true],
		["http://127.0.0.1/", true],
		["https://example.com", false],
	])("isLocalUrl of %s is %s", (url, expected) => {
		expect(isLocalUrl(url)).toBe(expected);
	});
});
