// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The report is the last fenced json block of the harness's final message,
 * validated against InvestigationReportSchema (ADR 0002 §3). ACP has no
 * structured-output primitive, so this is the contract, with one in-session
 * retry that carries the validation errors back.
 */
import {
	type InvestigationReport,
	InvestigationReportSchema,
} from "@prismalens/contracts/schemas";
import { z } from "zod";

/** Host-stamped fields the model must not author. */
export const ModelReportSchema = InvestigationReportSchema.omit({
	fidelity: true,
});
export type ModelReport = z.infer<typeof ModelReportSchema>;

export function reportJsonSchema(): string {
	return JSON.stringify(z.toJSONSchema(ModelReportSchema));
}

const FENCE = /```json\s*([\s\S]*?)```/g;

export function extractJsonBlock(text: string): unknown | undefined {
	const blocks = [...text.matchAll(FENCE)];
	if (blocks.length === 0) return undefined;
	const raw = blocks[blocks.length - 1]?.[1] ?? "";
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export type ReportParse =
	| { ok: true; report: ModelReport }
	| {
			ok: false;
			reason: "no-json-block" | "invalid-json" | "schema";
			detail: string;
	  };

export function parseReport(text: string): ReportParse {
	const blocks = [...text.matchAll(FENCE)];
	if (blocks.length === 0) {
		return {
			ok: false,
			reason: "no-json-block",
			detail: "no fenced ```json block in the final message",
		};
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(blocks[blocks.length - 1]?.[1] ?? "");
	} catch (err) {
		return {
			ok: false,
			reason: "invalid-json",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
	const parsed = ModelReportSchema.safeParse(candidate);
	if (parsed.success) return { ok: true, report: parsed.data };
	const detail = parsed.error.issues
		.slice(0, 20)
		.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
		.join("; ");
	return { ok: false, reason: "schema", detail };
}

export function retryPrompt(
	failure: Extract<ReportParse, { ok: false }>,
): string {
	return `Your final message did not carry a valid report (${failure.reason}: ${failure.detail}).
Reply with ONLY one fenced \`\`\`json block that validates against the schema you were given, and nothing else. Do not run more tools.`;
}

export function stampReport(
	report: ModelReport,
	fidelity: InvestigationReport["fidelity"],
): InvestigationReport {
	return { ...report, ...(fidelity ? { fidelity } : {}) };
}
