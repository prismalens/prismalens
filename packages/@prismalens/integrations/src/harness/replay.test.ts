// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTool } from "./registry.js";
import { type RecordedCall, fixturesFrom, replayCalls } from "./replay.js";
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
		const call1 = await executeTool(
			tools[0],
			{ msg: "hello" },
			{
				runId: "run-orig",
				signal: new AbortController().signal,
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
		const runbooksRead = defineHarnessTool({
			name: "runbooks_read",
			title: "Read runbook",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({ path: z.string(), service: z.string().optional() }),
			run: async ({ path }) => ({
				value: {
					ok: true,
					path,
					markdown: runbookContent,
				},
			}),
		});
		const tools = [runbooksRead];

		const call1 = await executeTool(
			tools[0],
			{ path: "rb.md", service: "svc" },
			{
				runId: "run-orig",
				signal: new AbortController().signal,
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

	it("never touches the original array when replaying record tools bound to a fresh array", async () => {
		const originalItems: unknown[] = [];
		const makeRecordTool = (items: unknown[]) =>
			defineHarnessTool({
				name: "evidence_record",
				title: "Record evidence",
				description: "desc",
				group: "record",
				effect: "record",
				input: z.object({
					id: z.string(),
					observation: z.string().optional(),
					source: z.string().optional(),
				}),
				run: async (input) => {
					items.push(input);
					return { value: { recorded: true } };
				},
			});

		const origTools = [makeRecordTool(originalItems)];
		const call = await executeTool(
			origTools[0],
			{ id: "e1", observation: "Database crashed", source: "log" },
			{
				runId: "run-orig",
				signal: new AbortController().signal,
			},
		);

		expect(originalItems).toHaveLength(1);
		expect(originalItems[0]).toEqual({
			id: "e1",
			observation: "Database crashed",
			source: "log",
		});

		const recorded: RecordedCall[] = [
			{
				name: call.name,
				callId: call.callId,
				input: call.input,
				output: call.output,
				schemaHash: call.schemaHash,
			},
		];

		const freshItems: unknown[] = [];
		const replayTools = [makeRecordTool(freshItems)];
		await replayCalls(recorded, replayTools, "run-replay");

		expect(freshItems).toHaveLength(1);
		expect(originalItems).toHaveLength(1);
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
				toolResults: 0,
				hasToolResult: false,
			},
			response: {
				toolCalls: [{ name: "$gw:incident_get", arguments: { number: 12 } }],
			},
		});

		expect(fixtures[1]).toEqual({
			match: {
				inConversation: "test-marker",
				toolResults: 1,
				afterTool: "$gw:incident_get",
			},
			response: {
				toolCalls: [{ name: "$gw:runbooks_list", arguments: { service: "web" } }],
			},
		});

		expect(fixtures[2]).toEqual({
			match: {
				inConversation: "test-marker",
				toolResults: 2,
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

describe("fixturesFrom through tools_call (#848)", () => {
	it("replays a call that went through tools_call the same way", () => {
		const entries = fixturesFrom(
			[
				{ name: "tools_search", input: { query: "past" } },
				{ name: "investigations_search", input: { query: "x" }, via: "tools_call" },
				{ name: "incident_get", input: {} },
			],
			"[row:r]",
		);
		expect(entries[1]?.response.toolCalls[0]).toEqual({
			name: "$gw:tools_call",
			arguments: { name: "investigations_search", arguments: { query: "x" } },
		});
		expect(entries[2]?.match.afterTool).toBe("$gw:tools_call");
	});
});

describe("fixturesFrom with repeated wrapper calls (#848)", () => {
	it("tells repeated tools_call steps apart by how many results came before", () => {
		const entries = fixturesFrom(
			[
				{ name: "investigations_search", input: { query: "a" }, via: "tools_call" },
				{ name: "investigations_search", input: { query: "b" }, via: "tools_call" },
				{ name: "investigations_search", input: { query: "c" }, via: "tools_call" },
			],
			"[row:r]",
		);
		expect(entries.map((e) => e.match.toolResults)).toEqual([0, 1, 2]);
		expect(new Set(entries.map((e) => JSON.stringify(e.match))).size).toBe(3);
	});
});
