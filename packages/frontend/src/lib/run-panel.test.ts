// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspace } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { RunStep } from "@/components/run/run-steps";
import {
	fileFromParam,
	fileParam,
	panelTab,
	splitPatch,
	touchedFiles,
} from "./run-panel";

const SHA = "a".repeat(40);
const B = "b".repeat(40);

const single: RunWorkspace = {
	layout: "single",
	cwd: "/w/pl-1",
	repos: [
		{
			name: "repo",
			dir: "/w/pl-1",
			sourceKind: "folder",
			url: "/src/checkout",
			subPath: null,
			connectionId: null,
			head: SHA,
			branch: "main",
			services: ["checkout"],
		},
	],
};

const multi: RunWorkspace = {
	layout: "multi",
	cwd: "/w/pl-2",
	repos: [
		{ ...(single.repos[0] as RunWorkspace["repos"][number]), name: "api", dir: "/w/pl-2/api" },
		{
			...(single.repos[0] as RunWorkspace["repos"][number]),
			name: "web",
			dir: "/w/pl-2/web",
			head: B,
		},
	],
};

function step(n: number, verb: string, path: string, line?: number): RunStep {
	return {
		n,
		callId: `c${n}`,
		title: path,
		command: path,
		kind: "file",
		verb,
		ok: true,
		unfinished: false,
		output: null,
		at: new Date(0).toISOString(),
		took: null,
		input: null,
		path,
		line: line ?? null,
	};
}

describe("fileParam / fileFromParam", () => {
	it("round-trips a file with its cited range, including a name with no extension", () => {
		for (const f of [
			{ repo: "repo", sha: SHA, path: "src/payments/client.ts", line: 41, end: 44 },
			{ repo: "repo", sha: SHA, path: "Dockerfile", line: null, end: null },
		]) {
			expect(fileFromParam(fileParam(f), single)).toEqual(f);
		}
	});

	it("resolves the commit from the run, never from the URL", () => {
		expect(fileFromParam("web:src/app.ts", multi)).toEqual({
			repo: "web",
			sha: B,
			path: "src/app.ts",
			line: null,
			end: null,
		});
	});

	it.each(["nope:src/a.ts", "repo:../etc/passwd", "repo:/etc/passwd", "repo:", "plain"])(
		"refuses %j",
		(p) => {
			expect(fileFromParam(p, single)).toBeNull();
		},
	);
});

describe("panelTab", () => {
	it("accepts the five tabs and nothing else", () => {
		for (const t of ["summary", "files", "changes", "steps", "context"])
			expect(panelTab(t)).toBe(t);
		expect(panelTab("evidence")).toBeUndefined();
		expect(panelTab(3)).toBeUndefined();
	});
});

describe("touchedFiles", () => {
	it("lists each file once with the strongest mark: cited, then edited or wrote, then read", () => {
		const rows = touchedFiles(
			[
				step(1, "Read", "src/a.ts", 3),
				step(2, "Edited", "src/a.ts"),
				step(3, "Read", "src/b.ts", 10),
				step(4, "Read", "/elsewhere/c.ts"),
			],
			single,
			[{ repo: "repo", sha: SHA, path: "src/b.ts", line: 12, end: 14 }],
		);
		expect(rows).toEqual([
			{
				path: "src/a.ts",
				mark: "Edited",
				file: { repo: "repo", sha: SHA, path: "src/a.ts", line: 3, end: 3 },
			},
			{
				path: "src/b.ts",
				mark: "Cited",
				file: { repo: "repo", sha: SHA, path: "src/b.ts", line: 12, end: 14 },
			},
		]);
	});

	it("puts each repo's files under its name when the run has several", () => {
		const rows = touchedFiles([step(1, "Read", "web/src/app.ts")], multi, []);
		expect(rows.map((r) => r.path)).toEqual(["web/src/app.ts"]);
	});
});

describe("splitPatch", () => {
	it("splits a multi-file patch at each file header and names each file", () => {
		const patch = [
			"diff --git a/a.ts b/a.ts",
			"index 1..2 100644",
			"--- a/a.ts",
			"+++ b/a.ts",
			"@@ -1 +1 @@",
			"-x",
			"+y",
			"diff --git a/old.ts b/new.ts",
			"similarity index 90%",
			"rename from old.ts",
			"rename to new.ts",
			"",
		].join("\n");
		const files = splitPatch(patch);
		expect(files.map((f) => [f.path, f.oldPath])).toEqual([
			["a.ts", null],
			["new.ts", "old.ts"],
		]);
		expect(files[0]?.text.startsWith("diff --git a/a.ts b/a.ts")).toBe(true);
		expect(files[0]?.text).toContain("+y");
		expect(files[1]?.text).not.toContain("+y");
	});
});
