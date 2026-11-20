// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { withCwdRelativeSources } from "./report-paths.js";

const report = (...sources: string[]) => ({
	summary: "s",
	hypotheses: [{ title: "h", evidence: sources.map((source) => ({ source })) }],
});

describe("withCwdRelativeSources (#1085)", () => {
	it("writes a path inside the run's worktree as the repo-relative path", () => {
		const cwd = "/tmp/pl/workspace/worktrees/pl-1";
		const out = withCwdRelativeSources(
			report(
				`cat ${cwd}/api/routes/books.py`,
				`${cwd}/config/db.yaml:4-9`,
				"git show 03b0db54 -- server/models/hotlink.js",
			),
			cwd,
		);
		expect(out.hypotheses[0]?.evidence.map((e) => e.source)).toEqual([
			"cat api/routes/books.py",
			"config/db.yaml:4-9",
			"git show 03b0db54 -- server/models/hotlink.js",
		]);
	});

	it("reads a Windows cwd with either separator, and a trailing one", () => {
		const out = withCwdRelativeSources(
			report("E:\\ws\\pl-1\\src\\a.ts:3", "E:/ws/pl-1/src/b.ts"),
			"E:\\ws\\pl-1\\",
		);
		expect(out.hypotheses[0]?.evidence.map((e) => e.source)).toEqual([
			"src\\a.ts:3",
			"src/b.ts",
		]);
	});

	it("covers ruled-out evidence too, where a recorded finding lands", () => {
		const out = withCwdRelativeSources(
			{
				hypotheses: [],
				ruledOut: [{ evidence: [{ source: "/w/pl-1/src/token.js:12" }] }],
			},
			"/w/pl-1",
		);
		expect(out.ruledOut?.[0]?.evidence[0]?.source).toBe("src/token.js:12");
	});

	it("leaves a path outside the worktree, and returns the same report when nothing moved", () => {
		const r = report("/etc/hosts", "/tmp/pl/workspace/worktrees/pl-10/x.ts");
		expect(withCwdRelativeSources(r, "/tmp/pl/workspace/worktrees/pl-1")).toBe(r);
	});
});
