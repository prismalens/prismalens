/**
 * Methodology event payloads (work-unit 004, plan "Observability"; T061).
 *
 * The negative-signal surface the investigation canvas / report renders. These
 * REPLACE the retired LangGraph `routing` / `stalled` writer events. 002 owns
 * the event bus; this unit only defines the payload shapes. The `converged` /
 * `stalled` union is kept aligned with `ConvergenceSignal` (convergence.ts).
 */

import type { ConfidenceBand } from "./confidence.js";
import type { GradeGap } from "./rubric.js";

/**
 * Emitted when a returned report is graded at the boundary (Principle IX).
 *
 * The canvas/wire projection of rubric.ts `GradeResult`: `pass` / `score` /
 * `gaps` carry straight through — reusing the canonical `GradeGap` so the
 * per-gap phase scoping is preserved — `band` is added for the canvas, and the
 * `GradeResult.signal` is dropped here because it is carried separately as a
 * `ConvergedEvent` / `StalledEvent`.
 */
export interface GradeEvent {
	type: "grade";
	pass: boolean;
	/** 0–1 rubric score. */
	score: number;
	/** Why it did/didn't pass — the feedback for re-dispatch (canonical GradeGap). */
	gaps: GradeGap[];
	band: ConfidenceBand;
}

/** Emitted when the loop converges (no new info / criteria resolved). */
export interface ConvergedEvent {
	type: "converged";
	reason: string;
	rounds: number;
}

/** Emitted when the loop stalls — a negative signal, never a kill (Principle III). */
export interface StalledEvent {
	type: "stalled";
	reason: string;
	rounds: number;
}

export type MethodologyEvent = GradeEvent | ConvergedEvent | StalledEvent;
