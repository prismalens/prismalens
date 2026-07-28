// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Paired A/B eval runner (#68 Half A) — the instrument that runs the SAME live
 * sreforge incident through two arms and captures each arm's (report + tokens/cost +
 * time-to-report). The per-incident DELTA is the metric; automated scoring is OUT OF
 * SCOPE here (Half B / sreforge #39) — see {@link unscored}, the clean stubbed seam.
 *
 * CLEAN-ABLATION design (locked): BOTH arms rent the SAME Claude Code harness with the
 * SAME incident-response skill loaded and the SAME pinned model. The ONLY difference is
 * the PrismaLens supervisor overlay on arm (b). So the delta isolates pure
 * supervisor/reduce value.
 *   - Arm (a) "raw": bare {@link runClaudeCodeBranch} — skill loaded, the identical
 *     neutral on-call brief, NO supervisor. Its diagnosis is the terminal agent text.
 *   - Arm (b) "prismalens": {@link investigateIncident} over a {@link claudeCodeHarness}
 *     that ALSO loads the skill — yields a structured InvestigationReport via Tier-1
 *     reduce().
 *
 * The prompt is byte-identical across arms MODULO the context pack, which is arm (b)'s
 * treatment (and rung L4's): both use {@link buildInvestigationPrompt} (for a
 * single-alert context, decompose's root branch already uses it byte-identically, so
 * arm (b)'s internal prompt matches arm (a)'s verbatim), but {@link runRawArm} strips
 * `context.contextPack` unless the arm explicitly opts in via
 * {@link ArmOptions.carryContextPack}.
 */
import { randomUUID } from "node:crypto";

import type {
	CanonicalEvent,
	FiringAlert,
	InvestigationContext,
	InvestigationReport,
	ServiceContext,
	TelemetryEndpoints,
} from "@prismalens/contracts";
import type { AdapterContext } from "../src/adapter/acp-adapter.js";
import {
	type ClaudeCodeConfig,
	runClaudeCodeBranch,
} from "../src/runner/claude-code-runner.js";
import { fetchFiringAlerts } from "../src/supervisor/alert-source.js";
import { buildInvestigationPrompt } from "../src/supervisor/decompose.js";
import {
	claudeCodeHarness,
	investigateIncident,
} from "../src/supervisor/investigate.js";
import type { SynthesisModelConfig } from "../src/supervisor/synthesize.js";

// =============================================================================
// Scoring seam (Half B / sreforge #39) — stubbed, deliberately un-wired here
// =============================================================================

/**
 * One arm's automated score. `score` is null until Half B (sreforge #39) wires the
 * diagnose/RCA oracle; `note` records why. Kept structurally minimal so the oracle can
 * later fill it (a numeric grade + a human note) without a capture-shape migration.
 * `detail` holds the raw oracle output (e.g. diagnosis.v1 object) so verdict axes
 * (especially false_leads) are preserved and not lost by flattening into a prose note.
 */
export interface ArmScore {
	/** The automated grade — null while unscored (Half A). */
	score: number | null;
	/** Human-readable provenance / TODO for the score. */
	note: string;
	/** Raw oracle detail (e.g. diagnosis.v1 object) to preserve verdict axes like false_leads. */
	detail?: unknown;
}

/**
 * The pluggable scorer. Half A leaves this defaulted to {@link unscored}; Half B
 * (sreforge #39) passes the real sreforge diagnose/RCA oracle. Receives the arm's
 * full capture (minus its own score) plus the shared incident context.
 */
export type ScoringOracle = (
	arm: Omit<ArmCapture, "score">,
	context: InvestigationContext,
) => Promise<ArmScore>;

/** The Half-A default: never scores — the single, honest stub for the #39 seam. */
export const unscored: ScoringOracle = async () => ({
	score: null,
	note: "TODO(#39): sreforge diagnose/RCA oracle not yet wired",
});

// =============================================================================
// Capture shapes
// =============================================================================

/**
 * The two provider line items for an arm, kept SEPARATE on purpose: a $-priced Claude
 * harness call is never blended with the local (Vercel-AI-SDK) synth tokens the Tier-1
 * reduce spends. `claudeUsd` is the harness dollar cost; `synthTokens` (arm b only) is
 * the reduce step's token count, which has no dollar price attached here.
 */
export interface ProviderCost {
	/** The Claude Code harness dollar cost (from the terminal branch_done). */
	claudeUsd: number;
	/** Tier-1 reduce token spend (arm b only) — a separate, unpriced line item. */
	synthTokens?: { input: number; output: number };
}

/** One arm's full capture — report + cost + tokens + time-to-report + raw stream. */
export interface ArmCapture {
	arm: "raw" | "prismalens";
	/** Structured report (arm b) or the terminal agent text wrapper (arm a). */
	report: InvestigationReport | { rawText: string };
	/** The terminal agent diagnosis text (last non-empty agent_step). */
	rawText: string;
	/** Total DOLLAR cost of the arm = the Claude harness cost (synth is unpriced). */
	costUsd: number;
	/** Per-provider breakdown (never blend $-priced Claude with local synth tokens). */
	providerCost: ProviderCost;
	/** The comparable Claude harness token spend (Tier-2 work) for this arm. */
	tokens: { input: number; output: number };
	/** Wall-clock time from arm start to a produced report (end-to-end). */
	timeToReportMs: number;
	/** The firing alerts re-fetched immediately before this arm (incident-drift view). */
	alertSnapshot: unknown;
	/** The full canonical event stream this arm produced. */
	events: CanonicalEvent[];
	/** Automated score — null (unscored) in Half A; see {@link ScoringOracle}. */
	score: ArmScore;
}

/** What an arm runner returns before orchestration attaches snapshot + score. */
export type ArmRun = Omit<ArmCapture, "score" | "alertSnapshot">;

/** An arm outcome in the paired capture — a full capture, or a captured failure. */
export type ArmOutcome =
	| ({ ok: true } & ArmCapture)
	| {
			ok: false;
			arm: "raw" | "prismalens";
			error: string;
			alertSnapshot: unknown;
	  };

/** The side-by-side of both arms plus the shared incident metadata. */
export interface PairedCapture {
	/** A slug/label for this incident scenario (artifact filename + table row). */
	scenario: string;
	/** The pinned model both arms rented (clean-ablation invariant). */
	model: string;
	/** Shared incident metadata — the identical input both arms investigated. */
	incident: {
		alerts: FiringAlert[];
		telemetry: TelemetryEndpoints;
		service?: ServiceContext;
	};
	raw: ArmOutcome;
	prismalens: ArmOutcome;
	capturedAt: string;
}

// =============================================================================
// Options
// =============================================================================

/** Shared per-arm run options (the clean-ablation knobs — same for both arms). */
export interface ArmOptions {
	/** The substrate working dir the harness reads the app source from. */
	cwd: string;
	/** The pinned Claude model id — IDENTICAL for both arms (clean ablation). */
	model: string;
	/** Absolute path to the vendored incident-response local plugin dir. Absent = ablation rung without the skill. */
	skillPluginPath?: string;
	/** Tools the agent may NOT use for this arm (e.g. L0 deny-all). */
	disallowedTools?: string[];
	/** Runaway guard for the rented harness (default 40). */
	maxTurns?: number;
	/** Tier-1 reduce model config — only the prismalens arm's reduce() uses it. */
	synth: SynthesisModelConfig;
	/** Cooperative cancellation, threaded to the prismalens arm's supervisor. */
	signal?: AbortSignal;
	/**
	 * Render `context.contextPack` into the raw arm's prompt. DEFAULT FALSE: the raw
	 * arm is the ablation baseline and must not receive arm (b)'s treatment. Only the
	 * no rung sets this true today. `Rung` is L0|L1|L2|L3 (eval/ladder.ts) and
	 * an L4 "bare tool loop + pack" rung is NOT built. The parameter exists so the
	 * strip is a decision at the call site rather than an invisible default; if L4 is
	 * never built, delete it and strip unconditionally.
	 */
	carryContextPack?: boolean;
}

/** Options for the paired driver (both arms + orchestration). */
export interface PairedABOptions extends ArmOptions {
	/** Scenario slug/label; defaults to the first alert's name. */
	scenario?: string;
	/** Half-B scoring hook; defaults to {@link unscored}. */
	oracle?: ScoringOracle;
	/** Timeout for the per-arm alert-snapshot re-fetch (default 5000ms). */
	fetchTimeoutMs?: number;
}

const DEFAULT_MAX_TURNS = 40;

// =============================================================================
// Arm (a) — raw
// =============================================================================

/** The skill-loading native passthrough both arms share (identical → clean ablation). */
export function skillNative(skillPluginPath?: string): Record<string, unknown> {
	if (!skillPluginPath) return {};
	return {
		plugins: [{ type: "local", path: skillPluginPath }],
		skills: ["incident-response"],
	};
}

/**
 * The context the raw arm actually builds its prompt from: the pack is STRIPPED
 * unless the arm opted in. The raw arm is the ablation baseline — if it receives arm
 * (b)'s treatment, the ablation the #73 gate depends on is destroyed.
 *
 * Exported so the ablation can be ASSERTED rather than trusted to a comment. It lives
 * here, on the context, and not as a parameter on `buildInvestigationPrompt`: the
 * engine's prompt builder must stay a pure function of the context, and an
 * unconditional strip would foreclose an L4 (bare loop + pack) rung, which is NOT
 * built today — `Rung` is L0|L1|L2|L3 and run-ladder.ts errors on anything else. Named
 * here as a deliberately-kept seam, not as a description of existing work, since
 * `rungArmOptions` has no other channel to put the pack back.
 */
export function rawArmPromptContext(
	context: InvestigationContext,
	carryContextPack?: boolean,
): InvestigationContext {
	if (carryContextPack) return context;
	const { contextPack: _stripped, ...bare } = context;
	return bare;
}

/**
 * Arm (a) "raw": drive a BARE Claude Code harness over the neutral on-call brief with
 * the incident-response skill loaded and NO supervisor. The diagnosis is the terminal
 * agent text; cost/tokens come from the terminal branch_done event.
 */
export async function runRawArm(
	context: InvestigationContext,
	opts: ArmOptions,
): Promise<ArmRun> {
	const runId = randomUUID();
	const ctx: AdapterContext = { runId, branchId: "root" };
	const config: ClaudeCodeConfig = {
		cwd: opts.cwd,
		prompt: buildInvestigationPrompt(
			rawArmPromptContext(context, opts.carryContextPack),
		),
		model: opts.model,
		maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
		// Isolate host settings/hooks/plugins so the ONLY loaded skill is the vendored
		// one below — the clean-ablation invariant. Plugins load via the query() option
		// independently of settingSources, so the skill is present even under isolation.
		isolateSettings: true,
		native: skillNative(opts.skillPluginPath),
		...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
		...(opts.signal
			? { abortController: signalToController(opts.signal) }
			: {}),
	};

	const events: CanonicalEvent[] = [];
	const start = Date.now();
	for await (const ev of runClaudeCodeBranch(config, ctx)) events.push(ev);
	const timeToReportMs = Date.now() - start;

	const claude = sumClaudeCost(events);
	const rawText = lastAgentText(events);
	return {
		arm: "raw",
		report: { rawText },
		rawText,
		costUsd: claude.costUsd,
		providerCost: { claudeUsd: claude.costUsd },
		tokens: claude.tokens,
		timeToReportMs,
		events,
	};
}

// =============================================================================
// Arm (b) — prismalens
// =============================================================================

/**
 * Arm (b) "prismalens": run the full Tier-1 supervisor via {@link investigateIncident}
 * over a Claude Code harness that ALSO loads the skill (identical to arm a) — yielding a
 * structured InvestigationReport through reduce(). Arm cost = the Claude branch_done
 * dollars; the reduce step's synth tokens are recorded as a SEPARATE provider line item.
 */
export async function runPrismalensArm(
	context: InvestigationContext,
	opts: ArmOptions,
): Promise<ArmRun> {
	const runId = randomUUID();
	const start = Date.now();
	const { report, events } = await investigateIncident({
		context,
		harness: claudeCodeHarness({
			cwd: opts.cwd,
			model: opts.model,
			maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
			isolateSettings: true,
			native: skillNative(opts.skillPluginPath),
		}),
		synth: opts.synth,
		runId,
		...(opts.signal ? { signal: opts.signal } : {}),
	});
	const timeToReportMs = Date.now() - start;

	const claude = sumClaudeCost(events);
	const synthTokens = sumSynthTokens(events);
	return {
		arm: "prismalens",
		report,
		rawText: lastAgentText(events),
		// Dollar cost is the Claude harness only — local synth tokens are unpriced and
		// kept as a separate line item (never blended into a $ figure).
		costUsd: claude.costUsd,
		providerCost: { claudeUsd: claude.costUsd, synthTokens },
		tokens: claude.tokens,
		timeToReportMs,
		events,
	};
}

// =============================================================================
// Paired driver
// =============================================================================

/**
 * Run BOTH arms on the same incident, SEQUENTIALLY (raw then prismalens). Re-fetches the
 * firing alerts immediately BEFORE each arm and stores that per-arm alertSnapshot so a
 * reviewer can see incident-drift between the two runs. Each arm is wrapped in its own
 * try/catch — one arm dying still returns the other. Scoring is deferred to `oracle`
 * (defaults to {@link unscored}).
 */
export async function runPairedAB(
	context: InvestigationContext,
	opts: PairedABOptions,
): Promise<PairedCapture> {
	const oracle = opts.oracle ?? unscored;
	const alertmanagerUrl = context.telemetry.alertmanagerUrl;
	const fetchTimeoutMs = opts.fetchTimeoutMs ?? 5000;

	async function snapshot(): Promise<unknown> {
		// Drift visibility must never fail an arm — a snapshot error is captured, not thrown.
		try {
			return await fetchFiringAlerts(
				alertmanagerUrl,
				AbortSignal.timeout(fetchTimeoutMs),
			);
		} catch (err) {
			return { error: toMessage(err) };
		}
	}

	async function driveArm(
		arm: "raw" | "prismalens",
		run: () => Promise<ArmRun>,
	): Promise<ArmOutcome> {
		// Re-fetch immediately BEFORE the arm (per-arm incident-drift view).
		const alertSnapshot = await snapshot();
		try {
			const partial = await run();

			// A harness that never reached a model produced no RCA — but it DID produce
			// text (the error string), and an oracle will happily grade that text and
			// bank a plausible low score. In a campaign record that is indistinguishable
			// from "the agent tried and scored badly", which is the one failure mode that
			// silently corrupts a whole batch. Fail the arm rather than score it.
			const harnessError = harnessFailure(partial);
			if (harnessError !== null) {
				return { ok: false, arm, error: harnessError, alertSnapshot };
			}

			const withSnapshot: Omit<ArmCapture, "score"> = {
				...partial,
				alertSnapshot,
			};
			// A scorer outage must NOT discard a successful (expensive) arm capture —
			// degrade only the score. Half A's `unscored` never throws; Half B's live
			// #39 judge can fail on a transient API error.
			try {
				const score = await oracle(withSnapshot, context);
				return { ok: true, ...withSnapshot, score };
			} catch (err) {
				return {
					ok: true,
					...withSnapshot,
					score: { score: null, note: `oracle failed: ${toMessage(err)}` },
				};
			}
		} catch (err) {
			return { ok: false, arm, error: toMessage(err), alertSnapshot };
		}
	}

	const raw = await driveArm("raw", () => runRawArm(context, opts));
	const prismalens = await driveArm("prismalens", () =>
		runPrismalensArm(context, opts),
	);

	return {
		scenario: opts.scenario ?? context.alerts[0]?.alertname ?? "incident",
		model: opts.model,
		incident: {
			alerts: context.alerts,
			telemetry: context.telemetry,
			...(context.service ? { service: context.service } : {}),
		},
		raw,
		prismalens,
		capturedAt: new Date().toISOString(),
	};
}

// =============================================================================
// pure helpers
// =============================================================================

/** Sum the Claude harness dollar cost + token usage across terminal branch_done events. */
function sumClaudeCost(events: CanonicalEvent[]): {
	costUsd: number;
	tokens: { input: number; output: number };
} {
	let costUsd = 0;
	let input = 0;
	let output = 0;
	for (const e of events) {
		if (e.kind !== "branch_done") continue;
		if (typeof e.total_cost_usd === "number") costUsd += e.total_cost_usd;
		if (e.usage) {
			input += e.usage.input_tokens ?? 0;
			output += e.usage.output_tokens ?? 0;
		}
	}
	return { costUsd, tokens: { input, output } };
}

/** Sum the Tier-1 reduce token spend across llm_call events (arm b's separate line item). */
function sumSynthTokens(events: CanonicalEvent[]): {
	input: number;
	output: number;
} {
	let input = 0;
	let output = 0;
	for (const e of events) {
		if (e.kind !== "llm_call") continue;
		if (e.usage) {
			input += e.usage.inputTokens ?? 0;
			output += e.usage.outputTokens ?? 0;
		}
	}
	return { input, output };
}

/** The last non-empty agent_step text — the harness's terminal diagnosis. */
function lastAgentText(events: CanonicalEvent[]): string {
	let text = "";
	for (const e of events) {
		if (e.kind === "agent_step" && e.text.trim()) text = e.text.trim();
	}
	return text;
}

/**
 * Names a harness failure — a run that emitted an `error` event without ever
 * billing a token — or null when the arm genuinely ran.
 *
 * Zero tokens is the discriminator, not the error event alone: an agent that
 * errors *after* working has still produced a scorable investigation, and
 * discarding it would throw away a paid arm. An agent that errors having spent
 * nothing never spoke to a model at all, and its "output" is the error string.
 *
 * Observed live 2026-07-26: an auth failure under `isolateSettings` returned
 * `ok: true` with `rawText: "Not logged in · Please run /login"`, which the judge
 * scored 0.2 and banked with a full axes breakdown.
 */
export function harnessFailure(run: ArmRun): string | null {
	const failure = run.events.find((e) => e.kind === "error");
	if (!failure) return null;
	if (run.tokens.input + run.tokens.output > 0) return null;
	return `harness never reached a model (0 tokens): ${failure.message}`;
}

/** Bridge an external AbortSignal to the runner's AbortController seam (arm a). */
function signalToController(signal: AbortSignal): AbortController {
	const controller = new AbortController();
	if (signal.aborted) controller.abort();
	else
		signal.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

function toMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
