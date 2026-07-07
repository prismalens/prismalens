// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	AcpAdapter,
	type AcpUpdate,
	deriveSource,
	flattenAcpContent,
	mapStopReason,
	mapToolCategory,
	pickName,
	unwrapInput,
} from "./acp-adapter.js";

const FIXED = new Date("2026-06-29T00:00:00.000Z");
const ctx = {
	runId: "11111111-1111-1111-1111-111111111111",
	branchId: "root",
	now: () => FIXED,
};

// Shapes copied verbatim from the live ACP captures (/tmp/acp.jsonl, /tmp/acp2.jsonl).
const lsToolCall: AcpUpdate = {
	sessionUpdate: "tool_call",
	kind: "search",
	status: "pending",
	title: "ls",
	toolCallId: "call_ze0og9u5",
};
const lsToolUpdate: AcpUpdate = {
	sessionUpdate: "tool_call_update",
	toolCallId: "call_ze0og9u5",
	status: "completed",
	content: [
		{ type: "content", content: { type: "text", text: "['a.ts','b.ts']" } },
	],
};
const execToolCall: AcpUpdate = {
	sessionUpdate: "tool_call",
	kind: "execute",
	status: "pending",
	title: "Execute: `ls -la`",
	toolCallId: "call_gp6m6ma9",
	rawInput: { command: "ls -la", timeout: null },
};

describe("helpers", () => {
	it("flattenAcpContent handles the chunk object and the tool-update array", () => {
		expect(flattenAcpContent({ type: "text", text: "Found" })).toBe("Found");
		expect(
			flattenAcpContent([
				{ type: "content", content: { type: "text", text: "x" } },
				{ type: "content", content: { type: "text", text: "y" } },
			]),
		).toBe("xy");
		expect(flattenAcpContent(undefined)).toBe("");
		expect(flattenAcpContent("plain")).toBe("plain");
	});

	it("pickName prefers title, falls back to kind then a generic", () => {
		expect(
			pickName({ sessionUpdate: "tool_call", title: "ls", kind: "search" }),
		).toBe("ls");
		expect(pickName({ sessionUpdate: "tool_call", kind: "execute" })).toBe(
			"execute",
		);
		expect(pickName({ sessionUpdate: "tool_call" })).toBe("tool");
	});

	it("unwrapInput unwraps a {input:'<json>'} wrapper and passes others through", () => {
		expect(unwrapInput({ input: '{"namespace":"prod"}' })).toEqual({
			namespace: "prod",
		});
		expect(unwrapInput({ namespace: "prod" })).toEqual({ namespace: "prod" });
		expect(unwrapInput({ input: "not json" })).toEqual({ input: "not json" });
	});

	it("deriveSource renders tool + input", () => {
		expect(deriveSource("ls", { command: "ls -la", timeout: null })).toBe(
			'ls({"command":"ls -la","timeout":null})',
		);
		expect(deriveSource("ls", undefined)).toBe("ls");
	});

	it("mapToolCategory maps known ACP kinds and nulls the rest", () => {
		expect(mapToolCategory("search")).toBe("search");
		expect(mapToolCategory("read")).toBe("file");
		expect(mapToolCategory("execute")).toBeNull();
		expect(mapToolCategory(undefined)).toBeNull();
	});

	it("mapStopReason classifies completion reasons", () => {
		expect(mapStopReason("end_turn")).toBe("submitted");
		expect(mapStopReason("max_tokens")).toBe("budget");
		expect(mapStopReason("max_turn_requests")).toBe("budget");
		expect(mapStopReason("refusal")).toBe("no_progress");
		expect(mapStopReason(undefined)).toBe("no_progress");
	});
});

describe("AcpAdapter.normalize", () => {
	it("accumulates message chunks and flushes them on the next tool_call", () => {
		const adapter = new AcpAdapter(ctx);
		expect(
			adapter.normalize({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "checking " },
			}),
		).toBeNull();
		expect(
			adapter.normalize({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "pods" },
			}),
		).toBeNull();
		const step = adapter.normalize(lsToolCall);
		expect(step).toMatchObject({
			kind: "agent_step",
			runId: ctx.runId,
			branchId: "root",
			path: [],
			seq: 0,
			label: null,
			text: "checking pods",
			toolCalls: [{ toolCallId: "call_ze0og9u5", name: "ls", args: {} }],
			ts: FIXED.toISOString(),
		});
		expect(CanonicalEventSchema.safeParse(step).success).toBe(true);
	});

	it("carries rawInput into the agent_step toolCalls args", () => {
		const adapter = new AcpAdapter(ctx);
		const step = adapter.normalize(execToolCall);
		expect(step).toMatchObject({
			kind: "agent_step",
			toolCalls: [
				{
					toolCallId: "call_gp6m6ma9",
					name: "Execute: `ls -la`",
					args: { command: "ls -la", timeout: null },
				},
			],
		});
		expect(CanonicalEventSchema.safeParse(step).success).toBe(true);
	});

	it("pairs a completed tool_call_update into a tool_result using the call's title", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize(lsToolCall); // seq 0 — registers the title/kind
		const result = adapter.normalize(lsToolUpdate);
		expect(result).toMatchObject({
			kind: "tool_result",
			seq: 1,
			result: {
				name: "ls",
				toolCategory: "search",
				toolCallId: "call_ze0og9u5",
				source: "ls",
				ok: true,
				error: null,
				preview: "['a.ts','b.ts']",
			},
		});
		expect(CanonicalEventSchema.safeParse(result).success).toBe(true);
	});

	it("marks a failed tool_call_update ok=false with the error preview", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({ ...lsToolCall, title: "kubectl get", kind: "execute" });
		const result = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "call_ze0og9u5",
			status: "failed",
			content: [
				{ type: "content", content: { type: "text", text: "NotFound" } },
			],
		});
		expect(result).toMatchObject({
			kind: "tool_result",
			result: {
				name: "kubectl get",
				ok: false,
				error: "NotFound",
				preview: "NotFound",
			},
		});
		expect(CanonicalEventSchema.safeParse(result).success).toBe(true);
	});

	it("ignores non-terminal tool progress frames and unsurfaced updates", () => {
		const adapter = new AcpAdapter(ctx);
		expect(
			adapter.normalize({
				sessionUpdate: "tool_call_update",
				toolCallId: "x",
				status: "in_progress",
			}),
		).toBeNull();
		expect(
			adapter.normalize({
				sessionUpdate: "agent_thought_chunk",
				content: { text: "hmm" },
			}),
		).toBeNull();
		expect(adapter.normalize({ sessionUpdate: "plan" })).toBeNull();
	});

	it("flushText emits trailing text as a text-only agent_step", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "done." },
		});
		const flushed = adapter.flushText();
		expect(flushed).toMatchObject({
			kind: "agent_step",
			text: "done.",
			toolCalls: [],
		});
		expect(adapter.flushText()).toBeNull(); // nothing left
	});

	it("keeps seq monotonic across normalize + terminal events, all schema-valid", () => {
		const adapter = new AcpAdapter(ctx);
		const step = adapter.normalize(lsToolCall); // 0
		const result = adapter.normalize(lsToolUpdate); // 1
		const done = adapter.branchDone("submitted"); // 2
		const report = adapter.report({
			summary: "ordered-evidence report",
			rootCause: null,
			rootCauseCategory: null,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: [], notQueried: [] },
			nextSteps: [],
		}); // 3
		expect([step?.seq, result?.seq, done.seq, report.seq]).toEqual([
			0, 1, 2, 3,
		]);
		for (const ev of [step, result, done, report]) {
			expect(CanonicalEventSchema.safeParse(ev).success).toBe(true);
		}
	});
});
