/**
 * Convergence semantics — contract only; work-unit 002 implements the loop
 * (work-unit 004, FR-11/12, D0.4).
 *
 * Reconciles the engine's `ConvergenceConfigSchema`
 * (`prismalens-agents/src/core/config/schema.ts`: `max_no_new_info_rounds: 3`,
 * `stall_detection_window: 3`, `stall_timeout_ms: 120_000`) with the product's
 * `detectProgress()` / `ProgressSnapshot` in `agents/supervisor/node.ts`.
 *
 * Principle III (validate, don't replace): convergence/stall emits a NEGATIVE
 * SIGNAL ONLY — it must NOT force-terminate. This replaces the supervisor's
 * `goto "__end__"` force-kill on stall; only an explicit timeout terminates.
 */

import type { Finding, Hypothesis } from "./findings.js";
import type { Coverage } from "./report.js";

/** Loop bounds (the `confidence_threshold` is dropped — the band owns that). */
export interface ConvergenceConfig {
	/** Rounds with no new information before declaring convergence. */
	maxNoNewInfoRounds: number;
	/** Window of recent rounds inspected for a stall. */
	stallDetectionWindow: number;
	/** Hard wall-clock budget; the ONLY thing that terminates (Principle III). */
	timeoutMs: number;
}

export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
	maxNoNewInfoRounds: 3,
	stallDetectionWindow: 3,
	timeoutMs: 120_000,
};

/**
 * Negative-only signal (FR-12). 002's grade-gate turns this into
 * re-dispatch-with-feedback or a final report — never a kill.
 */
export type ConvergenceSignal = {
	type: "converged" | "stalled";
	reason: string;
};

/**
 * Minimal projection of investigation state for new-information detection —
 * the reconciled successor to the supervisor's `ProgressSnapshot`.
 */
export interface ProgressSnapshot {
	findingIds: string[];
	/** hypothesisId → lifecycle status. */
	hypothesisStatuses: Record<string, string>;
	/** hypothesisId → confidence (0–1). */
	hypothesisConfidence: Record<string, number>;
	/** Count of still-open coverage gaps. */
	openCoverageGaps: number;
}

/** Build a `ProgressSnapshot` from the current investigation state. */
export function buildSnapshot(
	findings: ReadonlyArray<Finding>,
	hypotheses: ReadonlyArray<Hypothesis>,
	coverage: Pick<Coverage, "dataGaps">,
): ProgressSnapshot {
	const hypothesisStatuses: Record<string, string> = {};
	const hypothesisConfidence: Record<string, number> = {};
	for (const h of hypotheses) {
		hypothesisStatuses[h.id] = h.status;
		hypothesisConfidence[h.id] = h.confidence;
	}
	return {
		findingIds: findings.map((f) => f.id),
		hypothesisStatuses,
		hypothesisConfidence,
		openCoverageGaps: coverage.dataGaps.length,
	};
}

/**
 * D0.4 — a round yields "new information" iff it (a) adds a `Finding`,
 * (b) transitions a `Hypothesis.status`, (c) raises a hypothesis `confidence`,
 * or (d) closes a `coverage` gap. Pure; 002's stall detector and the rubric's
 * stopping conditions agree on exactly this definition.
 */
export function isNewInformation(
	prev: ProgressSnapshot,
	next: ProgressSnapshot,
): boolean {
	// (a) a new finding appeared
	const prevFindings = new Set(prev.findingIds);
	if (next.findingIds.some((id) => !prevFindings.has(id))) return true;

	// (b) a hypothesis status transitioned
	for (const [id, status] of Object.entries(next.hypothesisStatuses)) {
		if (prev.hypothesisStatuses[id] !== status) return true;
	}

	// (c) a hypothesis confidence rose
	for (const [id, conf] of Object.entries(next.hypothesisConfidence)) {
		const before = prev.hypothesisConfidence[id];
		if (before === undefined || conf > before) return true;
	}

	// (d) a coverage gap closed
	if (next.openCoverageGaps < prev.openCoverageGaps) return true;

	return false;
}
