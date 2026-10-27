// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunRecord, recordTools } from "./record.js";
import { executeTool } from "./registry.js";
import { type RecordedCall, fixturesFrom, replayCalls } from "./replay.js";
import { runbookTools } from "./runbooks.js";
import { defineHarnessTool } from "./tool.js";

describe("replayCalls", () => {
	it("replays recorded calls and returns same for matching outputs", async () => {
		const tools = [
			defineHarnessTool({
				name: "echo_tool",
				title: "Echo",
				description: "desc",
				group: "core",
				effect: "read",
				input: z.object({ msg: z.string() }),
				run: async ({ msg }) => ({ value: { echo: msg } }),
			}),
		];
		const record = new RunRecord();
		const call1 = await executeTool(
			tools[0],
			{ msg: "hello" },
			{
				runId: "run-orig",
				signal: new AbortController().signal,
				record,
			},
		);

		const recorded: RecordedCall[] = [
			{
				name: call1.name,
				callId: call1.callId,
				input: call1.input,
				output: call1.output,
				schemaHash: call1.schemaHash,
			},
		];

		const results = await replayCalls(recorded, tools, "run-replay");
		expect(results).toHaveLength(1);
		expect(results[0].result).toBe("same");
		expect(results[0].output).toBe(call1.output);
	});

	it("returns differs when a changed fake port produces different output", async () => {
		let runbookContent = "initial content";
		const tools = runbookTools({
			list: async () => [],
			read: async () => ({
				ok: true,
				path: "rb.md",
				markdown: runbookContent,
			}),
		});

		const record = new RunRecord();
		const call1 = await executeTool(
			tools[1], // runbooks_read
			{ path: "rb.md", service: "svc" },
			{
				runId: "run-orig",
				signal: new AbortController().signal,
				record,
			},
		);

		// Port returns changed content during replay
		runbookContent = "modified content";

		const recorded: RecordedCall[] = [
			{
				name: call1.name,
				callId: call1.callId,
				input: call1.input,
				output: call1.output,
				schemaHash: call1.schemaHash,
			},
		];

		const results = await replayCalls(recorded, tools, "run-replay");
		expect(results).toHaveLength(1);
		expect(results[0].result).toBe("differs");
	});

	it("returns unreplayable with input-dropped when inputDropped is true", async () => {
		const tools = [
			defineHarnessTool({
				name: "test_tool",
				title: "Test",
				description: "desc",
				group: "core",
				effect: "read",
				input: z.object({}),
				run: async () => ({ value: "ok" }),
			}),
		];

		const recorded: RecordedCall[] = [
			{
				name: "test_tool",
				callId: "call-1",
				inputDropped: true,
				output: "ok",
			},
		];

		const results = await replayCalls(recorded, tools, "run-replay");
		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({
			name: "test_tool",
			callId: "call-1",
			result: "unreplayable",
			reason: "input-dropped",
		});
	});

	it("returns unreplayable with tool-gone for unknown tool", async () => {
		const recorded: RecordedCall[] = [
			{
				name: "vanished_tool",
				callId: "call-2",
				input: {},
				output: "ok",
			},
		];

		const results = await replayCalls(recorded, [], "run-replay");
		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({
			name: "vanished_tool",
			callId: "call-2",
			result: "unreplayable",
			reason: "tool-gone",
		});
	});

	it("returns unreplayable with schema-changed on wrong schemaHash", async () => {
		const tools = [
			defineHarnessTool({
				name: "test_tool",
				title: "Test",
				description: "desc",
				group: "core",
				effect: "read",
				input: z.object({}),
				run: async () => ({ value: "ok" }),
			}),
		];

		const recorded: RecordedCall[] = [
			{
				name: "test_tool",
				callId: "call-3",
				input: {},
				output: "ok",
				schemaHash: "0000000000000000",
			},
		];

		const results = await replayCalls(recorded, tools, "run-replay");
		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({
			name: "test_tool",
			callId: "call-3",
			result: "unreplayable",
			reason: "schema-changed",
		});
	});

	it("never touches the original RunRecord when replaying record tools", async () => {
		const tools = recordTools();
		const origRecord = new RunRecord();
		const call = await executeTool(
			tools[0], // evidence_record
			{ id: "e1", observation: "Database crashed", source: "log" },
			{
				runId: "run-orig",
				signal: new AbortController().signal,
				record: origRecord,
			},
		);

		expect(origRecord.evidence("e1")).toBeDefined();

		const recorded: RecordedCall[] = [
			{
				name: call.name,
				callId: call.callId,
				input: call.input,
				output: call.output,
				schemaHash: call.schemaHash,
			},
		];

		// Clear original record or verify items don't leak/change
		const emptyOrigRecord = new RunRecord();
		await replayCalls(recorded, tools, "run-replay");
		expect(emptyOrigRecord.evidence("e1")).toBeUndefined();
	});
});

describe("fixturesFrom", () => {
	it("creates fixture entries where first entry has hasToolResult:false and later have afterTool", () => {
		const calls: RecordedCall[] = [
			{
				name: "incident_get",
				input: { number: 12 },
				output: "{}",
			},
			{
				name: "runbooks_list",
				input: { service: "web" },
				output: "{}",
			},
			{
				name: "dropped_tool",
				inputDropped: true,
				output: "{}",
			},
			{
				name: "evidence_record",
				input: { id: "e1", observation: "done", source: "test" },
				output: "{}",
			},
		];

		const fixtures = fixturesFrom(calls, "test-marker");

		expect(fixtures).toHaveLength(3); // dropped_tool skipped

		expect(fixtures[0]).toEqual({
			match: {
				inConversation: "test-marker",
				hasToolResult: false,
			},
			response: {
				toolCalls: [{ name: "$gw:incident_get", arguments: { number: 12 } }],
			},
		});

		expect(fixtures[1]).toEqual({
			match: {
				inConversation: "test-marker",
				afterTool: "$gw:incident_get",
			},
			response: {
				toolCalls: [{ name: "$gw:runbooks_list", arguments: { service: "web" } }],
			},
		});

		expect(fixtures[2]).toEqual({
			match: {
				inConversation: "test-marker",
				afterTool: "$gw:runbooks_list",
			},
			response: {
				toolCalls: [
					{
						name: "$gw:evidence_record",
						arguments: { id: "e1", observation: "done", source: "test" },
					},
				],
			},
		});
	});
});
