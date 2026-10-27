// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunRecord } from "./record.js";
import {
	CALL_TIMEOUT_MS,
	HarnessRegistry,
	INPUT_CHARS,
	RESULT_CHARS,
	executeTool,
	resultText,
	scrubSecrets,
} from "./registry.js";
import {
	FAILURE_CODES,
	HarnessToolRefused,
	annotationsFor,
	defineHarnessTool,
	fail,
} from "./tool.js";

const makeCtx = (overrides?: Partial<Parameters<typeof executeTool>[2]>) => ({
	runId: "run-1",
	signal: new AbortController().signal,
	record: new RunRecord(),
	...overrides,
});

describe("HarnessRegistry", () => {
	it("refuses an invalid name", () => {
		const registry = new HarnessRegistry();
		const toolBadHyphen = defineHarnessTool({
			name: "Bad-Name",
			title: "Bad",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: "ok" }),
		});
		expect(() => registry.register(toolBadHyphen)).toThrow(HarnessToolRefused);

		const toolDoubleUnderscore = defineHarnessTool({
			name: "a__b",
			title: "Double",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: "ok" }),
		});
		expect(() => registry.register(toolDoubleUnderscore)).toThrow(
			HarnessToolRefused,
		);
	});

	it("refuses a duplicate tool name", () => {
		const registry = new HarnessRegistry();
		const tool1 = defineHarnessTool({
			name: "my_tool",
			title: "My Tool",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: "ok" }),
		});
		const tool2 = defineHarnessTool({
			name: "my_tool",
			title: "Another Tool",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: "ok" }),
		});
		registry.register(tool1);
		expect(() => registry.register(tool2)).toThrow(HarnessToolRefused);
	});

	it("refuses an input schema with runId", () => {
		const registry = new HarnessRegistry();
		const toolWithRunId = defineHarnessTool({
			name: "tool_with_run",
			title: "Run ID Tool",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({ runId: z.string() }),
			run: async () => ({ value: "ok" }),
		});
		expect(() => registry.register(toolWithRunId)).toThrow(HarnessToolRefused);
	});
});

describe("executeTool failure contract", () => {
	it("returns invalid_input when input does not match schema", async () => {
		const tool = defineHarnessTool({
			name: "strict_tool",
			title: "Strict",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({ count: z.number() }),
			run: async () => ({ value: "ok" }),
		});

		const call = await executeTool(tool, { count: "not-a-number" }, makeCtx());
		expect(call.isError).toBe(true);
		const parsed = JSON.parse(call.output);
		expect(parsed.error).toBe("invalid_input");
		expect(parsed.message).toContain("count");
		expect(parsed.next).toBeDefined();
		expect(FAILURE_CODES).toContain(parsed.error);
	});

	it("returns internal error without leaking upstream secret on thrown error", async () => {
		const tool = defineHarnessTool({
			name: "throwing_tool",
			title: "Throwing",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => {
				throw new Error("upstream secret-123");
			},
		});

		const call = await executeTool(
			tool,
			{},
			makeCtx({ secrets: ["secret-123"] }),
		);
		expect(call.isError).toBe(true);
		const parsed = JSON.parse(call.output);
		expect(parsed.error).toBe("internal");
		expect(call.output).not.toContain("secret-123");
		expect(FAILURE_CODES).toContain(parsed.error);
	});

	it("returns timeout when execution exceeds timeoutMs", async () => {
		const tool = defineHarnessTool({
			name: "hanging_tool",
			title: "Hanging",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => new Promise(() => {}),
		});

		const call = await executeTool(tool, {}, makeCtx({ timeoutMs: 20 }));
		expect(call.isError).toBe(true);
		const parsed = JSON.parse(call.output);
		expect(parsed.error).toBe("timeout");
		expect(FAILURE_CODES).toContain(parsed.error);
	});

	it("returns exact failure when tool returns fail()", async () => {
		const tool = defineHarnessTool({
			name: "failing_tool",
			title: "Failing",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => fail("not_found", "m", "n"),
		});

		const call = await executeTool(tool, {}, makeCtx());
		expect(call.isError).toBe(true);
		const parsed = JSON.parse(call.output);
		expect(parsed).toEqual({ error: "not_found", message: "m", next: "n" });
		expect(FAILURE_CODES).toContain(parsed.error);
	});
});

describe("secrets redaction", () => {
	it("redacts configured secrets in output", async () => {
		const tool = defineHarnessTool({
			name: "secret_tool",
			title: "Secret Tool",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => ({
				value: { token: "tok-abcdef" },
				secrets: ["tok-abcdef"],
			}),
		});

		const call = await executeTool(tool, {}, makeCtx());
		expect(call.output).toContain("[redacted]");
		expect(call.output).not.toContain("tok-abcdef");
	});
});

describe("recording and limits", () => {
	it("drops input exceeding INPUT_CHARS", async () => {
		const tool = defineHarnessTool({
			name: "large_input_tool",
			title: "Large Input",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({ data: z.string() }),
			run: async () => ({ value: "ok" }),
		});

		const hugeString = "a".repeat(INPUT_CHARS + 100);
		const call = await executeTool(tool, { data: hugeString }, makeCtx());
		expect(call.inputDropped).toBe(true);
		expect(call.input).toBeUndefined();
	});

	it("keeps input, records metadata for normal call", async () => {
		const tool = defineHarnessTool({
			name: "normal_tool",
			title: "Normal",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({ query: z.string() }),
			run: async () => ({ value: "result" }),
		});

		const call = await executeTool(tool, { query: "hello" }, makeCtx());
		expect(call.input).toEqual({ query: "hello" });
		expect(call.inputDropped).toBeUndefined();
		expect(call.callId).toBeDefined();
		expect(call.schemaHash).toMatch(/^[0-9a-f]{16}$/);
		expect(call.ms).toBeGreaterThanOrEqual(0);
	});

	it("truncates output exceeding RESULT_CHARS with truncation note", async () => {
		const tool = defineHarnessTool({
			name: "huge_output_tool",
			title: "Huge Output",
			description: "desc",
			group: "core",
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: "x".repeat(RESULT_CHARS + 500) }),
		});

		const call = await executeTool(tool, {}, makeCtx());
		expect(call.output).toContain(
			`\n…[truncated at ${RESULT_CHARS} characters; narrow the query]`,
		);
		expect(
			call.output.endsWith(
				`\n…[truncated at ${RESULT_CHARS} characters; narrow the query]`,
			),
		).toBe(true);
	});
});

describe("annotationsFor", () => {
	it("returns readOnly for read effect", () => {
		const annotations = annotationsFor("read");
		expect(annotations).toEqual({
			readOnlyHint: true,
			openWorldHint: false,
		});
	});

	it("returns non-readOnly hints for record effect", () => {
		const annotations = annotationsFor("record");
		expect(annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		});
	});
});
