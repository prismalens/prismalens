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
				"The agent reached its usage limit",
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
				"The agent's API key was rejected",
				"2026-07-05T00:00:00Z",
				"key_rejected",
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
				"Error",
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

describe("indexEntryOf for provider stops (#1101 categories 14 and 17)", () => {
	const base = {
		runId: "0b3c2f1e-1111-4222-8333-444444444444",
		branchId: "main",
		path: [] as string[],
		seq: 4,
		ts: "2026-11-12T08:00:00.000Z",
	};
	const mark = (e: CanonicalEvent) => {
		const entry = indexEntryOf(e);
		return entry ? [entry[2], entry[5]] : null;
	};

	it("marks a usage limit with its reset time, and a rate limit or overloaded provider by mode", () => {
		const limit = (mode?: "usage_limit" | "rate_limited" | "overloaded") =>
			({
				kind: "usage_limit",
				...base,
				agent: "claude-code",
				text: "Limit",
				resetsAt: "2026-11-12T18:30:00.000Z",
				...(mode ? { mode } : {}),
			}) as CanonicalEvent;
		expect(mark(limit())).toEqual(["usage_limit", "2026-11-12T18:30:00.000Z"]);
		expect(mark(limit("usage_limit"))).toEqual([
			"usage_limit",
			"2026-11-12T18:30:00.000Z",
		]);
		expect(mark(limit("rate_limited"))).toEqual(["rate_limit", "rate_limited"]);
		expect(mark(limit("overloaded"))).toEqual(["rate_limit", "overloaded"]);
	});

	it("marks a rejected key as auth and out of credit or a spend cap as blocked", () => {
		const blocked = (mode: "out_of_credit" | "key_rejected" | "spend_cap") =>
			({
				kind: "provider_blocked",
				...base,
				agent: "codex",
				mode,
				text: "Stopped",
			}) as CanonicalEvent;
		expect(mark(blocked("key_rejected"))).toEqual(["auth", "key_rejected"]);
		expect(mark(blocked("out_of_credit"))).toEqual(["blocked", "out_of_credit"]);
		expect(mark(blocked("spend_cap"))).toEqual(["blocked", "spend_cap"]);
	});

	it("marks an interrupted run as a restart, and a classified error by its stop", () => {
		expect(
			mark({ kind: "run_interrupted", ...base, reason: "restart" } as CanonicalEvent),
		).toEqual(["restart", null]);
		expect(
			mark({
				kind: "error",
				...base,
				message: "402 Payment Required",
				failure: { mode: "spend_cap" },
			} as unknown as CanonicalEvent),
		).toEqual(["blocked", "spend_cap"]);
		expect(
			mark({ kind: "error", ...base, message: "exit 137" } as CanonicalEvent),
		).toEqual(["error", null]);
	});
});

describe("indexEntryOf never shows a stop's stored text (#1101 category 23)", () => {
	const at = {
		runId: "0b3c2f1e-1111-4222-8333-444444444444",
		branchId: "main",
		path: [] as string[],
		seq: 9,
		ts: "2026-11-12T08:00:00.000Z",
	};
	const line = (e: CanonicalEvent) => {
		const entry = indexEntryOf(e);
		return entry ? [entry[2], entry[3]] : null;
	};

	it("a raw 401 error marks as a rejected key in plain words", () => {
		expect(
			line({
				kind: "error",
				...at,
				message: "Request failed (401): invalid x-api-key",
			}),
		).toEqual(["auth", "The agent's API key was rejected"]);
	});

	it("an unclassified no-json-block error reads Error, not the parser code", () => {
		expect(
			line({ kind: "error", ...at, message: "no-json-block: report missing" }),
		).toEqual(["error", "Error"]);
	});

	it("a classified error and a limit with raw stored text read the failure line", () => {
		expect(
			line({
				kind: "error",
				...at,
				message: "429 Too Many Requests",
				failure: { mode: "rate_limited" },
			}),
		).toEqual(["rate_limit", "The agent's model provider limited the request rate"]);
		expect(
			line({
				kind: "usage_limit",
				...at,
				agent: "claude code",
				text: "Claude AI usage limit reached|1794470400",
				window: "weekly",
			}),
		).toEqual(["usage_limit", "Claude code reached its weekly limit"]);
	});
});
