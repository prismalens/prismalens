import { describe, expect, it } from "vitest";
import { investigate, runToReport } from "./loop.js";
import { type Tool, ToolRegistry } from "./registry.js";
import type { ModelBackend, ModelResponse, StepEvent } from "./types.js";

/** A scripted backend: returns each response in order; empty when exhausted. */
function scriptedBackend(script: ModelResponse[]): ModelBackend {
	let i = 0;
	return {
		id: "fake",
		async complete(): Promise<ModelResponse> {
			return script[i++] ?? { text: "", toolCalls: [] };
		},
	};
}

const echoTool: Tool = {
	def: { name: "echo", description: "echo", parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } },
	async run(args) {
		return { output: `echoed: ${String(args.msg)}`, isError: false };
	},
};

function tools(): ToolRegistry {
	return new ToolRegistry().register(echoTool);
}

describe("investigate loop", () => {
	it("runs a tool, then submits a report", async () => {
		const backend = scriptedBackend([
			{ text: "gathering", toolCalls: [{ id: "1", name: "echo", args: { msg: "hi" } }] },
			{ text: "done", toolCalls: [{ id: "2", name: "submit_report", args: { summary: "s", hypotheses: [{ rank: 1, statement: "h", evidence: [] }] } }] },
		]);
		const events: StepEvent[] = [];
		for await (const e of investigate({ backend, tools: tools(), incident: "x" })) events.push(e);
		const kinds = events.map((e) => e.kind);
		expect(kinds).toContain("tool_result");
		expect(kinds).toContain("report");
		const report = events.find((e) => e.kind === "report");
		expect(report?.kind === "report" && report.report.summary).toBe("s");
	});

	it("forces a final report when the step budget is hit", async () => {
		let calls = 0;
		const backend: ModelBackend = {
			id: "fake",
			async complete(): Promise<ModelResponse> {
				calls++;
				// step 1: gather (no submit) -> budget hit -> forced final call submits.
				return calls <= 1
					? { text: "again", toolCalls: [{ id: "1", name: "echo", args: { msg: "x" } }] }
					: { text: "", toolCalls: [{ id: "f", name: "submit_report", args: { summary: "forced", hypotheses: [] } }] };
			},
		};
		const report = await runToReport({ backend, tools: tools(), incident: "x", maxSteps: 1 });
		expect(report.summary).toBe("forced");
	});

	it("returns an error result for an unknown tool instead of crashing", async () => {
		const backend = scriptedBackend([
			{ text: "", toolCalls: [{ id: "1", name: "nope", args: {} }] },
			{ text: "", toolCalls: [{ id: "2", name: "submit_report", args: { summary: "s", hypotheses: [] } }] },
		]);
		const events: StepEvent[] = [];
		for await (const e of investigate({ backend, tools: tools(), incident: "x" })) events.push(e);
		const tr = events.find((e) => e.kind === "tool_result");
		expect(tr?.kind === "tool_result" && tr.ok).toBe(false);
	});
});
