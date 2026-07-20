// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts";
import type { ScoringOracle } from "./ab-runner.js";
import { scoreReport } from "./score.js";

/**
 * Creates an interim path-A keyword scorer.
 * For the prismalens arm, it uses the existing scoreReport on the structured report.
 * For the raw arm, it matches keywords directly against rawText (to avoid injecting
 * product structure into the baseline).
 */
export function makeKeywordOracle(keywords: string[]): ScoringOracle {
	return async (arm) => {
		const expected = { rootCauseKeywords: keywords, mustNotContain: [] };

		let pass = false;
		let detail = "";

		if (arm.arm === "prismalens") {
			const report = arm.report as InvestigationReport;
			const result = scoreReport(report, expected);
			pass = result.pass;
			detail = `matched: ${result.matchedKeyword ?? "none"}`;
		} else {
			const haystack = arm.rawText.toLowerCase();
			const matchedKeyword =
				keywords.find((kw) => haystack.includes(kw.toLowerCase())) ?? null;
			pass = matchedKeyword !== null;
			detail = `matched: ${matchedKeyword ?? "none"}`;
		}

		return {
			score: pass ? 1 : 0,
			note: `interim path-A keyword scorer (superseded by #56) — ${detail}`,
		};
	};
}
