// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	parseReport,
	reportJsonSchema,
	retryPrompt,
	stampReport,
} from "./report.js";

const VALID = {
	summary: "pool exhausted",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [],
	ruledOut: [],
	coverage: { queried: ["git log"], notQueried: [] },
	nextSteps: [],
};

describe("parseReport", () => {
	it("takes the LAST fenced json block and validates it", () => {
		const text = `thinking...\n\`\`\`json\n{"summary":"draft"}\n\`\`\`\nfinal:\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n`;
		const r = parseReport(text);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.report.summary).toBe("pool exhausted");
	});

	it("skips a ```json fence the model only mentioned in prose (#337 run e)", () => {
		const text = `Final answer must be ONLY one \`\`\`json block; JSON schema requires summary.\nDone.\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n`;
		const r = parseReport(text);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.report.summary).toBe("pool exhausted");
	});

	it("reads past a ``` inside a string when the block's own fence closes it", () => {
		const withFence = { ...VALID, summary: "see the ``` marker in logs" };
		const text = `\`\`\`json\n${JSON.stringify(withFence)}\n\`\`\`\n`;
		const r = parseReport(text);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.report.summary).toContain("marker");
	});

	it("still reports invalid-json for an object block that does not parse", () => {
		expect(parseReport("```json\n{\"summary\": \n```")).toMatchObject({ ok: false, reason: "invalid-json" });
	});

	it("names the failure kind: no block, bad json, schema", () => {
		expect(parseReport("no report here")).toMatchObject({ ok: false, reason: "no-json-block" });
		expect(parseReport("```json\n{oops\n```")).toMatchObject({ ok: false, reason: "invalid-json" });
		const r = parseReport('```json\n{"summary":""}\n```');
		expect(r).toMatchObject({ ok: false, reason: "schema" });
		if (!r.ok) expect(r.detail).toContain("summary");
	});

	it("retry prompt carries the failure detail and forbids more tools", () => {
		const r = parseReport("nothing");
		if (r.ok) throw new Error("expected failure");
		const p = retryPrompt(r);
		expect(p).toContain("no-json-block");
		expect(p).toContain("Do not run more tools");
	});

	it("exposes a JSON schema without the host-stamped fidelity", () => {
		const schema = JSON.parse(reportJsonSchema()) as { properties: Record<string, unknown> };
		expect(schema.properties).toHaveProperty("hypotheses");
		expect(schema.properties).toHaveProperty("flaggedContent");
		expect(schema.properties).not.toHaveProperty("fidelity");
	});
});

describe("stampReport: host facts stay inferred (#633)", () => {
	const evidence = (source: string, extra: Record<string, unknown> = {}) => ({
		observation: "deploy 4f2a landed 3m before the alert",
		source,
		direction: "supports" as const,
		status: "verified" as const,
		toolCallId: "call-1",
		...extra,
	});

	it("records evidence citing the context pack as inferred with no tool call, even without `origin`", () => {
		const stamped = stampReport(
			{
				...VALID,
				hypotheses: [
					{
						statement: "the deploy did it",
						status: "supported" as const,
						evidence: [evidence("context-pack:changes[0]"), evidence("git log -5")],
					},
				],
				ruledOut: [
					{
						statement: "the neighbour",
						why: "quiet",
						evidence: [evidence("anything", { origin: "context-pack" })],
					},
				],
			} as never,
			undefined,
		);
		const [pack, tool] = stamped.hypotheses[0].evidence;
		expect(pack).toMatchObject({ status: "inferred", toolCallId: null, origin: "context-pack" });
		expect(tool).toMatchObject({ status: "verified", toolCallId: "call-1" });
		expect(stamped.ruledOut[0].evidence[0]).toMatchObject({ status: "inferred", toolCallId: null });
	});
});
