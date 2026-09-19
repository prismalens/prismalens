// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The report is the last fenced json block of the harness's final message,
 * validated against InvestigationReportSchema (ADR 0002 §3). ACP has no
 * structured-output primitive, so this is the contract, with in-session
 * retries that carry the failure back: one for a message with no usable
 * block, one for a block that fails the schema (see `retryBudgetKey`).
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

const OPEN_FENCE = /```json\b/gi;
const CLOSE_FENCE = "```";

type Located =
	| { kind: "parsed"; value: unknown }
	| { kind: "invalid"; error: string }
	| { kind: "none" };

/**
 * The report block is the last ```json fence whose body is a JSON object. A
 * fence the model merely mentions in prose ("reply with one ```json block")
 * is not a block, so an opening whose body does not start with `{` is
 * skipped; #337 run e lost a valid report to exactly that mention. A body
 * that opens with `{` but stops at an inner ``` is retried against the last
 * closing fence in the message.
 */
function locateReportBlock(text: string): Located {
	const openings = [...text.matchAll(OPEN_FENCE)].map(
		(m) => (m.index ?? 0) + m[0].length,
	);
	for (let i = openings.length - 1; i >= 0; i--) {
		const start = openings[i] as number;
		const close = text.indexOf(CLOSE_FENCE, start);
		if (close === -1) continue;
		const body = text.slice(start, close).trim();
		if (!body.startsWith("{")) continue;
		const candidates = [body];
		const lastClose = text.lastIndexOf(CLOSE_FENCE);
		if (lastClose > close) candidates.push(text.slice(start, lastClose).trim());
		let error = "invalid JSON";
		for (const raw of candidates) {
			try {
				return { kind: "parsed", value: JSON.parse(raw) };
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
			}
		}
		return { kind: "invalid", error };
	}
	return { kind: "none" };
}

export function extractJsonBlock(text: string): unknown | undefined {
	const located = locateReportBlock(text);
	return located.kind === "parsed" ? located.value : undefined;
}

export type ReportParse =
	| { ok: true; report: ModelReport }
	| {
			ok: false;
			reason: "no-json-block" | "invalid-json" | "schema";
			detail: string;
	  };

export function parseReport(text: string): ReportParse {
	const located = locateReportBlock(text);
	if (located.kind === "none") {
		return {
			ok: false,
			reason: "no-json-block",
			detail:
				"no fenced ```json block holding a JSON object in the final message",
		};
	}
	if (located.kind === "invalid") {
		return { ok: false, reason: "invalid-json", detail: located.error };
	}
	const parsed = ModelReportSchema.safeParse(located.value);
	if (parsed.success) return { ok: true, report: parsed.data };
	const detail = parsed.error.issues
		.slice(0, 20)
		.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
		.join("; ");
	return { ok: false, reason: "schema", detail };
}

export type ReportFailure = Extract<ReportParse, { ok: false }>;

/**
 * Which retry a failure spends. Extraction failures (no block, bad JSON) and
 * schema failures each get one, so a message that hid its block does not use
 * up the retry that carries the validation errors back (#337 run e, G10).
 */
export function retryBudgetKey(
	failure: ReportFailure,
): "extraction" | "schema" {
	return failure.reason === "schema" ? "schema" : "extraction";
}

export function retryPrompt(failure: ReportFailure): string {
	return `Your final message did not carry a valid report (${failure.reason}: ${failure.detail}).
Reply with ONLY one fenced \`\`\`json block that validates against the schema you were given, and nothing else. Do not run more tools.`;
}

export function stampReport(
	report: ModelReport,
	fidelity: InvestigationReport["fidelity"],
): InvestigationReport {
	return { ...report, ...(fidelity ? { fidelity } : {}) };
}
