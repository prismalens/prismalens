import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	DeepAgentsAdapter,
	deriveSource,
	flattenContent,
	type HarnessStreamEvent,
	parsePath,
	unwrapInput,
} from "./deepagents-adapter.js";

const FIXED = new Date("2026-06-28T00:00:00.000Z");
const ctx = {
	runId: "11111111-1111-1111-1111-111111111111",
	branchId: "root",
	now: () => FIXED,
};

describe("helpers", () => {
	it("unwrapInput unwraps the deepagents {input:'<json>'} wrapper", () => {
		expect(unwrapInput({ input: '{"namespace":"prod"}' })).toEqual({
			namespace: "prod",
		});
	});

	it("unwrapInput passes through normal args and non-JSON input", () => {
		expect(unwrapInput({ namespace: "prod" })).toEqual({ namespace: "prod" });
		expect(unwrapInput({ input: "not json" })).toEqual({ input: "not json" });
	});

	it("flattenContent joins content blocks and passes strings through", () => {
		expect(
			flattenContent([
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			]),
		).toBe("ab");
		expect(flattenContent("plain")).toBe("plain");
	});

	it("parsePath drops uuids and the synthetic tools wrapper", () => {
		expect(
			parsePath({ langgraph_checkpoint_ns: "agent:u1|tools:u2|gatherer:u3" }),
		).toEqual(["agent", "gatherer"]);
		expect(parsePath({})).toEqual([]);
	});

	it("deriveSource renders tool + unwrapped input", () => {
		expect(deriveSource("kubectl_get", { input: '{"resource":"pods"}' })).toBe(
			'kubectl_get({"resource":"pods"})',
		);
	});
});

describe("DeepAgentsAdapter.normalize", () => {
	it("maps on_chat_model_end → agent_step with unwrapped tool calls", () => {
		const adapter = new DeepAgentsAdapter(ctx);
		const ev: HarnessStreamEvent = {
			event: "on_chat_model_end",
			name: "model",
			run_id: "r1",
			metadata: { langgraph_checkpoint_ns: "agent:abc" },
			data: {
				output: {
					content: [{ type: "text", text: "checking pods" }],
					tool_calls: [
						{
							id: "call_1",
							name: "kubectl_get",
							args: { input: '{"resource":"pods"}' },
						},
					],
				},
			},
		};
		const out = adapter.normalize(ev);
		expect(out).toMatchObject({
			kind: "agent_step",
			runId: ctx.runId,
			branchId: "root",
			path: ["agent"],
			seq: 0,
			label: null,
			text: "checking pods",
			toolCalls: [
				{ toolCallId: "call_1", name: "kubectl_get", args: { resource: "pods" } },
			],
			ts: FIXED.toISOString(),
		});
		expect(CanonicalEventSchema.safeParse(out).success).toBe(true);
	});

	it("maps on_tool_end → tool_result with ok=false on error status", () => {
		const adapter = new DeepAgentsAdapter(ctx);
		const ev: HarnessStreamEvent = {
			event: "on_tool_end",
			name: "kubectl_get",
			run_id: "r2",
			metadata: { langgraph_checkpoint_ns: "tools:xyz" },
			data: {
				input: { resource: "pods" },
				output: { status: "error", content: "NotFound", tool_call_id: "call_1" },
			},
		};
		const out = adapter.normalize(ev);
		expect(out).toMatchObject({
			kind: "tool_result",
			path: [],
			result: {
				name: "kubectl_get",
				toolCallId: "call_1",
				ok: false,
				error: "NotFound",
				preview: "NotFound",
			},
		});
		expect(CanonicalEventSchema.safeParse(out).success).toBe(true);
	});

	it("returns null for unsurfaced events", () => {
		const adapter = new DeepAgentsAdapter(ctx);
		expect(
			adapter.normalize({ event: "on_chain_start", name: "x", run_id: "r" }),
		).toBeNull();
	});

	it("keeps seq monotonic across normalize + terminal events, all schema-valid", () => {
		const adapter = new DeepAgentsAdapter(ctx);
		const step = adapter.normalize({
			event: "on_chat_model_end",
			name: "model",
			run_id: "r",
			data: { output: { content: "hi", tool_calls: [] } },
		});
		const done = adapter.branchDone("submitted");
		const report = adapter.report({
			summary: "ordered-evidence report",
			rootCause: null,
			rootCauseCategory: null,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: [], notQueried: [] },
			nextSteps: [],
		});
		expect(step?.seq).toBe(0);
		expect(done.seq).toBe(1);
		expect(report.seq).toBe(2);
		expect(CanonicalEventSchema.safeParse(done).success).toBe(true);
		expect(CanonicalEventSchema.safeParse(report).success).toBe(true);
	});
});
