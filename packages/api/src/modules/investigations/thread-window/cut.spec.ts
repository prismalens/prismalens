// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { CanonicalEvent } from "@prismalens/contracts";
import { cutForPage } from "./cut.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

describe("thread-window cut", () => {
	it("An event with no string over 2,048 characters returns the same object and no cut", () => {
		const shortEvent: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			text: "Short text well within limit",
			mode: "queue",
			delivered: true,
		};
		const res = cutForPage(shortEvent);
		expect(res.event).toBe(shortEvent);
		expect(res.cut).toBeUndefined();
	});

	it('A tool_result whose preview is 10,000 characters comes back with a preview of exactly 2,048 characters and cut: [{path: "result.preview", bytes: 10000}]', () => {
		const longPreview = "x".repeat(10000);
		const toolRes: CanonicalEvent = {
			kind: "tool_result",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			result: {
				name: "bash",
				toolCallId: "call-1",
				ok: true,
				source: "bash",
				preview: longPreview,
			},
		};

		const res = cutForPage(toolRes);
		expect(res.cut).toEqual([{ path: "result.preview", bytes: 10000 }]);
		const cut = res.event as Extract<CanonicalEvent, { kind: "tool_result" }>;
		expect(cut.kind).toBe("tool_result");
		expect(cut.result.preview).toBe("x".repeat(2048));
	});

	it("An agent_step whose toolCalls[0].args serializes to over 8 KiB comes back with args {} and a cut at path toolCalls.0.args", () => {
		const largeArgs = { data: "y".repeat(9000) };
		const bytes = JSON.stringify(largeArgs).length;
		const step: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			text: "running command",
			toolCalls: [
				{
					toolCallId: "call-1",
					name: "custom_tool",
					args: largeArgs,
				},
			],
		};

		const res = cutForPage(step);
		expect(res.cut).toEqual([{ path: "toolCalls.0.args", bytes }]);
		const cut = res.event as Extract<CanonicalEvent, { kind: "agent_step" }>;
		expect(cut.kind).toBe("agent_step");
		expect(cut.toolCalls[0]?.args).toEqual({});
	});

	it("A harness_tool_call whose input array serializes to over 8 KiB comes back with input [] and a cut at path input", () => {
		const largeInput = ["y".repeat(9000)];
		const bytes = JSON.stringify(largeInput).length;
		const call: CanonicalEvent = {
			kind: "harness_tool_call",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			server: "internal",
			name: "pl_read",
			at: "2026-07-05T00:00:00Z",
			turn: "first",
			input: largeInput,
		};

		const res = cutForPage(call);
		expect(res.cut).toEqual([{ path: "input", bytes }]);
		const cut = res.event as Extract<
			CanonicalEvent,
			{ kind: "harness_tool_call" }
		>;
		expect(cut.kind).toBe("harness_tool_call");
		expect(cut.input).toEqual([]);
	});

	it("A thread delivery message of 1,000 characters is cut to 600 characters", () => {
		const prefix = "[Message from worker] ";
		const longText = prefix + "m".repeat(1000 - prefix.length);
		const messageEvent: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			text: longText,
			mode: "queue",
			delivered: true,
		};

		const res = cutForPage(messageEvent);
		expect(res.cut).toEqual([{ path: "text", bytes: 1000 }]);
		const cut = res.event as Extract<
			CanonicalEvent,
			{ kind: "operator_message" }
		>;
		expect(cut.kind).toBe("operator_message");
		expect(cut.text).toBe(longText.slice(0, 600));
		expect(cut.text.length).toBe(600);
	});

	it("An event over 64 KiB with 60 tool calls cuts the array to 50 items on the second pass", () => {
		const toolCalls = Array.from({ length: 60 }, (_, i) => ({
			toolCallId: `call-${i}`,
			name: "bash",
			args: { cmd: "x".repeat(1100) },
		}));
		const step: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			text: "",
			toolCalls,
		};

		const res = cutForPage(step);
		const cut = res.event as Extract<CanonicalEvent, { kind: "agent_step" }>;
		expect(cut.toolCalls.length).toBe(50);
		expect(cut.toolCalls[0]?.args).toEqual({ cmd: "x".repeat(256) });
	});

	it("An event that remains over 64 KiB after all passes returns a wildcard cut for the whole event", () => {
		const modelUsage: Record<string, unknown> = {
			note: "z".repeat(3000),
		};
		for (let i = 0; i < 5000; i++) {
			modelUsage[`key_${i}`] = i;
		}
		const event: CanonicalEvent = {
			kind: "branch_done",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:00:00Z",
			reason: "submitted",
			modelUsage,
		};
		const rawBytes = JSON.stringify(event).length;

		const res = cutForPage(event);
		expect(res.cut).toEqual([{ path: "*", bytes: rawBytes }]);
		expect(res.event.kind).toBe("branch_done");
	});
});
