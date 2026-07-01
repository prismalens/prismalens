/**
 * Minimal Tier-1 supervisor driver (ADR-0008, Phase-1 / sreforge diagnosis eval).
 *
 * Decompose is N=1 here: one firing alert → one rented-harness branch → reduce.
 * The harness investigates READ-ONLY using its own shell (CLI-primary: it runs
 * `curl`/`cat`/`grep` against the telemetry endpoints + source in its cwd) — no
 * bespoke MCP tools yet. We collect the canonical stream and synthesize the
 * ordered-evidence report.
 */
import { randomUUID } from "node:crypto";
import type {
	CanonicalEvent,
	FiringAlert,
	InvestigationReport,
	TelemetryEndpoints,
} from "@prismalens/contracts";
import type { AdapterContext } from "../adapter/acp-adapter.js";
import {
	type AcpClientConfig,
	autoAllowReadOnly,
} from "../runner/acp-client.js";
import {
	type ClaudeCodeConfig,
	runClaudeCodeBranch,
} from "../runner/claude-code-runner.js";
import { runDeepAgentsBranch } from "../runner/acp-run-branch.js";
import { type SynthesisModelConfig, synthesizeReport } from "./synthesize.js";

/**
 * A Tier-2 harness as the supervisor sees it: given the investigation prompt and a
 * branch context, yield the canonical event stream. deepagents (ACP) and Claude
 * Code (Agent SDK) both reduce to this one shape.
 */
export type HarnessRunner = (
	prompt: string,
	ctx: AdapterContext,
) => AsyncGenerator<CanonicalEvent>;

/** deepagents over ACP — the zero-setup, read-only-by-default local harness. */
export function deepAgentsHarness(
	cfg: Omit<AcpClientConfig, "prompt">,
): HarnessRunner {
	return (prompt, ctx) =>
		runDeepAgentsBranch(
			{ ...cfg, prompt, permission: cfg.permission ?? autoAllowReadOnly },
			ctx,
		);
}

/** Claude Code over the Agent SDK — the deep path (subagent tree, read-only). */
export function claudeCodeHarness(
	cfg: Omit<ClaudeCodeConfig, "prompt">,
): HarnessRunner {
	return (prompt, ctx) => runClaudeCodeBranch({ ...cfg, prompt }, ctx);
}

export interface InvestigateOptions {
	/** The firing alert that seeds the investigation. */
	alert: FiringAlert;
	/** Read-only telemetry + app endpoints the harness may query. */
	telemetry: TelemetryEndpoints;
	/** Tier-2 harness runner — e.g. deepAgentsHarness(...) or claudeCodeHarness(...). */
	harness: HarnessRunner;
	/** Tier-1 reduce model (Vercel AI SDK). */
	synth: SynthesisModelConfig;
	/** Investigation run id (== Investigation.id). Generated if omitted. */
	runId?: string;
}

export interface InvestigationResult {
	runId: string;
	report: InvestigationReport;
	events: CanonicalEvent[];
}

/**
 * Streaming Tier-1 supervisor primitive (ADR-0010): drive the rented harness and
 * yield the canonical stream live, then emit the synthesized report as the terminal
 * `report` event. The UI consumes events as they arrive instead of waiting for the
 * whole run to buffer.
 */
export async function* investigateIncidentStream(
	opts: InvestigateOptions,
): AsyncGenerator<CanonicalEvent> {
	const runId = opts.runId ?? randomUUID();
	const prompt = buildInvestigationPrompt(opts.alert, opts.telemetry);
	const collected: CanonicalEvent[] = [];
	for await (const ev of opts.harness(prompt, { runId, branchId: "root" })) {
		collected.push(ev);
		yield ev;
	}
	// No-evidence guard: a branch that gathered nothing and errored must NOT be
	// laundered into a fabricated report — the error event already conveyed failure.
	const terminal = collected.at(-1);
	const toolResults = collected.filter((e) => e.kind === "tool_result").length;
	if (toolResults === 0 && terminal?.kind === "error") return;
	const transcript = buildTranscript(opts.alert, collected);
	const report = await synthesizeReport(transcript, opts.synth);
	yield {
		kind: "report",
		runId,
		seq: collected.length,
		ts: new Date().toISOString(),
		report,
	};
}

export async function investigateIncident(
	opts: InvestigateOptions,
): Promise<InvestigationResult> {
	const runId = opts.runId ?? randomUUID();
	const events: CanonicalEvent[] = [];
	let report: InvestigationReport | null = null;
	for await (const ev of investigateIncidentStream({ ...opts, runId })) {
		if (ev.kind === "report") report = ev.report;
		else events.push(ev);
	}

	// Don't let a failed branch be laundered into a fabricated RCA: if the harness
	// gathered no evidence and ended in error, the stream emits no report — surface
	// the transport failure instead of synthesizing a confident report.
	if (!report) {
		const last = events.at(-1);
		const why = last?.kind === "error" ? last.message : "no evidence gathered";
		throw new Error(
			`investigation produced no evidence — the harness branch failed: ${why}`,
		);
	}

	return { runId, report, events };
}

/** The neutral on-call brief handed to the rented harness. */
export function buildInvestigationPrompt(
	alert: FiringAlert,
	t: TelemetryEndpoints,
): string {
	const labels = JSON.stringify(alert.labels);
	const annotations = JSON.stringify(alert.annotations);
	return `You are an on-call Site Reliability Engineer running a LIVE investigation of a firing production alert. Your job is to find the ROOT CAUSE — the specific code path, configuration, dependency, or resource that produced this alert — not merely the symptom.

FIRING ALERT
  name:        ${alert.alertname}
  severity:    ${alert.severity ?? "unknown"}
  labels:      ${labels}
  annotations: ${annotations}

READ-ONLY SURFACES (never modify, deploy, restart, or write anything)
  - Prometheus    ${t.prometheusUrl}
      curl -s '${t.prometheusUrl}/api/v1/query' --data-urlencode 'query=<promql>'   ·   /api/v1/rules   ·   /api/v1/label/__name__/values
  - Alertmanager  ${t.alertmanagerUrl}      curl -s '${t.alertmanagerUrl}/api/v2/alerts'
  - Application API ${t.apiUrl}
  - Application SOURCE CODE is in your current working directory — ls / cat / grep / head.

METHOD (work iteratively — think → run a command → observe → decide)
  1. Confirm the alert's signal in Prometheus: which metric/expression fired and how far past threshold.
  2. After EACH command, say in one line what you learned and what you will check next; let the evidence pick the next probe.
  3. Localize, then go to the code. Identify WHICH operation/endpoint/component the signal is about — e.g. for a latency
     alert, find the SLOWEST endpoint or operation — then READ that code path's handler and the configuration it depends on.
  4. Never run the same command with the same arguments twice. If your last couple of probes produced nothing new, stop and write the diagnosis.

WHAT COUNTS AS A ROOT CAUSE (important)
  Restating the symptom is NOT a root cause. "The service is slow / unresponsive / latency is high" is the alert restated,
  not its cause. A surface symptom (e.g. requests timing out) is almost always a downstream EFFECT — keep digging until you
  can name the concrete code, configuration, dependency, or resource responsible and explain the mechanism that links it to
  the alert.

OUTPUT
  State the single most likely root cause and the mechanism. List the evidence as VALIDATED (a command/metric/file directly
  showed it — quote the exact command) versus INFERRED (reasoned, not directly observed). Recommend a fix. Be specific and
  concise; never assert without evidence.`;
}

const PREVIEW_CAP = 1200;
const TRANSCRIPT_CAP = 24_000;

/** Compact the canonical stream into a transcript the reduce model can read. */
export function buildTranscript(
	alert: FiringAlert,
	events: CanonicalEvent[],
): string {
	const lines: string[] = [
		`FIRING ALERT: ${alert.alertname} (severity=${alert.severity ?? "unknown"})`,
		`annotations: ${JSON.stringify(alert.annotations)}`,
		"",
		"AGENT INVESTIGATION (steps, tool calls, and observed results):",
	];
	for (const ev of events) {
		if (ev.kind === "agent_step") {
			if (ev.text.trim()) lines.push(`\n[think] ${ev.text.trim()}`);
			for (const tc of ev.toolCalls) {
				lines.push(
					`[call] ${tc.name} ${JSON.stringify(tc.args).slice(0, 300)}`,
				);
			}
		} else if (ev.kind === "tool_result") {
			const r = ev.result;
			lines.push(
				`[result ${r.ok ? "ok" : "ERROR"}] ${r.source}\n${truncate(r.preview, PREVIEW_CAP)}`,
			);
		} else if (ev.kind === "branch_done") {
			lines.push(`\n[branch ended: ${ev.reason}]`);
		} else if (ev.kind === "error") {
			lines.push(`\n[branch error: ${ev.message}]`);
		}
	}
	return truncate(lines.join("\n"), TRANSCRIPT_CAP);
}

function truncate(s: string, cap: number): string {
	return s.length > cap ? `${s.slice(0, cap)}\n…[truncated]` : s;
}
