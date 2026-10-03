// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts";
import type { StateTone } from "@/components/shared/StateWord";

export type AnswerWord =
	| "Confirmed"
	| "Likely"
	| "Unconfirmed"
	| "No cause found";

const TONE: Record<AnswerWord, StateTone> = {
	Confirmed: "done",
	Likely: "accent",
	Unconfirmed: "stale",
	"No cause found": "neutral",
};

/**
 * The report's confidence word (study-v3 §2, §3.2), from the status of the
 * hypothesis the cause stands on, and the line that says what it rests on.
 */
export function answerWord(
	report: Pick<InvestigationReport, "rootCause" | "hypotheses">,
): { word: AnswerWord; tone: StateTone; basis: string } {
	const top = report.hypotheses.find((h) => h.status !== "refuted");
	if (!report.rootCause) {
		const supported = report.hypotheses.filter(
			(h) => h.status === "supported" || h.status === "confirmed",
		).length;
		return {
			word: "No cause found",
			tone: TONE["No cause found"],
			basis:
				supported === 0
					? "nothing it found is supported"
					: `${supported === 1 ? "one finding is" : `${supported} findings are`} supported, but not as a cause`,
		};
	}
	const word: AnswerWord =
		top?.status === "confirmed"
			? "Confirmed"
			: top?.status === "supported"
				? "Likely"
				: "Unconfirmed";
	const evidence = top?.evidence ?? [];
	const forIt = evidence.filter((e) => e.direction === "supports").length;
	const against = evidence.filter((e) => e.direction === "contradicts").length;
	const pieces = forIt === 1 ? "one piece" : `${forIt} pieces`;
	return {
		word,
		tone: TONE[word],
		basis:
			forIt === 0
				? "no evidence for it was recorded"
				: `${pieces} of evidence for it, ${against === 0 ? "none" : against} against`,
	};
}
