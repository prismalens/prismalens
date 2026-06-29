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
	InvestigationReport,
} from "@prismalens/contracts";
import {
	type AcpClientConfig,
	autoAllowReadOnly,
} from "../runner/acp-client.js";
import { runDeepAgentsBranch } from "../runner/run-branch.js";
import type { FiringAlert } from "./alert-source.js";
import { type SynthesisModelConfig, synthesizeReport } from "./synthesize.js";

export interface TelemetryEndpoints {
	/** Prometheus base URL as seen by the harness (host: http://localhost:9090). */
	prometheusUrl: string;
	/** Alertmanager base URL (host: http://localhost:9093). */
	alertmanagerUrl: string;
	/** The application's own API base URL (host: http://localhost:5000). */
	apiUrl: string;
}

export interface InvestigateOptions {
	/** The firing alert that seeds the investigation. */
	alert: FiringAlert;
	/** Read-only telemetry + app endpoints the harness may query. */
	telemetry: TelemetryEndpoints;
	/** Tier-2 harness (deepagents over ACP) config. */
	harness: Pick<
		AcpClientConfig,
		"cwd" | "model" | "env" | "promptTimeoutMs" | "initTimeoutMs"
	>;
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

export async function investigateIncident(
	opts: InvestigateOptions,
): Promise<InvestigationResult> {
	const runId = opts.runId ?? randomUUID();
	const prompt = buildInvestigationPrompt(opts.alert, opts.telemetry);

	const events: CanonicalEvent[] = [];
	for await (const ev of runDeepAgentsBranch(
		{
			cwd: opts.harness.cwd,
			prompt,
			model: opts.harness.model,
			env: opts.harness.env,
			promptTimeoutMs: opts.harness.promptTimeoutMs,
			initTimeoutMs: opts.harness.initTimeoutMs,
			permission: autoAllowReadOnly,
		},
		{ runId, branchId: "root" },
	)) {
		events.push(ev);
	}

	// Don't let a failed branch be laundered into a fabricated RCA: if the harness
	// gathered no evidence and ended in error, surface the transport failure instead
	// of synthesizing a confident report from the error text.
	const terminal = events.at(-1);
	const toolResults = events.filter((e) => e.kind === "tool_result").length;
	if (toolResults === 0 && terminal?.kind === "error") {
		throw new Error(
			`investigation produced no evidence — the harness branch failed: ${terminal.message}`,
		);
	}

	const transcript = buildTranscript(opts.alert, events);
	const report = await synthesizeReport(transcript, opts.synth);
	return { runId, report, events };
}

/** The neutral on-call brief handed to the rented harness. */
export function buildInvestigationPrompt(
	alert: FiringAlert,
	t: TelemetryEndpoints,
): string {
	const labels = JSON.stringify(alert.labels);
	const annotations = JSON.stringify(alert.annotations);
	return `You are an on-call Site Reliability Engineer. A production alert is FIRING. Investigate and determine the ROOT CAUSE.

FIRING ALERT
  name:        ${alert.alertname}
  severity:    ${alert.severity ?? "unknown"}
  labels:      ${labels}
  annotations: ${annotations}

WHAT YOU CAN DO (READ-ONLY — never modify, deploy, or restart anything)
  - Prometheus API at ${t.prometheusUrl}
      e.g. curl -s '${t.prometheusUrl}/api/v1/query' --data-urlencode 'query=<promql>'
           curl -s '${t.prometheusUrl}/api/v1/rules'
  - Alertmanager API at ${t.alertmanagerUrl}  (e.g. curl -s '${t.alertmanagerUrl}/api/v2/alerts')
  - The application's own API at ${t.apiUrl}
  - The application SOURCE CODE is in your current working directory — inspect it with ls/cat/grep/head.

HOW TO WORK
  Use shell commands to gather concrete evidence. Confirm the alert's signal in Prometheus, then narrow down WHY:
  correlate metrics, probe the API, read logs, and read the relevant source. For every conclusion, note the exact
  command/metric/file that supports it. When you are confident, state the single most likely root cause, the
  supporting evidence, and a recommended fix. Be specific and concise. Do not guess without evidence.`;
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
