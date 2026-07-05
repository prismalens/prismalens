/**
 * Scoring for the golden-incident scorecard: does the reduce step's top-1
 * hypothesis (ADR-0002 ordered-evidence — array position IS the rank) name the
 * expected root cause, and does it avoid the fixture's red-herring?
 *
 * Deliberately dumb (substring match, case-insensitive) — the scorecard is a
 * coarse regression trip-wire, not an NLP eval. A future slice can swap in an
 * LLM-judge; this stays dependency-free and fully offline-computable.
 */
import type { InvestigationReport } from "@prismalens/contracts";
import type { FixtureExpected } from "./fixtures.js";

export interface ScoreResult {
	pass: boolean;
	/** The report's top-ranked hypothesis statement (empty string if none). */
	topHypothesis: string;
	/** Which expected keyword matched, or null if none did (⇒ fail). */
	matchedKeyword: string | null;
	/** Which `mustNotContain` string was found, or null if none was (⇒ fail if set). */
	violatedMustNotContain: string | null;
}

/**
 * Score ONE report against its fixture's expectation. Checks the top-1
 * hypothesis's statement, falling back to `rootCause` when there are no
 * hypotheses at all (a degenerate/empty report should still be scoreable, not
 * throw) — both are searched together so a root cause named only in `rootCause`
 * still counts.
 */
export function scoreReport(
	report: InvestigationReport,
	expected: FixtureExpected,
): ScoreResult {
	const topHypothesis = report.hypotheses[0]?.statement ?? "";
	const haystack = `${topHypothesis} ${report.rootCause ?? ""}`.toLowerCase();

	const matchedKeyword =
		expected.rootCauseKeywords.find((kw) =>
			haystack.includes(kw.toLowerCase()),
		) ?? null;
	const violatedMustNotContain =
		(expected.mustNotContain ?? []).find((kw) =>
			haystack.includes(kw.toLowerCase()),
		) ?? null;

	return {
		pass: matchedKeyword !== null && violatedMustNotContain === null,
		topHypothesis,
		matchedKeyword,
		violatedMustNotContain,
	};
}

/** Scorecard pass/fail vs `threshold` out of `total` — the CI gate's arithmetic. */
export function meetsThreshold(
	passed: number,
	total: number,
	threshold: number,
): boolean {
	return passed >= threshold && total > 0;
}
