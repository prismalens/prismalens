// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	formatRepoSource,
	shortenPath,
} from "./source-formatter";

describe("source-formatter", () => {
	describe("shortenPath", () => {
		it("leaves short paths unchanged", () => {
			expect(shortenPath("/short/path", 24)).toBe("/short/path");
			expect(shortenPath("book-metadata", 24)).toBe("book-metadata");
		});

		it("shortens longer paths from the left preserving trailing segments", () => {
			expect(
				shortenPath(
					"/home/sumit/sources/prismalens-org/prismalens/fixtures/booklogr",
					24,
				),
			).toBe("…/fixtures/booklogr");
		});

		it("falls back to character truncation when even the last segment is longer than maxLength", () => {
			expect(
				shortenPath("/home/user/verylongdirectorynamethatexceeds24characters", 24),
			).toBe("…thatexceeds24characters");
		});
	});

	describe("formatRepoSource", () => {
		it("formats a local folder with folder kind, shortened path, and full path in title", () => {
			const formatted = formatRepoSource({
				sourceKind: "folder",
				fullName: "booklogr",
				url: "/home/sumit/sources/prismalens-org/prismalens/fixtures/booklogr",
			});
			expect(formatted).toEqual({
				kind: "folder",
				label: "…/fixtures/booklogr",
				title: "/home/sumit/sources/prismalens-org/prismalens/fixtures/booklogr",
			});
		});

		it("formats a git URL with url kind, host/owner/repo label, and full URL in title", () => {
			const formatted = formatRepoSource({
				sourceKind: "url",
				fullName: "Mozzo1000/booklogr",
				url: "https://github.com/Mozzo1000/booklogr.git",
			});
			expect(formatted).toEqual({
				kind: "url",
				label: "github.com/Mozzo1000/booklogr",
				title: "https://github.com/Mozzo1000/booklogr.git",
			});
		});

		it("formats an ssh/git git URL correctly", () => {
			const formatted = formatRepoSource({
				sourceKind: "url",
				fullName: "Mozzo1000/booklogr",
				url: "git@github.com:Mozzo1000/booklogr.git",
			});
			expect(formatted).toEqual({
				kind: "url",
				label: "github.com/Mozzo1000/booklogr",
				title: "git@github.com:Mozzo1000/booklogr.git",
			});
		});

		it("infers folder sourceKind from absolute path if sourceKind is not specified", () => {
			const formatted = formatRepoSource({
				url: "/Users/dev/projects/api",
			});
			expect(formatted.kind).toBe("folder");
			expect(formatted.title).toBe("/Users/dev/projects/api");
		});
	});
});
