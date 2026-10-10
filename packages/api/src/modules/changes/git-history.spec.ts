// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	commitUrl,
	describeChange,
	type GitChange,
	parseHistory,
} from "./git-history.js";

const change = (over: Partial<GitChange>): GitChange => ({
	sha: "a".repeat(40),
	parents: 1,
	committedAt: new Date("2026-10-09T23:12:00Z"),
	author: "Dev",
	subject: "tune pool size",
	body: "",
	tag: null,
	files: [],
	...over,
});

describe("describeChange", () => {
	it("titles a pull request merge with the request's title", () => {
		expect(
			describeChange(
				change({
					parents: 2,
					subject: "Merge pull request #12 from dev/fix",
					body: "Load notes in one query",
				}),
			),
		).toEqual({ merge: true, pr: 12, title: "Load notes in one query" });
	});

	it("reads a squash merge's number from the subject", () => {
		expect(describeChange(change({ subject: "Fix notes (#41)" }))).toEqual({
			merge: true,
			pr: 41,
			title: "Fix notes (#41)",
		});
	});

	it("reads a merge request number from the body", () => {
		expect(
			describeChange(
				change({
					parents: 2,
					subject: "Merge branch 'fix' into 'main'",
					body: "Fix notes\n\nSee merge request team/api!7",
				}),
			),
		).toEqual({ merge: true, pr: 7, title: "Fix notes" });
	});

	it("leaves a direct commit as a commit", () => {
		expect(describeChange(change({}))).toEqual({
			merge: false,
			pr: null,
			title: "tune pool size",
		});
	});

	it("keeps a local merge's subject when it has no body", () => {
		expect(
			describeChange(change({ parents: 2, subject: "Merge branch 'x'" })),
		).toMatchObject({ merge: true, pr: null, title: "Merge branch 'x'" });
	});
});

describe("commitUrl", () => {
	it("links https and scp-style remotes", () => {
		expect(commitUrl("https://github.com/acme/api.git", "abc")).toBe(
			"https://github.com/acme/api/commit/abc",
		);
		expect(commitUrl("git@gitlab.com:acme/api.git", "abc")).toBe(
			"https://gitlab.com/acme/api/commit/abc",
		);
		expect(commitUrl("https://bitbucket.org/acme/api", "abc")).toBe(
			"https://bitbucket.org/acme/api/commits/abc",
		);
	});

	it("gives none for a host on a port or an unparsable remote", () => {
		expect(commitUrl("https://git.local:8443/acme/api.git", "abc")).toBeNull();
		expect(commitUrl("not a url", "abc")).toBeNull();
	});
});

describe("parseHistory", () => {
	it("splits records, tags and files", () => {
		const out = parseHistory(
			[
				"\x1e",
				["b".repeat(40), "p1 p2", "2026-10-09T23:12:00+00:00", "Dev", "tag: v1.42, tag: latest", "Merge", "Body line"].join("\x1f"),
				"\x1d\n\napi/a.py\nweb/b.js\n",
				"\x1e",
				["c".repeat(40), "p1", "2026-10-09T20:00:00+00:00", "Dev", "", "fix", ""].join("\x1f"),
				"\x1d\n",
			].join(""),
		);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({
			parents: 2,
			tag: "v1.42",
			body: "Body line",
			files: ["api/a.py", "web/b.js"],
		});
		expect(out[1]).toMatchObject({ parents: 1, tag: null, files: [] });
	});
});
