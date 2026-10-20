// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, RunWorkspace } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { deriveSteps } from "@/components/run/run-steps";
import {
	citedFile,
	filesRead,
	locate,
	unavailableSentence,
} from "./evidence-files";

const SHA = "3f2a9c1d4e5b6a7980f1e2d3c4b5a69788796a5b";
const SHA2 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const repo = (name: string, dir: string, head = SHA, subPath: string | null = null) => ({
	name,
	dir,
	sourceKind: "folder" as const,
	url: "/src/x",
	subPath,
	connectionId: null,
	head,
	branch: "main",
	services: [],
});
const single: RunWorkspace = {
	layout: "single",
	cwd: "/data/runs/r1/repo/svc",
	repos: [repo("repo", "/data/runs/r1/repo", SHA, "svc")],
};
const multi: RunWorkspace = {
	layout: "multi",
	cwd: "/data/runs/r1/repos",
	repos: [
		repo("checkout", "/data/runs/r1/repos/checkout"),
		repo("billing", "C:\\data\\runs\\r1\\repos\\billing", SHA2),
	],
};

describe("locate", () => {
	it("maps an absolute path in the run's copy to the repo, its commit and the path from its top", () => {
		expect(locate("/data/runs/r1/repo/svc/src/db/pool.ts", single)).toEqual({
			repo: "repo",
			sha: SHA,
			path: "svc/src/db/pool.ts",
			line: null,
		});
		expect(locate("C:\\data\\runs\\r1\\repos\\billing\\a.go:12", multi)).toEqual({
			repo: "billing",
			sha: SHA2,
			path: "a.go",
			line: 12,
		});
	});

	it("reads a path from the cwd, `repo/…`, `:41`, `:41-50` and `#L41`", () => {
		expect(locate("src/db/pool.ts:41", single)?.path).toBe("svc/src/db/pool.ts");
		expect(locate("repo/src/db/pool.ts:41-50", single)).toMatchObject({
			path: "svc/src/db/pool.ts",
			line: 41,
		});
		expect(locate("checkout/src/pool.ts#L41", multi)).toMatchObject({
			repo: "checkout",
			path: "src/pool.ts",
			line: 41,
		});
	});

	it("is null outside every repo, for traversal, and for a run with no code", () => {
		expect(locate("/etc/passwd", single)).toBeNull();
		expect(locate("../../etc/passwd", single)).toBeNull();
		expect(locate("unknown/a.ts", multi)).toBeNull();
		expect(locate("a.ts", null)).toBeNull();
		expect(locate("a.ts", { layout: "unmapped", cwd: "/x", repos: [] })).toBeNull();
	});
});

describe("citedFile", () => {
	it("finds the file an evidence source names", () => {
		expect(citedFile("src/db/pool.ts:41 (max: 10)", single)).toMatchObject({
			path: "svc/src/db/pool.ts",
			line: 41,
		});
		expect(citedFile("read `config/prod.yaml`", single)?.path).toBe(
			"svc/config/prod.yaml",
		);
		expect(citedFile("kubectl get pods", single)).toBeNull();
	});
});

const RUN = "00000000-0000-4000-8000-000000000001";
let seq = 0;
const read = (id: string, path: string, offset?: number): CanonicalEvent[] => {
	const ts = new Date(Date.UTC(2026, 9, 10, 1, 0, seq)).toISOString();
	const base = { runId: RUN, branchId: "run", path: [], ts };
	return [
		{
			kind: "agent_step",
			...base,
			seq: seq++,
			text: "",
			toolCalls: [{ toolCallId: id, name: "Read", args: { file_path: path, ...(offset ? { offset } : {}) } }],
		},
		{
			kind: "tool_result",
			...base,
			seq: seq++,
			result: { name: "Read", toolCallId: id, source: "Read", ok: true, preview: "x", toolCategory: "file" },
		},
	];
};

describe("filesRead", () => {
	const events = [
		...read("a", "/data/runs/r1/repo/svc/src/db/pool.ts", 40),
		...read("b", "/data/runs/r1/repo/svc/config/prod.yaml"),
		...read("c", "/data/runs/r1/repo/svc/src/db/pool.ts"),
		...read("d", "/home/me/.ssh/id_rsa"),
	];

	it("lists each file once with its read count, in first-read order, skipping files outside the repo", () => {
		const files = filesRead(deriveSteps(events), single);
		expect(files.map((f) => [f.path, f.reads, f.steps, f.line])).toEqual([
			["svc/src/db/pool.ts", 2, [1, 3], 40],
			["svc/config/prod.yaml", 1, [2], null],
		]);
	});

	it("keeps every listed file where it was when new tool calls arrive", () => {
		const before = filesRead(deriveSteps(events), single).map((f) => f.path);
		const after = filesRead(
			deriveSteps([...events, ...read("e", "/data/runs/r1/repo/svc/z.ts"), ...read("f", "/data/runs/r1/repo/svc/src/db/pool.ts")]),
			single,
		).map((f) => f.path);
		expect(after.slice(0, before.length)).toEqual(before);
		expect(after.at(-1)).toBe("svc/z.ts");
	});
});

describe("unavailableSentence", () => {
	it("names each state with the short commit", () => {
		expect(unavailableSentence("commit-gone", SHA)).toContain("3f2a9c1");
		expect(unavailableSentence("not-retained", SHA)).toMatch(/untracked or uncommitted/);
		expect(unavailableSentence("source-removed", SHA)).toMatch(/gone/);
		expect(unavailableSentence("not-a-file", SHA)).toMatch(/folder/);
	});
});
