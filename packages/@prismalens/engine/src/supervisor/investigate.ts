/**
 * The Tier-1 supervisor pipeline (ADR-0008/0016): the thin, deterministic
 * `decompose → fan-out → reduce` that composes the named stages into one streaming
 * primitive, plus the harness constructors it dispatches to.
 *
 *   {@link decompose}  context → Branch[]        (N=1: one branch over the context)
 *   {@link fanOut}     branches → canonical stream  (each on a RENTED harness loop)
 *   {@link reduce}     stream → ordered-evidence report  (the one supervisor LLM call)
 *
 * The harness investigates READ-ONLY using its own shell/loop (CLI-primary: it runs
 * `curl`/`cat`/`grep` against the telemetry endpoints + source in its cwd) — no
 * bespoke MCP tools yet. The supervisor stays thin: all iterative depth is rented.
 */
import { randomUUID } from "node:crypto";
import type {
	CanonicalEvent,
	InvestigationContext,
	InvestigationReport,
	RunFidelity,
} from "@prismalens/contracts";
import type { AdapterContext } from "../adapter/acp-adapter.js";
import {
	type AcpClientConfig,
	autoAllowReadOnly,
} from "../runner/acp-client.js";
import { runDeepAgentsBranch } from "../runner/acp-run-branch.js";
import {
	type ClaudeCodeConfig,
	runClaudeCodeBranch,
} from "../runner/claude-code-runner.js";
import { decompose } from "./decompose.js";
import { fanOut } from "./fan-out.js";
import { reduce, type SynthesisModelConfig } from "./synthesize.js";

/**
 * A Tier-2 harness as the supervisor sees it: given the investigation prompt and a
 * branch context, yield the canonical event stream. deepagents (ACP) and Claude
 * Code (Agent SDK) both reduce to this one shape.
 */
export type HarnessRunner = (
	prompt: string,
	ctx: AdapterContext,
) => AsyncGenerator<CanonicalEvent>;

/**
 * deepagents over ACP — the zero-setup, read-only-by-default local harness. The
 * permission policy always stays {@link autoAllowReadOnly} (COOPERATIVE — deepagents
 * cannot hard-enforce without a sandbox); the ADR-0017 `native` passthrough rides on
 * AcpClientConfig and is turned into the real enforcers (`-S` shellAllowList /
 * `--sandbox`) by the ACP arg builder — no intermediate mapping hop (ADR-0017 Amdt 2).
 */
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
	/**
	 * The host-assembled investigation context (ADR-0015): ≥1 firing alert, the
	 * read-only telemetry surfaces, and optional service/repo/log/incident context.
	 * The ONE domain payload the supervisor consumes (ADR-0016).
	 */
	context: InvestigationContext;
	/** Tier-2 harness runner — e.g. deepAgentsHarness(...) or claudeCodeHarness(...). */
	harness: HarnessRunner;
	/** Tier-1 reduce model (Vercel AI SDK). */
	synth: SynthesisModelConfig;
	/** Investigation run id (== Investigation.id). Generated if omitted. */
	runId?: string;
	/**
	 * The HONEST enforcement fidelity this run applied (ADR-0017 §4). Attached
	 * deterministically onto the emitted report — never LLM-authored.
	 */
	fidelity?: RunFidelity;
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
	const branches = decompose(opts.context);
	const collected: CanonicalEvent[] = [];
	for await (const ev of fanOut(branches, opts.harness, runId)) {
		collected.push(ev);
		yield ev;
	}
	// No-evidence guard: a run that gathered zero tool_results must NOT be laundered
	// into a fabricated report, regardless of terminal (error OR branch_done) — ADR-0002
	// ordered-evidence / the Constitution's "no evidence → no report" rule.
	const toolResults = collected.filter((e) => e.kind === "tool_result").length;
	if (toolResults === 0) return;
	const report = await reduce(opts.context, collected, opts.synth);
	yield {
		kind: "report",
		runId,
		seq: collected.length,
		ts: new Date().toISOString(),
		// Attach the deterministic fidelity AFTER synthesis (ADR-0017): the LLM never
		// generates it — reduce() omits it, we spread it on here.
		report: opts.fidelity ? { ...report, fidelity: opts.fidelity } : report,
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
