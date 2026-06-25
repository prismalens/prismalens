// The thin tool-calling loop we OWN (ADR-0003). No framework orchestrates it.
// Each turn: ask the model (with tools) → if it submits a report, done → else run
// the read-only shell tools it requested and feed results back → repeat until done
// or the step budget is hit.

import type { EventSink, Message, ModelBackend, Report, ToolResult } from "./types.js";
import { parseReport, submitReportTool } from "./report.js";
import { type Allowlist, runShellExec, shellExecTool } from "./tools/shell-exec.js";

const SYSTEM = `You are an SRE incident investigator. You investigate ONLY by running read-only shell commands via the shell_exec tool to gather evidence, then you reason about root cause.

Method:
- Form an ORDERED set of hypotheses (most likely first). Order replaces any score — NEVER use numeric confidence or probabilities.
- Test hypotheses by gathering evidence with shell_exec. Prefer commands that would CONFIRM or REFUTE the leading hypothesis.
- Track evidence honestly: an observation is "verified" ONLY if a command you ran directly showed it; otherwise it is "inferred".

When to stop and call submit_report:
- The top-ranked hypothesis has at least one VERIFIED supporting observation and no VERIFIED contradicting observation, OR
- You have run out of useful read-only commands to gather more evidence.
Do not loop forever. When you stop, call submit_report exactly once with ordered hypotheses, their evidence, the root cause (or empty if undetermined), and recommendations.

Constraints:
- shell_exec is READ-ONLY and allowlisted; mutating commands are rejected. Provide the binary and an args array separately (no pipes/redirects).
- If a command is rejected, adapt — try an allowed read-only command instead.`;

export interface LoopOptions {
	backend: ModelBackend;
	allowlist: Allowlist;
	incident: string;
	maxSteps?: number;
	onEvent?: EventSink;
}

export async function investigate(opts: LoopOptions): Promise<Report> {
	const { backend, allowlist, incident } = opts;
	const maxSteps = opts.maxSteps ?? 15;
	const emit: EventSink = opts.onEvent ?? (() => {});
	const tools = [shellExecTool, submitReportTool];
	const messages: Message[] = [{ role: "user", text: incident }];
	let noProgress = 0;

	for (let step = 1; step <= maxSteps; step++) {
		const resp = await backend.complete(SYSTEM, messages, tools);
		emit({ kind: "model_turn", step, text: resp.text, toolCalls: resp.toolCalls.map((t) => ({ name: t.name, args: t.args })) });
		messages.push({
			role: "model",
			text: resp.text || undefined,
			toolCalls: resp.toolCalls.length ? resp.toolCalls : undefined,
		});

		const submit = resp.toolCalls.find((t) => t.name === "submit_report");
		if (submit) {
			emit({ kind: "done", step, reason: "submitted" });
			return finalize(parseReport(submit.args), emit);
		}

		const shellCalls = resp.toolCalls.filter((t) => t.name === "shell_exec");
		if (shellCalls.length === 0) {
			noProgress++;
			if (noProgress >= 2) {
				emit({ kind: "done", step, reason: "no_progress" });
				return finalize(await forceReport(backend, messages, emit), emit);
			}
			messages.push({
				role: "user",
				text: "You issued no tool call. Either run a read-only shell_exec to gather more evidence, or call submit_report if you have enough.",
			});
			continue;
		}
		const results: ToolResult[] = [];
		for (const call of shellCalls) {
			const command = typeof call.args.command === "string" ? call.args.command : "";
			const rawArgs = call.args.args;
			let output: string;
			let isError: boolean;
			if (!command) {
				output = "missing or invalid 'command' (must be a string)";
				isError = true;
			} else if (!Array.isArray(rawArgs)) {
				output = `'args' must be an array of strings, e.g. ["get","pods"]`;
				isError = true;
			} else {
				const args = rawArgs.map((a) => String(a));
				const r = await runShellExec(allowlist, command, args);
				output = `$ ${command} ${args.join(" ")}\n${r.output}`;
				isError = r.isError;
			}
			emit({ kind: "tool_result", step, name: "shell_exec", ok: !isError, preview: output.slice(0, 400) });
			results.push({ id: call.id, name: "shell_exec", output, isError });
		}
		messages.push({ role: "user", toolResults: results });
		// If every command this turn failed (rejected/invalid), treat it as no progress so
		// repeated junk calls trip the fallback instead of silently burning the budget.
		if (results.every((r) => r.isError)) {
			noProgress++;
			if (noProgress >= 2) {
				emit({ kind: "done", step, reason: "no_progress" });
				return finalize(await forceReport(backend, messages, emit), emit);
			}
		} else {
			noProgress = 0;
		}
	}

	emit({ kind: "done", step: maxSteps, reason: "budget" });
	return finalize(await forceReport(backend, messages, emit), emit);
}

/** Budget/no-progress fallback: ask once for a final structured report. */
async function forceReport(backend: ModelBackend, messages: Message[], _emit: EventSink): Promise<Report> {
	messages.push({
		role: "user",
		text: "Stop investigating now. Call submit_report with your best ORDERED hypotheses and the evidence gathered so far, even if incomplete.",
	});
	const resp = await backend.complete(SYSTEM, messages, [shellExecTool, submitReportTool]);
	const submit = resp.toolCalls.find((t) => t.name === "submit_report");
	if (submit) return parseReport(submit.args);
	return {
		summary: resp.text || "Investigation ended without a structured report.",
		rootCause: null,
		hypotheses: [],
		recommendations: [],
	};
}

function finalize(report: Report, emit: EventSink): Report {
	emit({ kind: "report", report });
	return report;
}
