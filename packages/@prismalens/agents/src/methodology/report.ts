/**
 * Investigation report — the graded final shape (work-unit 004, FR-3, D0.1).
 *
 * A SUPERSET of the product's legacy `InvestigationResult`
 * (`../types/results.ts`) that carries the Principle IX evidence trail: the
 * full `findings` graph, what was `ruledOut`, `coverage` of the signal space,
 * and a derived `band`. It downcasts to `InvestigationResult` for the existing
 * persistence boundary — see `MIGRATION.md` (FR-4). The legacy `Recommendation`
 * and `RootCauseCategory` are REUSED, not re-defined.
 */

import type { RootCauseCategory } from "@prismalens/contracts/schemas";
import type { Recommendation } from "../types/results.js";
import { type ConfidenceBand, classifyConfidence } from "./confidence.js";
import type { Finding, FindingId, Hypothesis } from "./findings.js";

/**
 * What the investigation actually looked at — generalized from the scout's
 * coverage report (`scout/coverage.ts`: `dataGaps`, `dataCompleteness`).
 */
export interface Coverage {
	/** Source/integration keys actually queried (e.g. `'prometheus'`, `'sentry'`). */
	sourcesQueried: string[];
	/** Human-readable gaps — signal that was wanted but unavailable/unqueried. */
	dataGaps: string[];
	/** Fraction of the intended coverage achieved (0–1). */
	completeness: number;
}

/** An explanation considered and explicitly rejected — part of the audit trail. */
export interface RuledOut {
	/** The candidate cause that was ruled out. */
	statement: string;
	/** Why it was rejected. */
	reason: string;
	/** Findings that justify ruling it out. */
	relatedFindings?: FindingId[];
}

/**
 * The complete, gradeable investigation report. Every adapter — thin-loop or
 * orchestrator-delegate — emits this shape (Principle II), and `gradeReport`
 * (rubric.ts) grades it at the boundary (Principle IX).
 */
export interface InvestigationReport {
	summary: string;
	rootCause?: string;
	rootCauseCategory?: RootCauseCategory;
	/** Overall confidence (0–1); classified by `band`, never compared raw. */
	confidence: number;
	/** Derived from `confidence` via `deriveBand` — never hand-set. */
	band: ConfidenceBand;
	hypotheses: Hypothesis[];
	findings: Finding[];
	recommendations: Recommendation[];
	coverage: Coverage;
	ruledOut: RuledOut[];
}

/**
 * Derive the band from a report's confidence (D0.2): the single place `band`
 * is computed, so it can never drift from `confidence`.
 */
export function deriveBand(
	report: Pick<InvestigationReport, "confidence">,
): ConfidenceBand {
	return classifyConfidence(report.confidence);
}
