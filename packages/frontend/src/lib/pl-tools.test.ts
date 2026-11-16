// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { plArgsLine, plLabel, plSummary } from "./pl-tools";
import { editStat, turnSummary } from "./turn-summary";
import { PL_TOOLS } from "@prismalens/contracts";

describe("plLabel (#1101)", () => {
	it("maps plLabel with running, done, and failed states with subject", () => {
		expect(
			plLabel("pl_thread_start", { title: "Investigate DB leak" }, "running"),
		).toBe("Starting thread “Investigate DB leak”");
		expect(
			plLabel("pl_thread_start", { title: "Investigate DB leak" }, "done"),
		).toBe("Started thread “Investigate DB leak”");
		expect(
			plLabel("pl_thread_start", { title: "Investigate DB leak" }, "failed"),
		).toBe("Started thread “Investigate DB leak”");
	});

	it("maps plLabel with running, done, and failed states without subject", () => {
		expect(plLabel("pl_timeline_read", {}, "running")).toBe(
			"Read the timeline, still running",
		);
		expect(plLabel("pl_timeline_read", {}, "done")).toBe("Read the timeline");
		expect(plLabel("pl_timeline_read", {}, "failed")).toBe("Read the timeline");
	});

	it("maps legacy bare name like pr_watch to the pl_ label", () => {
		expect(plLabel("pr_watch", { prId: "1088" }, "running")).toBe(
			"Starting to watch PR #1088",
		);
		expect(plLabel("pr_watch", { prId: "1088" }, "done")).toBe(
			"Watching PR #1088",
		);
		expect(plLabel("pr_watch", { prId: "https://github.com/org/repo/pull/1088" }, "done")).toBe(
			"Watching PR #1088",
		);
	});
});

describe("plArgsLine (#1101)", () => {
	it("drops requestId and long strings and formats plain arguments", () => {
		const input = {
			requestId: "req-12345",
			role: "reviewer",
			count: 3,
			enabled: true,
			tags: ["a", "b"],
			longText: "a".repeat(81),
			shortText: "keep me",
		};
		const line = plArgsLine(input);
		expect(line).toBe("role: reviewer · count: 3 · enabled: true · tags: 2 · shortText: keep me");
	});

	it("returns null when all args are dropped or input is empty", () => {
		expect(plArgsLine({})).toBeNull();
		expect(plArgsLine({ requestId: "123", long: "x".repeat(100) })).toBeNull();
	});
});

describe("plSummary (#1101)", () => {
	it("counts per bucket and reports lookups for unbucketed tools", () => {
		const names = [
			"pl_thread_start",
			"pl_thread_start",
			"pl_pr_watch",
			"pl_runbooks_read",
			"pl_service_get",
			"incident_get",
		];
		expect(plSummary(names)).toBe(
			"started 2 threads, watched 1 PR, 3 lookups",
		);
	});

	it("handles singular counts correctly", () => {
		expect(plSummary(["pl_thread_start", "pl_runbooks_read"])).toBe(
			"started 1 thread, 1 lookup",
		);
	});
});

describe("turn-summary editStat (#1101)", () => {
	it("calculates editStat for old_string / new_string", () => {
		const stat = editStat("file.ts", {
			old_string: "line 1\nline 2\n",
			new_string: "line 1\nline 2 modified\nline 3\n",
		});
		expect(stat).toEqual({
			path: "file.ts",
			add: 2,
			del: 1,
		});
	});

	it("calculates editStat for whole-file content", () => {
		const stat = editStat("new.ts", {
			content: "first line\nsecond line\nthird line\n",
		});
		expect(stat).toEqual({
			path: "new.ts",
			add: 3,
			del: 0,
		});
	});

	it("calculates editStat for a *** Begin Patch patch", () => {
		const patch = [
			"*** Update File: src/app.ts",
			"@@ -1,2 +1,3 @@",
			" existing",
			"-old line",
			"+new line 1",
			"+new line 2",
		].join("\n");
		const stat = editStat(null, { patch });
		expect(stat).toEqual({
			path: "src/app.ts",
			add: 2,
			del: 1,
		});
	});

	it("returns null when no edit content is present", () => {
		expect(editStat("file.ts", {})).toBeNull();
		expect(editStat(null, { patch: "not a patch" })).toBeNull();
	});
});

describe("turn-summary turnSummary (#1101)", () => {
	// Changed files moved to their own line under the summary in 880c80ec1 ("no repeated turn summary").
	it("returns turnSummary text exactly 'Ran 1 command. PrismaLens: started 2 threads, watched 1 PR.', with the changed lines in add and del", () => {
		const steps = [
			{ node: "command" },
			{
				edit: { path: "src/a.ts", add: 5, del: 2 },
			},
			{
				edit: { path: "src/b.ts", add: 10, del: 0 },
			},
			{
				pl: { name: "pl_thread_start" },
			},
			{
				pl: { name: "pl_thread_start" },
			},
			{
				pl: { name: "pl_pr_watch" },
			},
		];
		const res = turnSummary(steps);
		expect(res?.text).toBe(
			"Ran 1 command. PrismaLens: started 2 threads, watched 1 PR.",
		);
		expect(res?.add).toBe(15);
		expect(res?.del).toBe(2);
	});

	it("merges files per path", () => {
		const steps = [
			{ edit: { path: "src/a.ts", add: 2, del: 1 } },
			{ edit: { path: "src/a.ts", add: 3, del: 4 } },
			{ edit: { path: "src/b.ts", add: 1, del: 0 } },
		];
		const res = turnSummary(steps);
		expect(res?.files).toEqual([
			{ path: "src/a.ts", add: 5, del: 5 },
			{ path: "src/b.ts", add: 1, del: 0 },
		]);
		expect(res?.add).toBe(6);
		expect(res?.del).toBe(5);
	});

	it("returns null for no steps and no pl calls", () => {
		expect(turnSummary([])).toBeNull();
	});
});

describe("pl-tools and spine registry guards (#1125)", () => {
	it("plLabel contains neither pl_ nor mcp__ for every PL_TOOLS name and state", () => {
		const states = ["running", "done", "failed"] as const;
		for (const name of Object.keys(PL_TOOLS) as (keyof typeof PL_TOOLS)[]) {
			for (const state of states) {
				const label = plLabel(name, {}, state);
				expect(
					label.includes("pl_"),
					`${name} (${state}) does not contain "pl_"`,
				).toBe(false);
				expect(
					label.includes("mcp__"),
					`${name} (${state}) does not contain "mcp__"`,
				).toBe(false);
			}
		}
	});

	it("gatewayNode maps specific tools to their expected spine node kinds", async () => {
		const { gatewayNode } = await import("./spine");
		expect(gatewayNode("pl_browser_navigate")).toBe("browse");
		expect(gatewayNode("pl_evidence_record")).toBe("evidence");
		expect(gatewayNode("pl_incident_get")).toBe("knowledge");
	});
});

