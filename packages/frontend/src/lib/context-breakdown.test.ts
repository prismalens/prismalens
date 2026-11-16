// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { contextBreakdown } from "./context-breakdown";

describe("contextBreakdown (#1101)", () => {
	it("estimates categories and tokens for brief + second message + image & text attachment, harness tool, tool result, agent step", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				text: "Short brief for the test run", // 28 chars -> 7 tokens
				attachments: [
					{
						name: "screenshot.png",
						mimeType: "image/png",
						size: 40_000,
					},
					{
						name: "notes.txt",
						mimeType: "text/plain",
						size: 400, // 400 / 4 = 100 tokens
					},
				],
			} as unknown as CanonicalEvent,
			{
				kind: "operator_message",
				text: "A second operator message", // 25 chars -> 7 tokens
				attachments: [],
			} as unknown as CanonicalEvent,
			{
				kind: "harness_tool_call",
				name: "pl_incident_get",
				input: { id: "inc-1" }, // '{"id":"inc-1"}' = 16 chars -> 4 tokens
				output: "Incident details output text", // 28 chars -> 7 tokens
			} as unknown as CanonicalEvent,
			{
				kind: "tool_result",
				result: {
					preview: "tool preview text here", // 22 chars -> 6 tokens
					source: "command: ls -la",
				},
			} as unknown as CanonicalEvent,
			{
				kind: "agent_step",
				text: "Agent reply words here", // 22 chars -> 6 tokens
			} as unknown as CanonicalEvent,
		];

		const breakdown = contextBreakdown(events, { used: 2000, size: 10_000 });
		const rowMap = new Map(breakdown.rows.map((r) => [r.category, r.tokens]));

		expect(rowMap.get("brief")).toBe(7);
		expect(rowMap.get("attachments")).toBe(1700); // 1600 (image) + 100 (text)
		expect(rowMap.get("messages")).toBe(7);
		expect(rowMap.get("pl_tools")).toBe(11); // 4 + 7
		expect(rowMap.get("tools")).toBe(6);
		expect(rowMap.get("replies")).toBe(6);
	});

	it("sets agent row equal to used minus the rest", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				text: "12345678", // 8 chars -> 2 tokens
				attachments: [],
			} as unknown as CanonicalEvent,
		];
		const breakdown = contextBreakdown(events, { used: 50, size: 100 });
		const agentRow = breakdown.rows.find((r) => r.category === "agent");
		expect(agentRow?.tokens).toBe(48);
		expect(breakdown.rows.map((r) => r.tokens).reduce((a, b) => a + b, 0)).toBe(50);
	});

	it("drops events before a completed compaction and turns its after into summary", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				text: "Old brief that should be dropped",
				attachments: [],
			} as unknown as CanonicalEvent,
			{
				kind: "compaction",
				phase: "completed",
				after: 500,
			} as unknown as CanonicalEvent,
			{
				kind: "operator_message",
				text: "New message after compaction", // 28 chars -> 7 tokens
				attachments: [],
			} as unknown as CanonicalEvent,
		];
		const breakdown = contextBreakdown(events, { used: 1000, size: 5000 });
		const summaryRow = breakdown.rows.find((r) => r.category === "summary");
		expect(summaryRow?.tokens).toBe(500);
		// Since first operator_message after compaction is the first seen in events.slice(since),
		// it is treated as brief
		const briefRow = breakdown.rows.find((r) => r.category === "brief");
		expect(briefRow?.tokens).toBe(7);
		expect(breakdown.rows.find((r) => r.category === "messages")).toBeUndefined();
	});

	it("orders largest items descending and caps at 5", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				text: "a".repeat(40), // 10 tokens
				attachments: [
					{ name: "file1.txt", mimeType: "text/plain", size: 400 }, // 100 tokens
					{ name: "file2.txt", mimeType: "text/plain", size: 800 }, // 200 tokens
					{ name: "image.png", mimeType: "image/png", size: 10 }, // 1600 tokens
				],
			} as unknown as CanonicalEvent,
			{
				kind: "tool_result",
				result: {
					preview: "b".repeat(120), // 30 tokens
					source: "search",
				},
			} as unknown as CanonicalEvent,
			{
				kind: "tool_result",
				result: {
					preview: "c".repeat(200), // 50 tokens
					source: "db query",
				},
			} as unknown as CanonicalEvent,
		];
		const breakdown = contextBreakdown(events, { used: 3000, size: 20_000 });
		expect(breakdown.largest.length).toBe(5);
		expect(breakdown.largest[0]?.label).toBe("image.png");
		expect(breakdown.largest[0]?.tokens).toBe(1600);
		expect(breakdown.largest[1]?.label).toBe("file2.txt");
		expect(breakdown.largest[1]?.tokens).toBe(200);
		expect(breakdown.largest[2]?.label).toBe("file1.txt");
		expect(breakdown.largest[2]?.tokens).toBe(100);
		expect(breakdown.largest[3]?.label).toBe("db query");
		expect(breakdown.largest[3]?.tokens).toBe(50);
		expect(breakdown.largest[4]?.label).toBe("search");
		expect(breakdown.largest[4]?.tokens).toBe(30);
	});

	it("shows trim text only when top item is >= 10% of window size", () => {
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				text: "brief",
				attachments: [
					{ name: "large.png", mimeType: "image/png", size: 100 }, // 1600 tokens
				],
			} as unknown as CanonicalEvent,
		];

		// size 10_000: 1600 / 10000 = 16% >= 10%
		const withTrim = contextBreakdown(events, { used: 2000, size: 10_000 });
		expect(withTrim.trim).toBe(
			"Compacting with “drop large.png” frees the most",
		);

		// size 20_000: 1600 / 20000 = 8% < 10%
		const withoutTrim = contextBreakdown(events, { used: 2000, size: 20_000 });
		expect(withoutTrim.trim).toBeNull();
	});
});
