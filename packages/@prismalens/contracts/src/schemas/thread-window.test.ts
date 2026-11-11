// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	compareKeys,
	findOccurrences,
	indexEntryOf,
	parseCursor,
	parseEventKey,
	QueryFlagSchema,
	searchableText,
} from "./thread-window.js";
import type { CanonicalEvent } from "./investigation.js";

describe("thread-window schemas and helpers", () => {
	describe("findOccurrences", () => {
		it('"aXbxc", "x" case-blind returns [[1,2],[3,4]]', () => {
			expect(findOccurrences("aXbxc", "x")).toEqual([
				[1, 2],
				[3, 4],
			]);
		});

		it("case-sensitive returns [[3,4]]", () => {
			expect(findOccurrences("aXbxc", "x", { caseSensitive: true })).toEqual([
				[3, 4],
			]);
		});

		it('"İstanbul", "i" case-blind returns [[0,1]], offsets in the ORIGINAL string', () => {
			expect(findOccurrences("İstanbul", "i")).toEqual([[0, 1]]);
		});

		it('a query after an astral character ("😀abc", "b") returns [[3,4]]', () => {
			expect(findOccurrences("😀abc", "b")).toEqual([[3, 4]]);
		});

		it('the final sigma: "ΟΔΟΣ" with query "οδοσ" matches [[0,4]]', () => {
			expect(findOccurrences("ΟΔΟΣ", "οδοσ")).toEqual([[0, 4]]);
		});

		it("an empty query returns []", () => {
			expect(findOccurrences("anything", "")).toEqual([]);
		});
	});

	describe("parseEventKey", () => {
		it('parseEventKey("main:12") returns {branchId:"main", seq:12}, and parseEventKey("report:3") returns {branchId:"__report__", seq:3}', () => {
			expect(parseEventKey("main:12")).toEqual({ branchId: "main", seq: 12 });
			expect(parseEventKey("report:3")).toEqual({
				branchId: "__report__",
				seq: 3,
			});
		});

		it('A branch holding a colon, "a:b:7", returns {branchId:"a:b", seq:7}', () => {
			expect(parseEventKey("a:b:7")).toEqual({ branchId: "a:b", seq: 7 });
		});

		it('"nope" returns null', () => {
			expect(parseEventKey("nope")).toBeNull();
		});
	});

	describe("compareKeys", () => {
		it('compareKeys("main:2","main:10") < 0, and a same seq orders by branch', () => {
			expect(compareKeys("main:2", "main:10")).toBeLessThan(0);
			expect(compareKeys("branchA:5", "branchB:5")).toBeLessThan(0);
			expect(compareKeys("branchB:5", "branchA:5")).toBe(1);
			expect(compareKeys("branchA:5", "branchA:5")).toBe(0);
		});
	});

	describe("parseCursor", () => {
		it('parseCursor("3.120") returns {gen:3, ordinal:120}, and parseCursor("x") returns null', () => {
			expect(parseCursor("3.120")).toEqual({ gen: 3, ordinal: 120 });
			expect(parseCursor("x")).toBeNull();
		});
	});

	describe("indexEntryOf", () => {
		const base = {
			runId: "run-1",
			branchId: "main",
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
		};

		it("an operator message is you with a null mark", () => {
			const e: CanonicalEvent = {
				kind: "operator_message",
				...base,
				path: [],
				text: "hello operator",
			};
			expect(indexEntryOf(e)).toEqual([
				"main:1",
				"you",
				null,
				"hello operator",
				"2026-07-05T00:00:00Z",
				null,
			]);
		});

		it("an operator message with via.restart is mark restart", () => {
			const e: CanonicalEvent = {
				kind: "operator_message",
				...base,
				path: [],
				text: "restarted",
				via: {
					restart: {
						stoppedAt: "2026-07-04T23:59:00Z",
					},
				},
			};
			expect(indexEntryOf(e)).toEqual([
				"main:1",
				"system",
				"restart",
				"Interrupted by restart",
				"2026-07-05T00:00:00Z",
				"2026-07-04T23:59:00Z",
			]);
		});

		it("an agent_step with empty text is null, and one with a non-empty path is null", () => {
			const emptyText: CanonicalEvent = {
				kind: "agent_step",
				...base,
				path: [],
				text: "   ",
				toolCalls: [],
			};
			expect(indexEntryOf(emptyText)).toBeNull();

			const subagentStep: CanonicalEvent = {
				kind: "agent_step",
				...base,
				path: ["sub-1"],
				text: "working on subagent",
				toolCalls: [],
			};
			expect(indexEntryOf(subagentStep)).toBeNull();
		});

		it("usage_limit has mark usage_limit and resetsAt as its 6th element", () => {
			const e: CanonicalEvent = {
				kind: "usage_limit",
				...base,
				path: [],
				text: "Rate limit reached",
				resetsAt: "2026-07-05T06:00:00Z",
			};
			expect(indexEntryOf(e)).toEqual([
				"main:1",
				"system",
				"usage_limit",
				"Rate limit reached",
				"2026-07-05T00:00:00Z",
				"2026-07-05T06:00:00Z",
			]);
		});

		it('error with "Invalid API key ... 401" is mark auth, and error "exit 137" is mark error', () => {
			const authErr: CanonicalEvent = {
				kind: "error",
				...base,
				path: [],
				message: "Invalid API key provided, status 401 unauthorized",
			};
			expect(indexEntryOf(authErr)).toEqual([
				"main:1",
				"system",
				"auth",
				"Invalid API key provided, status 401 unauthorized",
				"2026-07-05T00:00:00Z",
				null,
			]);

			const normalErr: CanonicalEvent = {
				kind: "error",
				...base,
				path: [],
				message: "exit 137",
			};
			expect(indexEntryOf(normalErr)).toEqual([
				"main:1",
				"system",
				"error",
				"exit 137",
				"2026-07-05T00:00:00Z",
				null,
			]);
		});

		it("compaction phase started is null and completed is mark compaction", () => {
			const started: CanonicalEvent = {
				kind: "compaction",
				...base,
				path: [],
				phase: "started",
			};
			expect(indexEntryOf(started)).toBeNull();

			const completed: CanonicalEvent = {
				kind: "compaction",
				...base,
				path: [],
				phase: "completed",
			};
			expect(indexEntryOf(completed)).toEqual([
				"main:1",
				"system",
				"compaction",
				"Context compacted",
				"2026-07-05T00:00:00Z",
				null,
			]);
		});

		it("a preview longer than 80 characters is cut to 80, the last one …", () => {
			const longText = "a".repeat(100);
			const e: CanonicalEvent = {
				kind: "operator_message",
				...base,
				path: [],
				text: longText,
			};
			const entry = indexEntryOf(e);
			expect(entry).not.toBeNull();
			const previewText = entry![3];
			expect(previewText).toHaveLength(80);
			expect(previewText).toBe(`${"a".repeat(79)}…`);
		});
	});

	describe("searchableText", () => {
		const base = {
			runId: "run-1",
			branchId: "main",
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			path: [],
		};

		it("scope mine returns an operator message's text and nothing of a tool_result", () => {
			const opMsg: CanonicalEvent = {
				kind: "operator_message",
				...base,
				text: "my query",
			};
			const toolRes: CanonicalEvent = {
				kind: "tool_result",
				...base,
				result: {
					toolCallId: "c1",
					ok: true,
					source: "bash",
					preview: "total 0",
				},
			};
			expect(searchableText(opMsg, "mine")).toEqual(["my query"]);
			expect(searchableText(toolRes, "mine")).toEqual([]);
		});

		it("scope tools returns the tool result's source, preview and error", () => {
			const toolRes: CanonicalEvent = {
				kind: "tool_result",
				...base,
				result: {
					toolCallId: "c1",
					ok: false,
					source: "terminal",
					preview: "failed output",
					error: "command not found",
				},
			};
			expect(searchableText(toolRes, "tools")).toEqual([
				"terminal",
				"failed output",
				"command not found",
			]);
		});

		it("scope agent returns agent_step text but not tool call args", () => {
			const step: CanonicalEvent = {
				kind: "agent_step",
				...base,
				text: "agent reasoning text",
				toolCalls: [
					{
						toolCallId: "c1",
						name: "grep",
						args: { pattern: "secret_arg" },
					},
				],
			};
			expect(searchableText(step, "agent")).toEqual(["agent reasoning text"]);
		});
	});

	describe("QueryFlagSchema", () => {
		it('"false" parses to false, "true" to true, and absent to undefined', () => {
			expect(QueryFlagSchema.parse("false")).toBe(false);
			expect(QueryFlagSchema.parse("true")).toBe(true);
			expect(QueryFlagSchema.parse(undefined)).toBeUndefined();
		});
	});
});
