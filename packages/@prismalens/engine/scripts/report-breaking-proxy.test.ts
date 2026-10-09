// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseReport } from "../src/run/report.js";
import {
	breakBraces,
	breakJsonBody,
	breakSseLine,
} from "./report-breaking-proxy.js";

describe("the R7 report-breaking proxy (#804 OBJ-029)", () => {
	const report = '```json\n{"summary":"pool exhausted","hypotheses":[]}\n```';

	it("leaves a report that cannot parse", () => {
		expect(parseReport(report).ok).toBe(false);
		expect(breakBraces(report)).toBe('```json\n("summary":"pool exhausted","hypotheses":[])\n```');
	});

	it("breaks text deltas and text blocks, and passes tool input untouched", () => {
		const text = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: '{"a":1}' } })}`;
		expect(JSON.parse(breakSseLine(text).slice(6)).delta.text).toBe('("a":1)');
		const tool = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } })}`;
		expect(breakSseLine(tool)).toBe(tool);
		expect(breakSseLine("event: ping")).toBe("event: ping");
		const body = JSON.stringify({ content: [{ type: "text", text: "{x}" }, { type: "tool_use", input: { a: 1 } }] });
		expect(JSON.parse(breakJsonBody(body)).content).toEqual([
			{ type: "text", text: "(x)" },
			{ type: "tool_use", input: { a: 1 } },
		]);
	});
});
