// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseReport, reportJsonSchema, retryPrompt } from "./report.js";

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
