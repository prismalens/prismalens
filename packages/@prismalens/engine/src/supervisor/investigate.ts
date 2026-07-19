// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
import { DEFAULT_MAX_BRANCHES, decompose } from "./decompose.js";
import { fanOut } from "./fan-out.js";
import {
	type ReportModel,
	rawReport,
	reduce,
	type SynthesisModelConfig,
} from "./synthesize.js";

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
 * permission policy always stays {@link autoAllowReadOnly} (COOPERATIVE — the
 * published deepagents-acp binary has no hard enforcers); real enforcement is the
 * Sandbox port's job (ADR-0020/B.1). The ADR-0017 `native` passthrough rides on
 * AcpClientConfig as extra CLI args — no intermediate mapping hop (ADR-0017 Amdt 2).
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
	 * Per-alert fan-out cap (ADR-0016 decision 2) — the max branches decompose emits
	 * for a multi-alert context, and the fan-out concurrency ceiling. Optional; omitted
	 * ⇒ the engine default ({@link DEFAULT_MAX_BRANCHES}). A single-alert run ignores it.
	 */
	maxBranches?: number;
	/**
	 * The HONEST enforcement fidelity this run applied (ADR-0017 §4). Attached
	 * deterministically onto the emitted report — never LLM-authored.
	 */
	fidelity?: RunFidelity;
	/**
	 * Cooperative cancellation (CANCEL slice, ADR-0018 Scheduler seam). When it
	 * aborts, the stream stops consuming the merged fan-out AT THE NEXT STEP — even one
	 * parked awaiting a slow branch — and `iter.return()` cascades cleanup (fan-out
	 * returns each branch generator → acp-client kills the child + destroys the
	 * run-owned sandbox). The run then emits ONE terminal `error` event carrying
	 * {@link CANCELLED_MESSAGE} (no new CanonicalEvent kind) and stops — no reduce(), no
	 * report. Callers that want a durable "cancelled" record read the conductor's
	 * `failureKind: "cancelled"` outcome (the store has no cancel verb).
	 */
	signal?: AbortSignal;
	/**
	 * Test seam: override the reduce-step model (the one supervisor LLM call). Defaults
	 * to the real LLM (see {@link reduce}); injected in hermetic tests to exercise the
	 * synthesis boundary — e.g. the abort-during-reduce guard — with no live call.
	 */
	model?: ReportModel;
}

/**
 * The distinguishable terminal message an aborted run emits as its final `error`
 * event (CANCEL, ADR-0018). We reuse the existing `error` CanonicalEvent kind — NO new
 * contract kind — and stamp it with this exact string so {@link conductRun} can resolve
 * a `cancelled` outcome (persisted as status "cancelled") distinct from a transport
 * failure. {@link isCancelledError} is the single reader.
 */
export const CANCELLED_MESSAGE = "investigation cancelled by request";

/** The supervisor-level `branchId` on the terminal cancellation event (not a branch). */
const CANCELLED_BRANCH_ID = "supervisor";

/** True when an `error` event's message is the cancellation sentinel above. */
export function isCancelledError(message: string): boolean {
	return message === CANCELLED_MESSAGE;
}

/**
 * The ONE distinguishable terminal `error` event an aborted run emits (no new contract
 * kind). Emitted from every cancel exit — mid-stream abort AND an abort landing around
 * the terminal reduce() — so the conductor reads a single `cancelled` outcome shape.
 */
function cancelledErrorEvent(runId: string, seq: number): CanonicalEvent {
	return {
		kind: "error",
		runId,
		branchId: CANCELLED_BRANCH_ID,
		path: [],
		seq,
		ts: new Date().toISOString(),
		message: CANCELLED_MESSAGE,
	};
}

/** One merged-stream step, or the abort interrupting a step parked on a slow branch. */
type StreamStep =
	| { kind: "value"; value: CanonicalEvent }
	| { kind: "done" }
	| { kind: "aborted" };

/**
 * Advance `iter` one step, racing it against `signal`. Without a signal this is a plain
 * `iter.next()`; with one, an abort resolves `{ kind: "aborted" }` even while the step is
 * still parked awaiting a slow (or wedged) branch — the caller then `iter.return()`s to
 * cascade cleanup. A THROWN transport error rejects through unchanged — since the
 * fan-out containment (2026-07-07) that class is pre-first-event setup failures only
 * (binary missing, init handshake); the conductor's try/catch relies on it.
 */
function stepWithSignal(
	iter: AsyncIterator<CanonicalEvent>,
	signal: AbortSignal | undefined,
): Promise<StreamStep> {
	// Check abort BEFORE pulling: an already-aborted run must NOT resume the branch
	// (which would run it PAST its current yield into its next internal await, where
	// `return()` can no longer promptly unwind it). Left parked at its yield, the branch
	// cleans up synchronously when returned.
	if (signal?.aborted) return Promise.resolve({ kind: "aborted" });
	const step = iter
		.next()
		.then<StreamStep>((r) =>
			r.done ? { kind: "done" } : { kind: "value", value: r.value },
		);
	if (!signal) return step;
	return new Promise<StreamStep>((resolve, reject) => {
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			resolve({ kind: "aborted" });
		};
		signal.addEventListener("abort", onAbort, { once: true });
		step.then(
			(s) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				resolve(s);
			},
			(err) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				reject(err);
			},
		);
	});
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
	// Per-alert fan-out (ADR-0016 decision 2): decompose caps the branch count; the
	// fan-out lane ceiling is now explicitly the configured branch cap, rather than
	// relying on fan-out's default (which would be branches.length), so a future
	// decompose change or a large max_branches cannot exceed the explicit cap (issue #62).
	// Defaults apply when maxBranches is omitted, so the single-alert path is unchanged.
	const maxBranches = opts.maxBranches;
	const branchConcurrency = maxBranches ?? DEFAULT_MAX_BRANCHES;
	const branches = decompose(
		opts.context,
		maxBranches !== undefined ? { maxBranches } : {},
	);
	const collected: CanonicalEvent[] = [];
	// Iterate the merged stream MANUALLY (not `for await`) so an AbortSignal can
	// interrupt a step parked on a slow branch (CANCEL, ADR-0018): a `for await` would
	// only observe the abort at the next event boundary, so a wedged harness would never
	// release. On abort / early-return we `iter.return()` — fan-out then returns each
	// branch generator → acp-client kills the child + destroys the run-owned sandbox.
	const iter = fanOut(branches, opts.harness, runId, {
		concurrency: branchConcurrency,
	})[Symbol.asyncIterator]();
	let cancelled = false;
	let drained = false;
	try {
		while (true) {
			const step = await stepWithSignal(iter, opts.signal);
			if (step.kind === "aborted") {
				cancelled = true;
				break;
			}
			if (step.kind === "done") {
				drained = true;
				break;
			}
			collected.push(step.value);
			yield step.value;
		}
	} finally {
		// Release the branches on cancel OR consumer-abandonment (our generator was
		// itself returned). FIRE-AND-FORGET, never awaited: a branch parked at an internal
		// await (a slow/wedged harness) can only finish its `return()` cleanup — child
		// kill + run-owned sandbox destroy — at its next boundary, so awaiting here would
		// stall the cancelled outcome. In the worker that would DEADLOCK: the caller-owned
		// sandbox teardown that actually kills the child runs only AFTER conductRun
		// resolves. So we trigger the cascade and let it settle out of band. A no-op once
		// the stream drained on its own.
		if (!drained)
			void Promise.resolve(iter.return?.(undefined)).catch(() => {});
	}

	// Cancelled: emit ONE distinguishable terminal `error` event (no new contract kind)
	// and stop — no reduce(), no fabricated report. The no-evidence honesty (ADR-0002)
	// applies verbatim: an interrupted run has not earned a report.
	if (cancelled) {
		yield cancelledErrorEvent(runId, collected.length);
		return;
	}

	// No-evidence guard: a run that gathered zero tool_results must NOT be laundered
	// into a fabricated report, regardless of terminal (error OR branch_done) — ADR-0002
	// ordered-evidence / the Constitution's "no evidence → no report" rule.
	const toolResults = collected.filter((e) => e.kind === "tool_result").length;
	if (toolResults === 0) return;

	// Abort landing AFTER the merged stream drained but BEFORE synthesis: the drive-loop
	// can no longer observe it (there is nothing left to pull), so guard reduce() here.
	// An interrupted run has not earned a report — emit the same terminal cancelled event
	// and stop, do NOT spend the supervisor LLM call.
	if (opts.signal?.aborted) {
		yield cancelledErrorEvent(runId, collected.length);
		return;
	}
	let report: InvestigationReport;
	if (!opts.synth.configured) {
		report = rawReport(opts.context, collected);
	} else {
		const llmEvents: CanonicalEvent[] = [];
		// Compose, don't clobber: a caller-provided telemetry hook still fires.
		const callerOnLlmCall = opts.synth.onLlmCall;
		const synthCfg: SynthesisModelConfig = {
			...opts.synth,
			onLlmCall: (call) => {
				callerOnLlmCall?.(call);
				llmEvents.push({
					kind: "llm_call",
					runId,
					seq: 0, // Assigned properly when yielded
					ts: new Date().toISOString(),
					...call,
				} as CanonicalEvent);
			},
		};

		try {
			report = await reduce(opts.context, collected, synthCfg, opts.model);
			for (const ev of llmEvents) {
				ev.seq = collected.length;
				yield ev;
				collected.push(ev);
			}
		} catch (err) {
			for (const ev of llmEvents) {
				ev.seq = collected.length;
				yield ev;
				collected.push(ev);
			}
			report = rawReport(
				opts.context,
				collected,
				err instanceof Error ? err.message : String(err),
			);
		}
	}
	// Abort landing DURING reduce(): the LLM call is not itself abortable (out of scope),
	// so it ran to completion — but its result is DISCARDED. A cancelled run persists no
	// report, mirroring the mid-stream abort branch (ADR-0002).
	if (opts.signal?.aborted) {
		yield cancelledErrorEvent(runId, collected.length);
		return;
	}
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
