/**
 * Confidence band — the single accept/reject authority for investigation output.
 *
 * Reconciles two pre-pivot definitions into one (work-unit 004, FR-5/6/7, D0.2):
 *   - the retired engine's `ConvergenceConfigSchema.confidence_threshold: 0.8`
 *     (`prismalens-agents/src/core/config/schema.ts`), and
 *   - the product's bare `confidence: z.number().min(0).max(1)` in
 *     `@prismalens/contracts` `investigation.ts` (no band at all).
 *
 * Both are SUPERSEDED by the constitution's band (Principle IX). No code path
 * may compare a confidence value against a hand-written threshold literal —
 * import from here instead (SC-2).
 */

import type { Finding, Hypothesis } from "./findings.js";

/**
 * Band boundaries. `auto` = ship without corroboration; `corroborate` = the
 * lower edge of the "acceptable only with ≥2 independent sources" band; below
 * `corroborate` is rejected. These two numbers are the ONLY confidence
 * thresholds in the codebase (FR-6).
 */
export const CONFIDENCE_BAND = { auto: 0.85, corroborate: 0.7 } as const;

/** The three confidence verdicts. */
export type ConfidenceBand = "auto" | "corroborate" | "reject";

/**
 * Classify a raw confidence (0–1) into a band (FR-5):
 *   `>= 0.85` → auto · `>= 0.7` → corroborate · else → reject.
 */
export function classifyConfidence(c: number): ConfidenceBand {
	if (c >= CONFIDENCE_BAND.auto) return "auto";
	if (c >= CONFIDENCE_BAND.corroborate) return "corroborate";
	return "reject";
}

/**
 * Whether a confidence sits in the `[0.7, 0.85)` corroborate band — i.e. it is
 * only acceptable with ≥2 independent corroborating sources (FR-7).
 */
export function requiresCorroboration(c: number): boolean {
	return c >= CONFIDENCE_BAND.corroborate && c < CONFIDENCE_BAND.auto;
}

/**
 * Count the DISTINCT sources among the findings that support a hypothesis.
 *
 * OQ-3 default: independence = a distinct `Finding.source` value (the
 * integration key, e.g. `'prometheus'` vs `'sentry'`). A future tightening to
 * "distinct integration *instance*" is decided in work-unit 002.
 */
export function corroboratingSourceCount(
	hypothesis: Hypothesis,
	findings: ReadonlyArray<Finding>,
): number {
	const supporting = new Set<string>(hypothesis.supportingEvidence);
	const sources = new Set<string>();
	for (const f of findings) {
		if (supporting.has(f.id) && f.source) sources.add(f.source);
	}
	return sources.size;
}

/**
 * FR-7: a corroborate-band hypothesis is acceptable only with ≥2 independent
 * corroborating sources. Below that it is a coverage gap, not a conclusion.
 */
export function corroborationSatisfied(
	hypothesis: Hypothesis,
	findings: ReadonlyArray<Finding>,
): boolean {
	return corroboratingSourceCount(hypothesis, findings) >= 2;
}
