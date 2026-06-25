// The thin tool-calling loop we OWN (ADR-0003). No framework orchestrates it. It is an
// async generator that yields StepEvents as they happen (ADR-0007 — the live UI stream)
// and ends by yielding the final report. Each turn: ask the model (with tools) → if it
// submits a report, done → else run the read-only tools it requested and feed results
// back → repeat until done or the step budget is hit.

import { parseReport, submitReportTool } from "./report.js";
import type { ToolRegistry } from "./registry.js";
import type { Message, ModelBackend, Report, StepEvent, ToolDef, ToolResult } from "./types.js";

export const SYSTEM = `You are an SRE incident investigator. You investigate ONLY by running read-only tools to gather evidence, then you reason about root cause.

Method:
- Form an ORDERED set of hypotheses (most likely first). Order replaces any score — NEVER use numeric confidence or probabilities.
- Test hypotheses by gathering evidence. Prefer commands that CONFIRM or REFUTE the leading hypothesis — especially ones that test the CAUSE, not just restate the symptom.
- Track evidence honestly: an observation is "verified" ONLY if a tool you ran directly showed it; otherwise it is "inferred".

Depth before concluding:
- Do NOT conclude on a symptom. Before submitting, your top hypothesis must be supported by at least one VERIFIED observation of its CAUSE (e.g. the error in a log, a failing probe, an exhausted resource) — not merely that something "looks off".
- If you have only observed symptoms, gather one more piece of confirming evidence first.

When to stop and call submit_report:
- The top-ranked hypothesis has a VERIFIED supporting observation of its cause and no VERIFIED contradicting one, OR
- You have run out of useful read-only commands to gather more evidence.
Do not loop forever. When you stop, call submit_report exactly once with ordered hypotheses, their evidence, the root cause (or empty if undetermined), and recommendations.

Constraints:
- Tools are READ-ONLY and allowlisted; mutating commands are rejected. Provide arguments exactly as each tool's schema requires.
- If a command is rejected, adapt — try an allowed read-only command instead.`;

export interface InvestigateOptions {
	backend: ModelBackend;
	tools: ToolRegistry;
	incident: string;
	maxSteps?: number;
	/** Override the system prompt (advanced). */
	system?: string;
}

export async function* investigate(opts: InvestigateOptions): AsyncGenerator<StepEvent, void, void> {
	const { backend, tools, incident } = opts;
	const system = opts.system ?? SYSTEM;
	const maxSteps = opts.maxSteps ?? 15;
	const toolDefs = [...tools.defs(), submitReportTool];
	const messages: Message[] = [{ role: "user", text: incident }];
	let noProgress = 0;

	for (let step = 1; step <= maxSteps; step++) {
		const resp = await backend.complete(system, messages, toolDefs);
		yield { kind: "model_turn", step, text: resp.text, toolCalls: resp.toolCalls.map((t) => ({ name: t.name, args: t.args })) };
		messages.push({
			role: "model",
			text: resp.text || undefined,
			toolCalls: resp.toolCalls.length ? resp.toolCalls : undefined,
		});

		const submit = resp.toolCalls.find((t) => t.name === submitReportTool.name);
		if (submit) {
			yield { kind: "done", step, reason: "submitted" };
			yield { kind: "report", report: parseReport(submit.args) };
			return;
		}

		const calls = resp.toolCalls.filter((t) => t.name !== submitReportTool.name);
		if (calls.length === 0) {
			noProgress++;
			if (noProgress >= 2) {
				yield { kind: "done", step, reason: "no_progress" };
				yield* finalReport(backend, system, messages, toolDefs);
				return;
			}
			messages.push({
				role: "user",
				text: "You issued no tool call. Either run a tool to gather more evidence, or call submit_report if you have enough.",
			});
			continue;
		}

		const results: ToolResult[] = [];
		for (const call of calls) {
			const tool = tools.get(call.name);
			const r = tool ? await tool.run(call.args) : { output: `unknown tool "${call.name}"`, isError: true };
			yield { kind: "tool_result", step, name: call.name, ok: !r.isError, preview: r.output.slice(0, 400) };
			results.push({ id: call.id, name: call.name, output: r.output, isError: r.isError });
		}
		messages.push({ role: "user", toolResults: results });

		// Every tool this turn failed → treat as no progress so junk calls trip the fallback.
		if (results.every((r) => r.isError)) {
			noProgress++;
			if (noProgress >= 2) {
				yield { kind: "done", step, reason: "no_progress" };
				yield* finalReport(backend, system, messages, toolDefs);
				return;
			}
		} else {
			noProgress = 0;
		}
	}

	yield { kind: "done", step: maxSteps, reason: "budget" };
	yield* finalReport(backend, system, messages, toolDefs);
}

/** Budget/no-progress fallback: ask once for a final structured report. */
async function* finalReport(
	backend: ModelBackend,
	system: string,
	messages: Message[],
	toolDefs: ToolDef[],
): AsyncGenerator<StepEvent> {
	messages.push({
		role: "user",
		text: "Stop investigating now. Call submit_report with your best ORDERED hypotheses and the evidence gathered so far, even if incomplete.",
	});
	const resp = await backend.complete(system, messages, toolDefs);
	const submit = resp.toolCalls.find((t) => t.name === submitReportTool.name);
	const report: Report = submit
		? parseReport(submit.args)
		: { summary: resp.text || "Investigation ended without a structured report.", rootCause: null, hypotheses: [], recommendations: [] };
	yield { kind: "report", report };
}

/** Drain the stream to just the final Report, for callers that don't need telemetry. */
export async function runToReport(opts: InvestigateOptions): Promise<Report> {
	let report: Report = { summary: "", rootCause: null, hypotheses: [], recommendations: [] };
	for await (const ev of investigate(opts)) if (ev.kind === "report") report = ev.report;
	return report;
}
