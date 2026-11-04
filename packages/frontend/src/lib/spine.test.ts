// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type CanonicalEvent, HARNESS_DATA_NOTE } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	gatewayNode,
	matchGateway,
	outcomeLine,
	statusWord,
	stepNode,
	turnFolds,
	workedLabel,
} from "./spine";

const base = (seq: number) => ({
	runId: "00000000-0000-4000-8000-000000000001",
	branchId: "main",
	path: [],
	seq,
	ts: `2026-11-03T10:00:${String(seq).padStart(2, "0")}Z`,
	label: null,
});

describe("stepNode (#1020): an ordinary call by what it names", () => {
	it("reads commands, telemetry queries, files, edits and searches", () => {
		expect(stepNode({ name: "Bash", args: { command: "git status" } })).toBe("command");
		expect(
			stepNode({
				name: "Bash",
				args: { command: "curl -sG 'http://prom:9090/api/v1/query' --data-urlencode 'query=up'" },
			}),
		).toBe("telemetry");
		expect(stepNode({ name: "Read", args: { path: "a.ts" }, category: "file" })).toBe("read");
		expect(stepNode({ name: "Edit", args: { path: "a.ts" }, category: "file" })).toBe("edit");
		expect(stepNode({ name: "Write", args: { file_path: "a.ts" } })).toBe("edit");
		expect(stepNode({ name: "grep", args: { pattern: "x" }, category: "search" })).toBe("search");
	});

	it("names a user's MCP tool telemetry only when it says so, and falls back to an honest tool", () => {
		expect(stepNode({ name: "mcp__observability__query_metrics", args: {} })).toBe("telemetry");
		expect(stepNode({ name: "mcp__tickets__create_issue", args: {} })).toBe("tool");
		expect(stepNode({ name: "something", args: {} })).toBe("tool");
	});

	it("draws a PrismaLens tool by its own name", () => {
		expect(stepNode({ name: "mcp__pl__incidents_similar", args: {}, gateway: "incidents_similar" })).toBe(
			"knowledge",
		);
		expect(gatewayNode("evidence_record")).toBe("evidence");
		expect(gatewayNode("hypothesis_record")).toBe("suspect");
		expect(gatewayNode("artifact_publish")).toBe("artifact");
		expect(gatewayNode("report_validate")).toBe("report");
		expect(gatewayNode("timeline_read")).toBe("knowledge");
	});
});

describe("outcomeLine (#1020)", () => {
	it("is the first line as plain text, capped, or Failed for an empty error", () => {
		expect(outcomeLine({ output: "\n  INC-7 retry storm\nmore" })).toBe("INC-7 retry storm");
		expect(outcomeLine({ output: "a\u0007b" })).toBe("a b");
		expect(outcomeLine({ output: "x".repeat(200) })?.length).toBe(120);
		expect(outcomeLine({ output: "", isError: true })).toBe("Failed");
		expect(outcomeLine({})).toBeNull();
	});

	it("skips the data note every result leads with, and shows no raw JSON", () => {
		const lines = (...l: string[]) => l.join(String.fromCharCode(10));
		expect(outcomeLine({ output: lines(HARNESS_DATA_NOTE, "No incident") })).toBe("No incident");
		expect(outcomeLine({ output: lines(HARNESS_DATA_NOTE, "{", '  "title": "x"', "}") })).toBeNull();
		expect(outcomeLine({ output: lines(HARNESS_DATA_NOTE, "[]"), isError: true })).toBe("Failed");
		expect(outcomeLine({ output: HARNESS_DATA_NOTE })).toBeNull();
	});
});

describe("matchGateway (#1020)", () => {
	const step = (seq: number, id: string, name: string): CanonicalEvent => ({
		kind: "agent_step",
		...base(seq),
		text: "",
		toolCalls: [{ toolCallId: id, name, args: {} }],
	});
	const call = (seq: number, name: string, output: string): CanonicalEvent => ({
		kind: "harness_tool_call",
		...base(seq),
		server: "prismalens-1",
		name,
		at: base(seq).ts,
		turn: "first",
		output,
	});

	it("pairs each recorded call with the agent's own call of it, in order; the rest stand alone", () => {
		const out = matchGateway([
			step(0, "c1", "mcp__prismalens-1__incidents_similar"),
			call(1, "incidents_similar", "INC-7"),
			step(2, "c2", "mcp__prismalens-1__incidents_similar"),
			call(3, "incidents_similar", "INC-9"),
			call(4, "timeline_read", "3 entries"),
			step(5, "c3", "mcp__other__incidents_similar"),
		]);
		expect(out.byCall.get("c1")?.output).toBe("INC-7");
		expect(out.byCall.get("c2")?.output).toBe("INC-9");
		expect(out.byCall.has("c3")).toBe(false);
		expect(Array.from(out.unmatched)).toEqual(["main-4"]);
	});

	it("pairs a deferred call through tools_call with the target it recorded", () => {
		const viaCall = (seq: number, name: string, output: string): CanonicalEvent => ({
			...(call(seq, name, output) as Extract<CanonicalEvent, { kind: "harness_tool_call" }>),
			via: "tools_call",
		});
		const deferred = (seq: number, id: string, target: string): CanonicalEvent => ({
			kind: "agent_step",
			...base(seq),
			text: "",
			toolCalls: [{ toolCallId: id, name: "mcp__prismalens-1__tools_call", args: { name: target, arguments: {} } }],
		});
		const out = matchGateway([
			deferred(0, "d1", "fixes_list"),
			viaCall(1, "fixes_list", "2 fixes"),
			deferred(2, "d2", "runbooks_list"),
			viaCall(3, "changes_list", "1 change"),
		]);
		expect(out.byCall.get("d1")?.name).toBe("fixes_list");
		expect(out.byCall.has("d2")).toBe(false);
		expect(Array.from(out.unmatched)).toEqual(["main-3"]);
	});

	it("pairs a wrapper call that never resolved, recorded as tools_call with no via", () => {
		const out = matchGateway([
			{
				kind: "agent_step",
				...base(0),
				text: "",
				toolCalls: [
					{ toolCallId: "d1", name: "mcp__prismalens-1__tools_call", args: { name: "nope", arguments: {} } },
				],
			},
			call(1, "tools_call", "Unknown tool"),
		]);
		expect(out.byCall.get("d1")?.output).toBe("Unknown tool");
		expect(Array.from(out.unmatched)).toEqual([]);
	});
});

describe("turnFolds (#1020)", () => {
	const op = (key: string, at: string) => ({ kind: "operator", key, at, state: "started" });
	it("folds a finished turn's work behind one row, leaving the answer, artifacts and errors out", () => {
		const items = [
			op("o1", "2026-11-03T10:00:00Z"),
			{ kind: "prose", key: "p1", text: "Looking", at: "2026-11-03T10:00:05Z" },
			{ kind: "tools", key: "t1", at: "2026-11-03T10:00:06Z", until: "2026-11-03T10:01:00Z" },
			{ kind: "finding", key: "f1", at: "2026-11-03T10:01:10Z" },
			{ kind: "artifact", key: "a1" },
			{ kind: "prose", key: "p2", text: "The answer", at: "2026-11-03T10:02:00Z" },
			{ kind: "end", key: "e1" },
		];
		const [fold] = turnFolds(items, false);
		expect(fold).toEqual({ key: "fold-o1", at: 1, hidden: [1, 2, 3], seconds: 120 });
		expect(turnFolds(items, true)).toEqual([]);
	});

	it("folds an earlier turn while the run is live, and never a turn with no work", () => {
		const items = [
			op("o1", "2026-11-03T10:00:00Z"),
			{ kind: "tools", key: "t1", at: "2026-11-03T10:00:06Z" },
			{ kind: "prose", key: "p1", text: "Done", at: "2026-11-03T10:00:30Z" },
			{ kind: "operator", key: "o2", at: "2026-11-03T10:01:00Z", state: "delivered" },
			{ kind: "prose", key: "p2", text: "Hi", at: "2026-11-03T10:01:05Z" },
			{ kind: "operator", key: "q", at: "2026-11-03T10:01:06Z", state: "queued" },
		];
		const folds = turnFolds(items, true);
		expect(folds.map((f) => f.key)).toEqual(["fold-o1"]);
		expect(turnFolds(items, false).map((f) => f.key)).toEqual(["fold-o1"]);
	});

	it("says Worked with no time when the turn kept none", () => {
		const [fold] = turnFolds([{ kind: "operator", key: "o", state: "started" }, { kind: "tools", key: "t" }], false);
		expect(fold?.seconds).toBeNull();
		expect(workedLabel(null)).toBe("Worked");
		expect(workedLabel(252)).toBe("Worked for 4m 12s");
	});
});

describe("statusWord (#1020)", () => {
	it("keeps the agent's word, capitalised", () => {
		expect(statusWord("supported")).toBe("Supported");
		expect(statusWord("refuted")).toBe("Refuted");
	});
});
