// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	CALL_TIMEOUT_MS,
	DATA_NOTE,
	HarnessRegistry,
	INPUT_CHARS,
	RESULT_CHARS,
	executeTool,
	resultValue,
	scrubSecrets,
} from "./registry.js";
import {
	FAILURE_CODES,
	HarnessToolRefused,
	annotationsFor,
	defineHarnessTool,
	EVERY_SUBJECT,
	fail,
	type HarnessServes,
	servedTo,
} from "./tool.js";

const makeCtx = (overrides?: Partial<Parameters<typeof executeTool>[2]>) => ({
	runId: "run-1",
	signal: new AbortController().signal,
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
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: "ok" }),
		});
		const tool2 = defineHarnessTool({
			name: "my_tool",
			title: "Another Tool",
			description: "desc",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({ count: z.number() }),
			run: async () => ({ value: "ok" }),
		});

		const call = await executeTool(tool, { count: "not-a-number" }, makeCtx());
		expect(call.isError).toBe(true);
		const parsed = resultValue(call.output);
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
			serves: { subjects: EVERY_SUBJECT },
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
		const parsed = resultValue(call.output);
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
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({}),
			run: async () => new Promise(() => {}),
		});

		const call = await executeTool(tool, {}, makeCtx({ timeoutMs: 20 }));
		expect(call.isError).toBe(true);
		const parsed = resultValue(call.output);
		expect(parsed.error).toBe("timeout");
		expect(FAILURE_CODES).toContain(parsed.error);
	});

	it("returns exact failure when tool returns fail()", async () => {
		const tool = defineHarnessTool({
			name: "failing_tool",
			title: "Failing",
			description: "desc",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({}),
			run: async () => fail("not_found", "m", "n"),
		});

		const call = await executeTool(tool, {}, makeCtx());
		expect(call.isError).toBe(true);
		const parsed = resultValue(call.output);
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
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
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
			serves: { subjects: EVERY_SUBJECT },
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

	it("returns readOnly hints for record effect", () => {
		const annotations = annotationsFor("record");
		expect(annotations).toEqual({
			readOnlyHint: true,
			openWorldHint: false,
		});
	});

	it("marks an act tool as neither read-only nor destructive (#1024)", () => {
		expect(annotationsFor("act")).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		});
	});
});

describe("act tools and limits (#1024)", () => {
	const ctx = { runId: "r1", signal: new AbortController().signal };

	it("answers a cap refusal as limit_reached with the tool's next", async () => {
		const capped = defineHarnessTool({
			name: "capped_tool",
			title: "Capped",
			description: "Refuses at a cap.",
			group: "core",
			effect: "act",
			serves: { subjects: EVERY_SUBJECT },
			input: z.object({}),
			run: async () =>
				fail(
					"limit_reached",
					"This tree already has 10 live threads.",
					"Settings → Agent → Threads per tree.",
				),
		});
		const call = await executeTool(capped, {}, ctx);
		expect(call.isError).toBe(true);
		expect(resultValue(call.output)).toEqual({
			error: "limit_reached",
			message: "This tree already has 10 live threads.",
			next: "Settings → Agent → Threads per tree.",
		});
	});

	it("uses a tool's own timeout for a read tool", async () => {
		const slow = defineHarnessTool({
			name: "slow_read",
			title: "Slow",
			description: "Never answers.",
			group: "core",
			effect: "read",
			serves: { subjects: EVERY_SUBJECT },
			input: z.object({}),
			timeoutMs: 20,
			run: () => new Promise(() => {}),
		});
		const call = await executeTool(slow, {}, ctx);
		expect(resultValue(call.output).error).toBe("timeout");
	});

	it("never cuts an act tool short, so a late write is never answered as a timeout", async () => {
		const act = defineHarnessTool({
			name: "slow_act",
			title: "Slow act",
			description: "Answers after its timeout.",
			group: "core",
			effect: "act",
			serves: { subjects: EVERY_SUBJECT },
			input: z.object({}),
			timeoutMs: 10,
			run: () =>
				new Promise((r) => setTimeout(() => r({ value: { done: true } }), 40)),
		});
		const call = await executeTool(act, {}, ctx);
		expect(call.isError).toBe(false);
		expect(resultValue(call.output)).toEqual({ done: true });
	});
});

describe("round-3 guarantees (#848)", () => {
	const ctx = { runId: "r1", signal: new AbortController().signal };

	it("scrubs secrets from the recorded input as well as the output", async () => {
		const echo = defineHarnessTool({
			name: "echo_tool",
			title: "t",
			description: "d",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({ q: z.string() }),
			run: async ({ q }) => ({ value: { q } }),
		});
		const call = await executeTool(
			echo,
			{ q: "token secret-1234 here" },
			{ ...ctx, secrets: ["secret-1234"] },
		);
		expect(JSON.stringify(call.input)).not.toContain("secret-1234");
		expect(call.output).not.toContain("secret-1234");
	});

	it("puts the data line before every result, a failure included", async () => {
		const ok = defineHarnessTool({
			name: "ok_tool",
			title: "t",
			description: "d",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({}),
			run: async () => ({ value: { a: 1 } }),
		});
		const call = await executeTool(ok, {}, ctx);
		expect(call.output.startsWith(DATA_NOTE)).toBe(true);
		expect(resultValue(call.output)).toEqual({ a: 1 });
		const bad = await executeTool(
			{ ...ok, input: z.object({ n: z.number() }) },
			{ n: "x" },
			ctx,
		);
		expect(bad.output.startsWith(DATA_NOTE)).toBe(true);
	});

	it("never cuts a record call short, so a late write cannot follow a timeout answer", async () => {
		const writes: string[] = [];
		const slow = defineHarnessTool({
			name: "slow_record",
			title: "t",
			description: "d",
			group: "record",
			serves: { subjects: EVERY_SUBJECT },
			effect: "record",
			input: z.object({}),
			run: async () => {
				await new Promise((r) => setTimeout(r, 40));
				writes.push("kept");
				return { value: { recorded: true } };
			},
		});
		const call = await executeTool(slow, {}, { ...ctx, timeoutMs: 5 });
		expect(call.isError).toBe(false);
		expect(writes).toEqual(["kept"]);
	});

	it("aborts a read tool's signal when it times out", async () => {
		let aborted = false;
		const hang = defineHarnessTool({
			name: "hang_tool",
			title: "t",
			description: "d",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({}),
			run: (_i, c) =>
				new Promise((resolve) => {
					c.signal.addEventListener("abort", () => {
						aborted = true;
						resolve({ value: null });
					});
				}),
		});
		const call = await executeTool(hang, {}, { ...ctx, timeoutMs: 5 });
		expect(resultValue(call.output)).toMatchObject({ error: "timeout" });
		expect(aborted).toBe(true);
	});
});

describe("round-4 guarantees (#848)", () => {
	const ctx = { runId: "r1", signal: new AbortController().signal };

	it("scrubs the recorded input with the secrets the tool itself returned", async () => {
		const tool = defineHarnessTool({
			name: "own_secret",
			title: "t",
			description: "d",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({ q: z.string() }),
			run: async ({ q }) => ({ value: { q }, secrets: ["secret-1234"] }),
		});
		const call = await executeTool(tool, { q: "secret-1234" }, ctx);
		expect(JSON.stringify(call.input)).not.toContain("secret-1234");
		expect(call.output).not.toContain("secret-1234");
	});

	it("keeps a handler that throws before returning a promise inside the failure contract", async () => {
		const tool = defineHarnessTool({
			name: "sync_throw",
			title: "t",
			description: "d",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({}),
			run: () => {
				throw new Error("boom");
			},
		});
		const call = await executeTool(tool, {}, ctx);
		expect(call.isError).toBe(true);
		expect(resultValue(call.output).error).toBe("internal");
	});
});

describe("round-5 guarantees (#848)", () => {
	it("scrubs a secret inside string values only, so the recorded input stays valid", async () => {
		const tool = defineHarnessTool({
			name: "port_tool",
			title: "t",
			description: "d",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "read",
			input: z.object({ q: z.string(), port: z.number() }),
			run: async () => ({ value: { ok: true }, secrets: ["1234"] }),
		});
		const call = await executeTool(
			tool,
			{ q: "pw 1234", port: 1234 },
			{ runId: "r1", signal: new AbortController().signal },
		);
		expect(call.input).toEqual({ q: "pw [redacted]", port: 1234 });
	});
});

describe("servedTo (#1020): a run sees the tools its subject and debt can use", () => {
	const tool = (name: string, serves: HarnessServes) =>
		defineHarnessTool({
			name,
			title: name,
			description: "desc",
			group: "core",
			effect: "read",
			serves,
			input: z.object({}),
			run: async () => ({ value: "ok" }),
		});
	const tools = [
		tool("anywhere", { subjects: EVERY_SUBJECT }),
		tool("incident_only", { subjects: ["incident"] }),
		tool("report_only", { subjects: EVERY_SUBJECT, owes: "report" }),
	];
	const names = (subject?: "incident" | "project", owes?: "answer" | "report") =>
		servedTo(tools, { subject, owes }).map((t) => t.name);

	it("keeps a subject's tools and drops the rest", () => {
		expect(names("project", "report")).toEqual(["anywhere", "report_only"]);
		expect(names("incident", "report")).toEqual([
			"anywhere",
			"incident_only",
			"report_only",
		]);
	});

	it("drops a report's tools from a run that owes an answer", () => {
		expect(names("incident", "answer")).toEqual(["anywhere", "incident_only"]);
	});

	it("keeps every tool when the scope is unknown", () => {
		expect(names()).toEqual(["anywhere", "incident_only", "report_only"]);
	});
});
